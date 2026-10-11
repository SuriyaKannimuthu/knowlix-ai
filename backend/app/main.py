import logging
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.api.routes import auth, chat, documents, health, llm
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.services.container import Services

logger = logging.getLogger("app.request")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.services = await Services.create(settings)
        try:
            yield
        finally:
            await app.state.services.close()

    app = FastAPI(
        title=f"{settings.app_name} API",
        version=__version__,
        description="Retrieval-augmented question answering over your documents, with citations.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type", "X-LLM-API-Key"],
        expose_headers=["X-Request-ID", "X-Response-Time-Ms", "Retry-After"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):  # type: ignore[no-untyped-def]
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:16]
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("Unhandled error id=%s %s %s", request_id, request.method, request.url.path)
            response = JSONResponse(
                {"detail": "Internal server error", "request_id": request_id}, status_code=500
            )
        elapsed_ms = (time.perf_counter() - started) * 1000
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Response-Time-Ms"] = f"{elapsed_ms:.0f}"
        logger.info(
            "%s %s -> %d (%.0f ms) id=%s",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
            request_id,
        )
        return response

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(documents.router)
    app.include_router(chat.router)
    app.include_router(llm.router)
    return app


app = create_app()
