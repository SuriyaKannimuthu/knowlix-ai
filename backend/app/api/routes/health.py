from fastapi import APIRouter, Response, status

from app import __version__
from app.api.deps import ServicesDep
from app.database.session import ping
from app.services.llm_providers import default_model

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(services: ServicesDep, response: Response) -> dict[str, object]:
    database_ok = await ping(services.engine)
    vector_ok = await services.vector_store.ping()
    healthy = database_ok and vector_ok
    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "ok" if healthy else "degraded",
        "version": __version__,
        "database": "ok" if database_ok else "unavailable",
        "vector_store": "ok" if vector_ok else "unavailable",
        "llm": default_model(services.settings)[1],
    }
