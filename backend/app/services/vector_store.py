"""Qdrant access: one collection with a named dense vector and a named sparse vector."""

import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from qdrant_client import AsyncQdrantClient, models

from app.core.config import Settings
from app.services.chunking import Chunk
from app.services.embeddings import SparseVectorData

logger = logging.getLogger(__name__)

DENSE = "dense"
SPARSE = "sparse"
UPSERT_BATCH = 128


@dataclass(frozen=True)
class ChunkMetadata:
    document_id: str
    owner_id: str
    filename: str
    file_type: str
    tags: list[str]


@dataclass
class ScoredChunk:
    point_id: str
    score: float
    payload: dict[str, Any]


@dataclass(frozen=True)
class SearchFilter:
    """Restricts a search. `document_ids` must already be limited to what the user may read."""

    document_ids: Sequence[str]
    file_types: Sequence[str] = ()
    tags: Sequence[str] = ()

    def to_qdrant(self) -> models.Filter:
        must: list[models.Condition] = [
            models.FieldCondition(key="document_id", match=models.MatchAny(any=list(self.document_ids)))
        ]
        if self.file_types:
            must.append(
                models.FieldCondition(key="file_type", match=models.MatchAny(any=list(self.file_types)))
            )
        if self.tags:
            must.append(models.FieldCondition(key="tags", match=models.MatchAny(any=list(self.tags))))
        return models.Filter(must=must)


def point_id(document_id: str, chunk_index: int) -> str:
    # Deterministic ids make re-ingestion overwrite instead of duplicate.
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"knowlix:{document_id}:{chunk_index}"))


class VectorStore:
    def __init__(self, settings: Settings) -> None:
        self.collection = settings.qdrant_collection
        self.is_server = bool(settings.qdrant_url)
        if settings.qdrant_url:
            self.client = AsyncQdrantClient(
                url=settings.qdrant_url,
                api_key=settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else None,
            )
        elif settings.qdrant_path == ":memory:":
            self.client = AsyncQdrantClient(location=":memory:")
        else:
            self.client = AsyncQdrantClient(path=settings.qdrant_path)

    async def ensure_collection(self, dimension: int) -> None:
        if await self.client.collection_exists(self.collection):
            info = await self.client.get_collection(self.collection)
            vectors = info.config.params.vectors
            existing = vectors.get(DENSE) if isinstance(vectors, dict) else None
            if existing is not None and existing.size != dimension:
                raise RuntimeError(
                    f"Qdrant collection '{self.collection}' stores {existing.size}-dim vectors but "
                    f"the embedding model produces {dimension}. Use a new QDRANT_COLLECTION "
                    "or re-ingest after deleting the old collection."
                )
            return

        await self.client.create_collection(
            collection_name=self.collection,
            vectors_config={DENSE: models.VectorParams(size=dimension, distance=models.Distance.COSINE)},
            sparse_vectors_config={SPARSE: models.SparseVectorParams(modifier=models.Modifier.IDF)},
        )
        if self.is_server:  # payload indexes are a no-op in embedded mode
            for field in ("document_id", "file_type", "tags", "owner_id"):
                await self.client.create_payload_index(
                    self.collection, field_name=field, field_schema=models.PayloadSchemaType.KEYWORD
                )
        logger.info("Created Qdrant collection %s (dim=%d)", self.collection, dimension)

    async def upsert_chunks(
        self,
        meta: ChunkMetadata,
        chunks: Sequence[Chunk],
        dense: Sequence[list[float]],
        sparse: Sequence[SparseVectorData],
    ) -> None:
        points = [
            models.PointStruct(
                id=point_id(meta.document_id, chunk.chunk_index),
                vector={
                    DENSE: vector,
                    SPARSE: models.SparseVector(indices=sv.indices, values=sv.values),
                },
                payload={
                    "document_id": meta.document_id,
                    "owner_id": meta.owner_id,
                    "filename": meta.filename,
                    "file_type": meta.file_type,
                    "tags": meta.tags,
                    "page": chunk.page,
                    "chunk_index": chunk.chunk_index,
                    "text": chunk.text,
                },
            )
            for chunk, vector, sv in zip(chunks, dense, sparse, strict=True)
        ]
        for start in range(0, len(points), UPSERT_BATCH):
            await self.client.upsert(self.collection, points=points[start : start + UPSERT_BATCH])

    def _document_selector(self, document_id: str) -> models.FilterSelector:
        return models.FilterSelector(
            filter=models.Filter(
                must=[models.FieldCondition(key="document_id", match=models.MatchValue(value=document_id))]
            )
        )

    async def delete_document(self, document_id: str) -> None:
        await self.client.delete(self.collection, points_selector=self._document_selector(document_id))

    async def set_document_payload(self, document_id: str, payload: dict[str, Any]) -> None:
        await self.client.set_payload(
            self.collection, payload=payload, points=self._document_selector(document_id)
        )

    async def search_dense(
        self, vector: list[float], search_filter: SearchFilter, limit: int
    ) -> list[ScoredChunk]:
        result = await self.client.query_points(
            self.collection,
            query=vector,
            using=DENSE,
            query_filter=search_filter.to_qdrant(),
            limit=limit,
            with_payload=True,
        )
        return [ScoredChunk(str(p.id), p.score, p.payload or {}) for p in result.points]

    async def search_sparse(
        self, vector: SparseVectorData, search_filter: SearchFilter, limit: int
    ) -> list[ScoredChunk]:
        if not vector.indices:
            return []
        result = await self.client.query_points(
            self.collection,
            query=models.SparseVector(indices=vector.indices, values=vector.values),
            using=SPARSE,
            query_filter=search_filter.to_qdrant(),
            limit=limit,
            with_payload=True,
        )
        return [ScoredChunk(str(p.id), p.score, p.payload or {}) for p in result.points]

    async def ping(self) -> bool:
        try:
            await self.client.collection_exists(self.collection)
            return True
        except Exception:
            return False

    async def close(self) -> None:
        await self.client.close()
