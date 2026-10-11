import asyncio
from typing import Protocol

from app.core.config import Settings


class Reranker(Protocol):
    name: str

    async def score(self, query: str, passages: list[str]) -> list[float]: ...


class CrossEncoderReranker:
    """Scores (query, passage) pairs jointly. Slower than vector search, but much sharper."""

    def __init__(self, model: str, cache_dir: str | None = None) -> None:
        from fastembed.rerank.cross_encoder import TextCrossEncoder

        self.name = model
        self._model = TextCrossEncoder(model_name=model, cache_dir=cache_dir)

    async def score(self, query: str, passages: list[str]) -> list[float]:
        if not passages:
            return []
        return await asyncio.to_thread(lambda: [float(s) for s in self._model.rerank(query, passages)])


def build_reranker(settings: Settings) -> Reranker | None:
    if settings.reranker_provider == "cross-encoder":
        return CrossEncoderReranker(settings.reranker_model, str(settings.model_cache_dir))
    return None
