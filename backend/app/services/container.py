"""Long-lived service objects, built once at startup and shared across requests."""

import asyncio
import logging
from dataclasses import dataclass

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.rate_limit import SlidingWindowLimiter
from app.database.models import Document, DocumentStatus
from app.database.session import create_engine, create_session_factory, create_tables
from app.services.embeddings import DenseEmbedder, SparseEncoder, build_embedder
from app.services.generation import Generator
from app.services.llm_providers import build_default_llm, default_model, server_key
from app.services.reranker import build_reranker
from app.services.retrieval import Retriever
from app.services.storage import FileStorage
from app.services.vector_store import VectorStore

logger = logging.getLogger(__name__)


@dataclass
class Services:
    settings: Settings
    engine: AsyncEngine
    session_factory: async_sessionmaker[AsyncSession]
    storage: FileStorage
    vector_store: VectorStore
    embedder: DenseEmbedder
    sparse: SparseEncoder
    retriever: Retriever
    generator: Generator
    chat_limiter: SlidingWindowLimiter

    @classmethod
    async def create(cls, settings: Settings) -> "Services":
        engine = create_engine(settings.database_url)
        if settings.auto_create_tables:
            await create_tables(engine)
        # Calibration runs in-process; anything left "processing" by a restart is
        # returned to "uploaded" so the next Calibrate picks it up again.
        async with engine.begin() as connection:
            result = await connection.execute(
                update(Document)
                .where(Document.status == DocumentStatus.PROCESSING)
                .values(status=DocumentStatus.UPLOADED)
            )
            if result.rowcount:
                logger.warning("Reset %d interrupted documents to 'uploaded'", result.rowcount)

        # Model construction may download weights on first run; keep it off the event loop.
        embedder = await asyncio.to_thread(build_embedder, settings)
        reranker = await asyncio.to_thread(build_reranker, settings)
        dimension = len(await embedder.embed_query("dimension probe"))

        vector_store = VectorStore(settings)
        await vector_store.ensure_collection(dimension)

        sparse = SparseEncoder()
        generator = Generator(build_default_llm(settings))
        llm_provider, llm_model = default_model(settings)
        logger.info(
            "Services ready: embeddings=%s (dim=%d), reranker=%s, default llm=%s (%s), retrieval=%s",
            embedder.name,
            dimension,
            reranker.name if reranker else "none",
            llm_model,
            "server key" if server_key(settings, llm_provider) else "users supply keys",
            settings.retrieval_mode,
        )
        return cls(
            settings=settings,
            engine=engine,
            session_factory=create_session_factory(engine),
            storage=FileStorage(settings.upload_dir),
            vector_store=vector_store,
            embedder=embedder,
            sparse=sparse,
            retriever=Retriever(settings, vector_store, embedder, sparse, reranker),
            generator=generator,
            chat_limiter=SlidingWindowLimiter(settings.chat_rate_limit_per_minute),
        )

    async def close(self) -> None:
        await self.vector_store.close()
        await self.engine.dispose()
