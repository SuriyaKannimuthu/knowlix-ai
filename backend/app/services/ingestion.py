"""Calibration (ingestion): parse -> clean -> chunk -> embed (dense + sparse) -> store."""

import asyncio
import logging
import time

from app.database.models import Document, DocumentStatus
from app.services.chunking import chunk_pages
from app.services.container import Services
from app.services.parsing import ParsingError, parse_document
from app.services.vector_store import ChunkMetadata

logger = logging.getLogger(__name__)


async def ingest_document(services: Services, document_id: str) -> None:
    settings = services.settings
    started = time.perf_counter()

    async with services.session_factory() as session:
        document = await session.get(Document, document_id)
        if document is None:
            return
        try:
            data = await services.storage.read(document.id, document.file_type)
            pages = await asyncio.to_thread(parse_document, document.file_type, data)
            chunks = chunk_pages(pages, settings.chunk_size, settings.chunk_overlap)

            # A short header gives the dense model document-level context for each chunk.
            dense_inputs = [f"Document: {document.filename}\n\n{c.text}" for c in chunks]
            dense = await services.embedder.embed_documents(dense_inputs)
            sparse = [services.sparse.encode_document(c.text) for c in chunks]

            await services.vector_store.delete_document(document.id)
            await services.vector_store.upsert_chunks(
                ChunkMetadata(
                    document_id=document.id,
                    owner_id=document.owner_id,
                    filename=document.filename,
                    file_type=document.file_type,
                    tags=list(document.tags or []),
                ),
                chunks,
                dense,
                sparse,
            )
            document.status = DocumentStatus.READY
            document.error = None
            document.chunk_count = len(chunks)
            document.page_count = sum(1 for p in pages if p.page is not None) or None
            logger.info(
                "Ingested document %s: %d chunks in %.0f ms",
                document.id,
                len(chunks),
                (time.perf_counter() - started) * 1000,
            )
        except Exception as exc:
            message = str(exc) if isinstance(exc, ParsingError) else "Processing failed."
            if not isinstance(exc, ParsingError):
                logger.exception("Ingestion failed for document %s", document_id)
            document.status = DocumentStatus.FAILED
            document.error = message
            document.chunk_count = 0
            await services.vector_store.delete_document(document.id)

        try:
            await session.commit()
        except Exception:
            # The document may have been deleted while it was being processed.
            logger.warning("Could not save ingestion result for %s; cleaning up", document_id)
            await session.rollback()
            await services.vector_store.delete_document(document_id)
            return

    # Deleted mid-flight? Then the vectors we just wrote are orphans.
    async with services.session_factory() as session:
        if await session.get(Document, document_id) is None:
            await services.vector_store.delete_document(document_id)


async def calibrate_documents(services: Services, document_ids: list[str]) -> None:
    """Process a calibration batch one document at a time.

    Sequential on purpose: embedding and reranking models are CPU-bound, and one
    failing document must not stop the rest of the batch.
    """
    started = time.perf_counter()
    for document_id in document_ids:
        await ingest_document(services, document_id)
    logger.info(
        "Calibrated %d documents in %.0f ms", len(document_ids), (time.perf_counter() - started) * 1000
    )
