from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.documents import MetadataFilters

ProviderId = Literal["anthropic", "openai", "gemini"]
MODEL_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$"


class LLMSelection(BaseModel):
    """Which model answers. The API key, if any, goes in the X-LLM-API-Key header."""

    provider: ProviderId
    model: str | None = Field(default=None, pattern=MODEL_ID_PATTERN)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    document_id: str | None = Field(
        default=None, description="Shorthand for filters.document_ids=[document_id]."
    )
    filters: MetadataFilters = Field(default_factory=MetadataFilters)
    top_k: int | None = Field(default=None, ge=1, le=20)
    llm: LLMSelection | None = Field(default=None, description="Omit to use the server's default model.")

    @field_validator("question")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Question must not be blank")
        return value


class Source(BaseModel):
    index: int = Field(description="Matches the [n] citation markers in the answer.")
    document_id: str
    document: str = Field(description="Filename of the source document.")
    page: int | None
    chunk_index: int
    content: str
    score: float | None = Field(description="Relevance in [0, 1].")


class Usage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class ChatResponse(BaseModel):
    answer: str
    sources: list[Source]
    refused: bool = Field(description="True when the documents lacked enough evidence.")
    model: str
    usage: Usage | None = None
    latency_ms: int


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    filters: MetadataFilters = Field(default_factory=MetadataFilters)
    top_k: int | None = Field(default=None, ge=1, le=50)


class SearchHit(BaseModel):
    document_id: str
    document: str
    page: int | None
    chunk_index: int
    content: str
    dense_score: float | None
    sparse_score: float | None
    fused_score: float
    rerank_score: float | None
    passes_evidence_threshold: bool


class SearchResponse(BaseModel):
    hits: list[SearchHit]
    mode: str
    reranked: bool
    latency_ms: int


class ModelOptionOut(BaseModel):
    id: str
    label: str


class ProviderOut(BaseModel):
    id: ProviderId
    name: str
    default_model: str
    models: list[ModelOptionOut]
    server_key_configured: bool
    key_prefix: str
    key_url: str


class DefaultModelOut(BaseModel):
    provider: str
    model: str


class ProvidersResponse(BaseModel):
    default: DefaultModelOut
    allow_user_keys: bool
    providers: list[ProviderOut]


class VerifyKeyRequest(BaseModel):
    provider: ProviderId


class VerifyKeyResponse(BaseModel):
    provider: ProviderId
    valid: bool
    models: list[str]
