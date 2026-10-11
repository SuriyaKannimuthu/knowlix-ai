from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.config import Settings
from app.main import create_app


def make_settings(tmp_path: Path, **overrides: object) -> Settings:
    """Offline configuration: SQLite, in-memory Qdrant, hashing embedder, no LLM."""
    values: dict[str, object] = {
        "environment": "test",
        "log_level": "WARNING",
        "database_url": f"sqlite+aiosqlite:///{(tmp_path / 'test.db').as_posix()}",
        "qdrant_path": ":memory:",
        "upload_dir": tmp_path / "uploads",
        "embedding_provider": "hash",
        "reranker_provider": "none",
        "llm_provider": "extractive",
        "chunk_size": 400,
        "chunk_overlap": 60,
        "min_dense_score": 0.5,
        "min_lexical_coverage": 0.6,
        "chat_rate_limit_per_minute": 1000,
        "jwt_secret": "test-secret-that-is-long-enough-for-hs256-signing",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)  # type: ignore[arg-type]


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return make_settings(tmp_path)


@pytest.fixture
async def app(settings: Settings) -> AsyncIterator[FastAPI]:
    application = create_app(settings)
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    # ASGITransport awaits the whole ASGI call, so background ingestion has
    # finished by the time an upload request returns.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        yield http
