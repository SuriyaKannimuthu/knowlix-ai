import hashlib
from pathlib import PurePath
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, ServicesDep, SessionDep
from app.database.models import Document, DocumentShare, DocumentStatus, User
from app.schemas.documents import (
    CalibrateResponse,
    DocumentOut,
    DocumentUpdate,
    ShareCreate,
    ShareOut,
    VisibilityLiteral,
    clean_tags,
)
from app.services.access import access_level, get_readable_document, readable_documents
from app.services.ingestion import calibrate_documents
from app.services.parsing import SUPPORTED_TYPES, matches_signature

router = APIRouter(prefix="/documents", tags=["documents"])

READ_BLOCK = 1024 * 1024


def _out(document: Document, user: User, shared_ids: set[str] | None = None) -> DocumentOut:
    out = DocumentOut.model_validate(document)
    out.access = access_level(document, user, shared_ids or set())  # type: ignore[assignment]
    return out


async def _owned_document(session: SessionDep, user: CurrentUser, document_id: str) -> Document:
    document = await get_readable_document(session, user, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    if document.owner_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner can change this document")
    return document


@router.post("/upload", response_model=DocumentOut, status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    user: CurrentUser,
    session: SessionDep,
    services: ServicesDep,
    file: Annotated[UploadFile, File(description="PDF, DOCX, TXT or Markdown file")],
    tags: Annotated[str, Form(description="Comma-separated tags")] = "",
    visibility: Annotated[VisibilityLiteral, Form()] = "private",
) -> DocumentOut:
    """Validate and store the file. It becomes searchable after `POST /documents/calibrate`.

    Uploading a file with the same name as one of your documents replaces it: the
    document keeps its id, shares and visibility, its old content is removed from the
    search index, and it waits for Calibrate again.
    """
    filename = PurePath(file.filename or "upload").name[:255]
    file_type = PurePath(filename).suffix.lower().lstrip(".")
    if file_type not in SUPPORTED_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "Unsupported file type. Upload a PDF, DOCX, TXT or Markdown file.",
        )

    limit = services.settings.max_upload_bytes
    data = bytearray()
    while block := await file.read(READ_BLOCK):
        data.extend(block)
        if len(data) > limit:
            raise HTTPException(
                status.HTTP_413_CONTENT_TOO_LARGE,
                f"File exceeds the {services.settings.max_upload_mb} MB limit.",
            )
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The file is empty.")
    if not matches_signature(file_type, bytes(data)):
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"The file content does not look like a valid .{file_type} file.",
        )

    try:
        tag_list = clean_tags(tags.split(",")) if tags else []
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    sha256 = hashlib.sha256(data).hexdigest()
    existing = await session.scalar(
        select(Document).where(Document.owner_id == user.id, Document.filename == filename)
    )

    if existing is not None:
        if existing.status == DocumentStatus.PROCESSING:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{filename} is being calibrated. Upload the new version when it finishes.",
            )
        if existing.sha256 == sha256:
            raise HTTPException(status.HTTP_409_CONFLICT, "You have already uploaded this file.")
        old_type = existing.file_type
        existing.file_type = file_type
        existing.content_type = SUPPORTED_TYPES[file_type]
        existing.size_bytes = len(data)
        existing.sha256 = sha256
        existing.status = DocumentStatus.UPLOADED
        existing.error = None
        existing.chunk_count = 0
        existing.page_count = None
        if tag_list:
            existing.tags = tag_list
        document = existing
    else:
        old_type = None
        document = Document(
            owner_id=user.id,
            filename=filename,
            file_type=file_type,
            content_type=SUPPORTED_TYPES[file_type],
            size_bytes=len(data),
            sha256=sha256,
            status=DocumentStatus.UPLOADED,
            tags=tag_list,
            visibility=visibility,
        )
        session.add(document)

    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "You have already uploaded this content under another name."
        ) from None

    if old_type is not None:
        # The old version must stop answering questions right away.
        await services.vector_store.delete_document(document.id)
        if old_type != file_type:
            await services.storage.delete(document.id, old_type)
    await services.storage.save(document.id, file_type, bytes(data))
    await session.commit()
    return _out(document, user)


