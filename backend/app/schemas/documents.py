from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

FileType = Literal["pdf", "docx", "txt", "md"]
AccessLevel = Literal["owner", "shared", "organization"]
VisibilityLiteral = Literal["private", "organization"]

MAX_TAGS = 20


def clean_tags(tags: list[str]) -> list[str]:
    seen: list[str] = []
    for tag in tags:
        value = tag.strip().lower()[:40]
        if value and value not in seen:
            seen.append(value)
    if len(seen) > MAX_TAGS:
        raise ValueError(f"At most {MAX_TAGS} tags are allowed")
    return seen


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    file_type: str
    content_type: str
    size_bytes: int
    status: str
    error: str | None
    chunk_count: int
    page_count: int | None
    tags: list[str]
    visibility: str
    owner_id: str
    access: AccessLevel = "owner"
    created_at: datetime
    updated_at: datetime


class CalibrateResponse(BaseModel):
    queued: int
    document_ids: list[str]


class DocumentUpdate(BaseModel):
    tags: list[str] | None = None
    visibility: VisibilityLiteral | None = None

    @field_validator("tags")
    @classmethod
    def _tags(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else clean_tags(value)


class ShareCreate(BaseModel):
    email: EmailStr


class ShareOut(BaseModel):
    user_id: str
    email: str
    full_name: str | None
    created_at: datetime


class MetadataFilters(BaseModel):
    """Optional narrowing applied on top of the user's access rights."""

    document_ids: list[str] = Field(default_factory=list, max_length=100)
    file_types: list[FileType] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list, max_length=MAX_TAGS)

    @field_validator("tags")
    @classmethod
    def _tags(cls, value: list[str]) -> list[str]:
        return clean_tags(value)
