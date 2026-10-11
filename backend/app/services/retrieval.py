"""Hybrid retrieval: dense + sparse search, reciprocal rank fusion, reranking, evidence gate."""

import asyncio
import math
from dataclasses import dataclass, field

from app.core.config import Settings
from app.services.embeddings import DenseEmbedder, SparseEncoder
from app.services.reranker import Reranker
from app.services.text import lexical_coverage
from app.services.vector_store import ScoredChunk, SearchFilter, VectorStore


@dataclass
class Candidate:
    point_id: str
    document_id: str
    filename: str
    page: int | None
    chunk_index: int
    text: str
    dense_score: float | None = None
    sparse_score: float | None = None
    fused_score: float = 0.0
    rerank_score: float | None = None
    passes: bool = False

    @property
    def relevance(self) -> float | None:
        """A [0, 1] score for display: sigmoid of the rerank logit, else dense cosine."""
        if self.rerank_score is not None:
            return round(1 / (1 + math.exp(-self.rerank_score)), 4)
        if self.dense_score is not None:
            return round(max(0.0, min(1.0, self.dense_score)), 4)
        return None


@dataclass
class RetrievalResult:
    candidates: list[Candidate] = field(default_factory=list)  # ranked, before the evidence gate
    passages: list[Candidate] = field(default_factory=list)  # ranked, passed the gate, top_k
    reranked: bool = False

    @property
    def has_evidence(self) -> bool:
        return bool(self.passages)


def reciprocal_rank_fusion(rankings: list[list[ScoredChunk]], k: int) -> dict[str, float]:
    """RRF: each list contributes 1 / (k + rank). Robust to incomparable score scales."""
    fused: dict[str, float] = {}
    for ranking in rankings:
        for rank, hit in enumerate(ranking, start=1):
            fused[hit.point_id] = fused.get(hit.point_id, 0.0) + 1.0 / (k + rank)
    return fused


class Retriever:
    def __init__(
        self,
        settings: Settings,
        store: VectorStore,
        embedder: DenseEmbedder,
        sparse: SparseEncoder,
        reranker: Reranker | None,
    ) -> None:
        self.settings = settings
        self.store = store
        self.embedder = embedder
        self.sparse = sparse
        self.reranker = reranker

    async def _search(
        self, query: str, search_filter: SearchFilter
    ) -> tuple[list[ScoredChunk], list[ScoredChunk]]:
        mode = self.settings.retrieval_mode
        limit = self.settings.retrieval_candidates

        async def dense() -> list[ScoredChunk]:
            if mode == "sparse":
                return []
            vector = await self.embedder.embed_query(query)
            return await self.store.search_dense(vector, search_filter, limit)

        async def sparse() -> list[ScoredChunk]:
            if mode == "dense":
                return []
            return await self.store.search_sparse(self.sparse.encode_query(query), search_filter, limit)

        dense_hits, sparse_hits = await asyncio.gather(dense(), sparse())
        return dense_hits, sparse_hits

    def _passes(self, query: str, candidate: Candidate) -> bool:
        s = self.settings
        if candidate.rerank_score is not None:
            return candidate.rerank_score >= s.min_rerank_score
        dense_ok = candidate.dense_score is not None and candidate.dense_score >= s.min_dense_score
        return dense_ok or lexical_coverage(query, candidate.text) >= s.min_lexical_coverage

    async def retrieve(
        self, query: str, search_filter: SearchFilter, top_k: int | None = None
    ) -> RetrievalResult:
        top_k = top_k or self.settings.top_k
        if not search_filter.document_ids:
            return RetrievalResult()

        dense_hits, sparse_hits = await self._search(query, search_filter)
        fused = reciprocal_rank_fusion([dense_hits, sparse_hits], self.settings.rrf_k)

        by_id: dict[str, Candidate] = {}
        for hits, attr in ((dense_hits, "dense_score"), (sparse_hits, "sparse_score")):
            for hit in hits:
                candidate = by_id.get(hit.point_id)
                if candidate is None:
                    p = hit.payload
                    candidate = by_id[hit.point_id] = Candidate(
                        point_id=hit.point_id,
                        document_id=str(p.get("document_id", "")),
                        filename=str(p.get("filename", "")),
                        page=p.get("page"),
                        chunk_index=int(p.get("chunk_index", 0)),
                        text=str(p.get("text", "")),
                    )
                setattr(candidate, attr, hit.score)

        # Defence in depth: never surface a chunk outside the allowed documents,
        # even if the vector store filter were misconfigured.
        allowed = set(search_filter.document_ids)
        ranked = sorted(
            (c for c in by_id.values() if c.document_id in allowed),
            key=lambda c: fused[c.point_id],
            reverse=True,
        )[: self.settings.rerank_candidates]
        for candidate in ranked:
            candidate.fused_score = round(fused[candidate.point_id], 6)

        reranked = False
        if self.reranker is not None and ranked:
            scores = await self.reranker.score(query, [c.text for c in ranked])
            for candidate, score in zip(ranked, scores, strict=True):
                candidate.rerank_score = round(score, 4)
            ranked.sort(key=lambda c: c.rerank_score or 0.0, reverse=True)
            reranked = True

        for candidate in ranked:
            candidate.passes = self._passes(query, candidate)

        passages = [c for c in ranked if c.passes][:top_k]
        return RetrievalResult(candidates=ranked, passages=passages, reranked=reranked)