@router.post("/calibrate", response_model=CalibrateResponse, status_code=status.HTTP_202_ACCEPTED)
async def calibrate(
    user: CurrentUser,
    session: SessionDep,
    services: ServicesDep,
    background: BackgroundTasks,
    all_documents: Annotated[
        bool, Query(alias="all", description="Also re-process documents that are already calibrated.")
    ] = False,
) -> CalibrateResponse:
    """Process every document you uploaded that isn't searchable yet (and retry failed ones).

    Each is parsed, cleaned, chunked and embedded into the search index in the
    background. Poll `GET /documents` for progress: statuses move to `ready`/`failed`.
    With `?all=true`, calibrated documents are rebuilt too.
    """
    statuses = [DocumentStatus.UPLOADED, DocumentStatus.FAILED]
    if all_documents:
        statuses.append(DocumentStatus.READY)
    pending = (
        await session.scalars(
            select(Document)
            .where(Document.owner_id == user.id, Document.status.in_(statuses))
            .order_by(Document.created_at)
        )
    ).all()
    for document in pending:
        document.status = DocumentStatus.PROCESSING
        document.error = None
    await session.commit()

    ids = [document.id for document in pending]
    if ids:
        background.add_task(calibrate_documents, services, ids)
    return CalibrateResponse(queued=len(ids), document_ids=ids)


@router.get("", response_model=list[DocumentOut])
async def list_documents(user: CurrentUser, session: SessionDep) -> list[DocumentOut]:
    """Every document the current user can read: owned, shared with them, or organization-wide."""
    documents, shared_ids = await readable_documents(session, user)
    return [_out(d, user, shared_ids) for d in documents]


@router.get("/{document_id}", response_model=DocumentOut)
async def get_document(document_id: str, user: CurrentUser, session: SessionDep) -> DocumentOut:
    document = await get_readable_document(session, user, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    shared_ids: set[str] = set()
    if document.owner_id != user.id:
        share = await session.scalar(
            select(DocumentShare.id).where(
                DocumentShare.document_id == document.id, DocumentShare.user_id == user.id
            )
        )
        if share:
            shared_ids.add(document.id)
    return _out(document, user, shared_ids)


@router.patch("/{document_id}", response_model=DocumentOut)
async def update_document(
    document_id: str, body: DocumentUpdate, user: CurrentUser, session: SessionDep, services: ServicesDep
) -> DocumentOut:
    document = await _owned_document(session, user, document_id)
    if body.visibility is not None:
        document.visibility = body.visibility
    if body.tags is not None:
        document.tags = body.tags
        # Tags are a retrieval filter, so keep the vector payload in sync.
        await services.vector_store.set_document_payload(document.id, {"tags": body.tags})
    await session.commit()
    return _out(document, user)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: str, user: CurrentUser, session: SessionDep, services: ServicesDep
) -> Response:
    document = await _owned_document(session, user, document_id)
    await services.vector_store.delete_document(document.id)
    await services.storage.delete(document.id, document.file_type)
    await session.delete(document)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{document_id}/shares", response_model=list[ShareOut])
async def list_shares(document_id: str, user: CurrentUser, session: SessionDep) -> list[ShareOut]:
    await _owned_document(session, user, document_id)
    rows = await session.execute(
        select(DocumentShare, User)
        .join(User, User.id == DocumentShare.user_id)
        .where(DocumentShare.document_id == document_id)
        .order_by(DocumentShare.created_at)
    )
    return [
        ShareOut(user_id=u.id, email=u.email, full_name=u.full_name, created_at=s.created_at)
        for s, u in rows.all()
    ]


@router.post("/{document_id}/shares", response_model=ShareOut, status_code=status.HTTP_201_CREATED)
async def share_document(
    document_id: str, body: ShareCreate, user: CurrentUser, session: SessionDep
) -> ShareOut:
    await _owned_document(session, user, document_id)
    target = await session.scalar(select(User).where(User.email == body.email.lower()))
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No user with that email")
    if target.id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You already own this document")
    share = DocumentShare(document_id=document_id, user_id=target.id)
    session.add(share)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Already shared with this user") from None
    return ShareOut(
        user_id=target.id, email=target.email, full_name=target.full_name, created_at=share.created_at
    )


@router.delete("/{document_id}/shares/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share(document_id: str, user_id: str, user: CurrentUser, session: SessionDep) -> Response:
    await _owned_document(session, user, document_id)
    share = await session.scalar(
        select(DocumentShare).where(
            DocumentShare.document_id == document_id, DocumentShare.user_id == user_id
        )
    )
    if share is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Share not found")
    await session.delete(share)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
