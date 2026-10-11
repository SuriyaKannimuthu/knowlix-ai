import logging
import time
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.api.deps import CurrentUser, ServicesDep, SessionDep, chat_rate_limit
from app.database.models import Document, DocumentStatus, User
from app.schemas.chat import (
    ChatRequest,
    ChatResponse,
    SearchHit,
    SearchRequest,
    SearchResponse,
    Source,
    Usage,
)
from app.schemas.documents import MetadataFilters
from app.services.access import readable_documents
from app.services.generation import NO_DOCUMENTS_MESSAGE, REFUSAL_MESSAGE
from app.services.llm_errors import LLMError
from app.services.llm_providers import generator_for
from app.services.vector_store import SearchFilter

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])


async def _build_filter(
    session: SessionDep, user: User, filters: MetadataFilters, document_id: str | None
) -> SearchFilter:
    """Intersect the requested scope with what the user may read and what is ready."""
    documents, _ = await readable_documents(session, user)
    readable: dict[str, Document] = {d.id: d for d in documents}

    requested = set(filters.document_ids)
    if document_id:
        requested.add(document_id)

    if requested:
        # Unknown and forbidden ids look the same, so existence is not leaked.
        if missing := requested - readable.keys():
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"Document not found: {sorted(missing)[0]}")
        not_ready = [readable[i].filename for i in requested if readable[i].status != DocumentStatus.READY]
        if not_ready:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Not calibrated yet: {', '.join(sorted(not_ready))}. Press Calibrate first.",
            )
        scope = sorted(requested)
    else:
        scope = [d.id for d in documents if d.status == DocumentStatus.READY]

    return SearchFilter(document_ids=scope, file_types=filters.file_types, tags=filters.tags)


@router.post("/chat", response_model=ChatResponse, dependencies=[Depends(chat_rate_limit)])
async def chat(
    body: ChatRequest,
    user: CurrentUser,
    session: SessionDep,
    services: ServicesDep,
    llm_api_key: Annotated[
        str | None,
        Header(alias="X-LLM-API-Key", max_length=512, description="Your own key for the chosen provider."),
    ] = None,
) -> ChatResponse:
    """Answer a question from the user's documents, with citations, or refuse."""
    started = time.perf_counter()
    search_filter = await _build_filter(session, user, body.filters, body.document_id)

    def elapsed() -> int:
        return int((time.perf_counter() - started) * 1000)

    try:
        async with generator_for(
            services.generator,
            services.settings,
            body.llm.provider if body.llm else None,
            body.llm.model if body.llm else None,
            (llm_api_key or "").strip() or None,
        ) as generator:
            model = generator.model
            if not search_filter.document_ids:
                return ChatResponse(
                    answer=NO_DOCUMENTS_MESSAGE, sources=[], refused=True, model=model, latency_ms=elapsed()
                )

            retrieval = await services.retriever.retrieve(body.question, search_filter, body.top_k)
            if not retrieval.has_evidence:
                logger.info("chat refused (no evidence) user=%s latency_ms=%d", user.id, elapsed())
                return ChatResponse(
                    answer=REFUSAL_MESSAGE, sources=[], refused=True, model=model, latency_ms=elapsed()
                )

            generation = await generator.generate(body.question, retrieval.passages)
    except LLMError as exc:
        raise HTTPException(exc.status_code, exc.message) from None

    sources = [
        Source(
            index=new_index,
            document_id=passage.document_id,
            document=passage.filename,
            page=passage.page,
            chunk_index=passage.chunk_index,
            content=passage.text,
            score=passage.relevance,
        )
        for new_index, passage in enumerate((retrieval.passages[i - 1] for i in generation.cited), start=1)
    ]
    usage = Usage(
        prompt_tokens=generation.prompt_tokens,
        completion_tokens=generation.completion_tokens,
        total_tokens=generation.prompt_tokens + generation.completion_tokens,
    )
    latency = elapsed()
    logger.info(
        "chat user=%s model=%s own_key=%s refused=%s passages=%d cited=%d "
        "prompt_tokens=%d completion_tokens=%d latency_ms=%d",
        user.id,
        generation.model,
        bool(llm_api_key),
        generation.refused,
        len(retrieval.passages),
        len(sources),
        usage.prompt_tokens,
        usage.completion_tokens,
        latency,
    )
    return ChatResponse(
        answer=generation.answer,
        sources=sources,
        refused=generation.refused,
        model=generation.model,
        usage=usage if generation.model != "extractive" else None,
        latency_ms=latency,
    )


@router.post("/search", response_model=SearchResponse, dependencies=[Depends(chat_rate_limit)])
async def search(
    body: SearchRequest, user: CurrentUser, session: SessionDep, services: ServicesDep
) -> SearchResponse:
    """Retrieval only, with every intermediate score. Useful for debugging and evaluation."""
    started = time.perf_counter()
    search_filter = await _build_filter(session, user, body.filters, None)
    retrieval = await services.retriever.retrieve(body.query, search_filter, body.top_k)
    hits = [
        SearchHit(
            document_id=c.document_id,
            document=c.filename,
            page=c.page,
            chunk_index=c.chunk_index,
            content=c.text,
            dense_score=c.dense_score,
            sparse_score=c.sparse_score,
            fused_score=c.fused_score,
            rerank_score=c.rerank_score,
            passes_evidence_threshold=c.passes,
        )
        for c in retrieval.candidates[: body.top_k or services.settings.top_k]
    ]
    return SearchResponse(
        hits=hits,
        mode=services.settings.retrieval_mode,
        reranked=retrieval.reranked,
        latency_ms=int((time.perf_counter() - started) * 1000),
    )
