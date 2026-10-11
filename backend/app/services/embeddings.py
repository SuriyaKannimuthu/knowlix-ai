"""Dense embedding providers and the sparse (BM25-style) encoder used for hybrid search."""

import asyncio
import math
import zlib
from collections import Counter
from dataclasses import dataclass
from typing import Protocol

from app.core.config import Settings
from app.services.text import content_terms


class DenseEmbedder(Protocol):
    name: str

    async def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    async def embed_query(self, text: str) -> list[float]: ...


def _normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [v / norm for v in vector]


def _hash(token: str) -> int:
    return zlib.crc32(token.encode("utf-8"))


class HashEmbedder:
    """Deterministic feature-hashing embedder: no model download, no network.

    It captures word and character-trigram overlap, not meaning. It exists for
    tests and offline development; use a real model for anything else.
    """

    def __init__(self, dim: int = 384) -> None:
        self.dim = dim
        self.name = f"hash-{dim}"

    def _embed(self, text: str) -> list[float]:
        vector = [0.0] * self.dim
        for token in content_terms(text):
            features = [(token, 1.0)] + [
                (f"#{token[i : i + 3]}", 0.35) for i in range(max(1, len(token) - 2))
            ]
            for feature, weight in features:
                h = _hash(feature)
                vector[h % self.dim] += weight if (h >> 16) & 1 else -weight
        return _normalize(vector)

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._embed(text) for text in texts]

    async def embed_query(self, text: str) -> list[float]:
        return self._embed(text)


class FastEmbedEmbedder:
    """Local ONNX embedding models via FastEmbed (downloaded on first use)."""

    def __init__(self, model: str, batch_size: int, cache_dir: str | None = None) -> None:
        from fastembed import TextEmbedding

        self.name = model
        self.batch_size = batch_size
        self._model = TextEmbedding(model_name=model, cache_dir=cache_dir)

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        def run() -> list[list[float]]:
            return [v.tolist() for v in self._model.embed(texts, batch_size=self.batch_size)]

        return await asyncio.to_thread(run)

    async def embed_query(self, text: str) -> list[float]:
        def run() -> list[float]:
            return next(iter(self._model.query_embed(text))).tolist()

        return await asyncio.to_thread(run)


class OpenAIEmbedder:
    def __init__(self, settings: Settings, model: str) -> None:
        from openai import AsyncOpenAI

        assert settings.openai_api_key is not None
        self.name = model
        self.batch_size = min(settings.embedding_batch_size, 256)
        self._client = AsyncOpenAI(
            api_key=settings.openai_api_key.get_secret_value(),
            timeout=settings.llm_timeout_seconds,
            max_retries=settings.llm_max_retries,
        )

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(texts), self.batch_size):
            response = await self._client.embeddings.create(
                model=self.name, input=texts[start : start + self.batch_size]
            )
            vectors.extend(item.embedding for item in sorted(response.data, key=lambda d: d.index))
        return vectors

    async def embed_query(self, text: str) -> list[float]:
        return (await self.embed_documents([text]))[0]


class GeminiEmbedder:
    def __init__(self, settings: Settings, model: str, dimensions: int = 768) -> None:
        from google import genai
        from google.genai import types

        assert settings.gemini_api_key is not None
        self.name = model
        self.dimensions = dimensions
        self.batch_size = min(settings.embedding_batch_size, 100)
        self._types = types
        self._client = genai.Client(
            api_key=settings.gemini_api_key.get_secret_value(),
            http_options=types.HttpOptions(
                timeout=int(settings.llm_timeout_seconds * 1000),
                retry_options=types.HttpRetryOptions(attempts=settings.llm_max_retries + 1),
            ),
        )

    async def _embed(self, texts: list[str], task_type: str) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(texts), self.batch_size):
            response = await self._client.aio.models.embed_content(
                model=self.name,
                contents=texts[start : start + self.batch_size],
                config=self._types.EmbedContentConfig(
                    task_type=task_type, output_dimensionality=self.dimensions
                ),
            )
            # Truncated Gemini embeddings are not unit length, so normalize them.
            vectors.extend(_normalize(list(e.values or [])) for e in response.embeddings or [])
        return vectors

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return await self._embed(texts, "RETRIEVAL_DOCUMENT")

    async def embed_query(self, text: str) -> list[float]:
        return (await self._embed([text], "RETRIEVAL_QUERY"))[0]


DEFAULT_EMBEDDING_MODELS = {
    "fastembed": "BAAI/bge-small-en-v1.5",
    "openai": "text-embedding-3-small",
    "gemini": "gemini-embedding-001",
    "hash": "hash",
}


def build_embedder(settings: Settings) -> DenseEmbedder:
    provider = settings.embedding_provider
    model = settings.embedding_model or DEFAULT_EMBEDDING_MODELS[provider]
    if provider == "fastembed":
        return FastEmbedEmbedder(model, settings.embedding_batch_size, str(settings.model_cache_dir))
    if provider == "openai":
        return OpenAIEmbedder(settings, model)
    if provider == "gemini":
        return GeminiEmbedder(settings, model)
    return HashEmbedder()


@dataclass(frozen=True)
class SparseVectorData:
    indices: list[int]
    values: list[float]


class SparseEncoder:
    """BM25-style sparse vectors.

    Documents get saturated term-frequency weights. Qdrant applies IDF at query
    time (the collection uses `Modifier.IDF`), so together they score like BM25.
    This catches exact identifiers, names and codes that dense embeddings blur.
    """

    def __init__(self, k1: float = 1.2, b: float = 0.75, avg_doc_len: float = 180.0) -> None:
        self.k1 = k1
        self.b = b
        self.avg_doc_len = avg_doc_len

    def encode_document(self, text: str) -> SparseVectorData:
        terms = content_terms(text)
        counts = Counter(_hash(term) for term in terms)
        length_norm = 1 - self.b + self.b * (len(terms) / self.avg_doc_len)
        weights = {index: (tf * (self.k1 + 1)) / (tf + self.k1 * length_norm) for index, tf in counts.items()}
        indices = sorted(weights)
        return SparseVectorData(indices=indices, values=[weights[i] for i in indices])

    def encode_query(self, text: str) -> SparseVectorData:
        indices = sorted({_hash(term) for term in content_terms(text)})
        return SparseVectorData(indices=indices, values=[1.0] * len(indices))
