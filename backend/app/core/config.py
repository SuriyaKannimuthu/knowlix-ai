from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_JWT_SECRET = "dev-only-insecure-jwt-secret-change-me-in-production"


class Settings(BaseSettings):
    """Application settings, read from environment variables or `.env`."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Knowlix AI"
    environment: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    # Relational database (async SQLAlchemy). Use postgresql+asyncpg:// in production.
    database_url: str = "sqlite+aiosqlite:///./data/knowlix.db"
    auto_create_tables: bool = True

    # Vector database. If QDRANT_URL is set a Qdrant server is used, otherwise
    # Qdrant runs embedded at QDRANT_PATH (":memory:" keeps it in RAM).
    qdrant_url: str | None = None
    qdrant_api_key: SecretStr | None = None
    qdrant_path: str = "./data/qdrant"
    qdrant_collection: str = "knowlix_chunks"

    # Uploads
    upload_dir: Path = Path("./data/uploads")
    max_upload_mb: int = Field(default=20, ge=1, le=200)

    # Auth
    jwt_secret: SecretStr = SecretStr(DEFAULT_JWT_SECRET)
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = Field(default=12 * 60, ge=5)

    # Embeddings: local ONNX models via FastEmbed, hosted APIs, or a hashing
    # embedder that needs no model download (tests / offline development).
    embedding_provider: Literal["fastembed", "openai", "gemini", "hash"] = "fastembed"
    embedding_model: str = ""
    embedding_batch_size: int = Field(default=64, ge=1, le=512)
    model_cache_dir: Path = Path("./data/models")  # FastEmbed model downloads

    # Reranking
    reranker_provider: Literal["cross-encoder", "none"] = "cross-encoder"
    reranker_model: str = "Xenova/ms-marco-MiniLM-L-6-v2"

    # Generation: the server-default model. Users can pick another provider/model in
    # the UI. Without a server key for the default provider, users supply their own.
    # "extractive" (quote passages, no LLM) exists only for offline tests.
    llm_provider: Literal["anthropic", "openai", "gemini", "extractive"] = "gemini"
    llm_model: str = ""
    anthropic_api_key: SecretStr | None = None
    openai_api_key: SecretStr | None = None
    gemini_api_key: SecretStr | None = None

    # Claude-specific. Opus 5.5 always thinks, and thinking tokens count toward
    # max_tokens, so it gets a larger budget than LLM_MAX_OUTPUT_TOKENS. Response
    # depth is set with effort; sampling parameters such as temperature are rejected.
    anthropic_effort: Literal["low", "medium", "high", "xhigh", "max"] = "medium"
    anthropic_max_tokens: int = Field(default=16000, ge=1024, le=64000)
    # Server-side refusal fallback: if a safety classifier declines the request,
    # the API re-runs it on Anthropic's recommended fallback model in the same call.
    anthropic_refusal_fallback: bool = True

    # Let users choose a provider and model in the UI and send their own API key
    # with each request (header X-LLM-API-Key). Keys are used once, never stored.
    allow_user_llm_keys: bool = True
    llm_temperature: float = Field(default=0.1, ge=0, le=2)
    llm_max_output_tokens: int = Field(default=800, ge=64, le=8192)
    llm_timeout_seconds: float = Field(default=60, gt=0)
    llm_max_retries: int = Field(default=2, ge=0, le=6)

    # Chunking (characters)
    chunk_size: int = Field(default=1000, ge=200, le=8000)
    chunk_overlap: int = Field(default=150, ge=0)

    # Retrieval
    retrieval_mode: Literal["hybrid", "dense", "sparse"] = "hybrid"
    retrieval_candidates: int = Field(default=30, ge=1, le=200)
    rerank_candidates: int = Field(default=20, ge=1, le=100)
    top_k: int = Field(default=5, ge=1, le=20)
    rrf_k: int = Field(default=60, ge=1)

    # Evidence thresholds. Below these the assistant refuses instead of answering.
    # Cross-encoder logit. Calibrated on ms-marco-MiniLM-L-6-v2: answerable paraphrases
    # scored -1.1..6.3 and off-topic questions -6.6..-11.2 (see tests/test_models.py).
    min_rerank_score: float = -4.0
    min_dense_score: float = 0.6  # cosine similarity, used when reranking is off
    min_lexical_coverage: float = 0.6  # share of question terms found in a passage

    # Abuse protection
    chat_rate_limit_per_minute: int = Field(default=20, ge=1)

    @model_validator(mode="after")
    def _check(self) -> "Settings":
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("CHUNK_OVERLAP must be smaller than CHUNK_SIZE")
        if self.environment == "production":
            secret = self.jwt_secret.get_secret_value()
            if secret == DEFAULT_JWT_SECRET or len(secret) < 32:
                raise ValueError("Set JWT_SECRET to a random value of at least 32 characters")
        if self.embedding_provider == "openai" and not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai")
        if self.embedding_provider == "gemini" and not self.gemini_api_key:
            raise ValueError("GEMINI_API_KEY is required when EMBEDDING_PROVIDER=gemini")
        return self

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
