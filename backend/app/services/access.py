"""Document-level access control. All read paths go through `readable_documents`."""

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models import Document, DocumentShare, User, Visibility


def access_level(document: Document, user: User, shared_ids: set[str]) -> str:
    if document.owner_id == user.id:
        return "owner"
    if document.id in shared_ids:
        return "shared"
    return "organization"


async def readable_documents(session: AsyncSession, user: User) -> tuple[list[Document], set[str]]:
    """Documents the user may read, plus the ids shared with them explicitly."""
    shared_subquery = select(DocumentShare.document_id).where(DocumentShare.user_id == user.id)
    stmt = (
        select(Document)
        .where(
            or_(
                Document.owner_id == user.id,
                Document.visibility == Visibility.ORGANIZATION,
                Document.id.in_(shared_subquery),
            )
        )
        .order_by(Document.created_at.desc())
    )
    documents = list((await session.scalars(stmt)).all())
    shared_ids = set((await session.scalars(shared_subquery)).all())
    return documents, shared_ids


async def get_readable_document(session: AsyncSession, user: User, document_id: str) -> Document | None:
    document = await session.get(Document, document_id)
    if document is None:
        return None
    if document.owner_id == user.id or document.visibility == Visibility.ORGANIZATION:
        return document
    share = await session.scalar(
        select(DocumentShare.id).where(
            DocumentShare.document_id == document_id, DocumentShare.user_id == user.id
        )
    )
    return document if share else None
