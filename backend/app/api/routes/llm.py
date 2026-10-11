from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException

from app.api.deps import CurrentUser, ServicesDep, chat_rate_limit
from app.schemas.chat import (
    DefaultModelOut,
    ModelOptionOut,
    ProviderOut,
    ProvidersResponse,
    VerifyKeyRequest,
    VerifyKeyResponse,
)
from app.services.llm_errors import LLMError
from app.services.llm_providers import PROVIDERS, default_model, list_models_with_key, server_key

router = APIRouter(prefix="/llm", tags=["llm"])


@router.get("/providers", response_model=ProvidersResponse)
async def providers(_: CurrentUser, services: ServicesDep) -> ProvidersResponse:
    """Models the UI can offer, and whether the server holds a key for each provider."""
    settings = services.settings
    provider, model = default_model(settings)
    return ProvidersResponse(
        default=DefaultModelOut(provider=provider, model=model),
        allow_user_keys=settings.allow_user_llm_keys,
        providers=[
            ProviderOut(
                id=info.id,  # type: ignore[arg-type]
                name=info.name,
                default_model=info.default_model,
                models=[ModelOptionOut(id=m.id, label=m.label) for m in info.models],
                server_key_configured=server_key(settings, info.id) is not None,
                key_prefix=info.key_prefix,
                key_url=info.key_url,
            )
            for info in PROVIDERS.values()
        ],
    )


@router.post("/verify", response_model=VerifyKeyResponse, dependencies=[Depends(chat_rate_limit)])
async def verify_key(
    body: VerifyKeyRequest,
    _: CurrentUser,
    services: ServicesDep,
    llm_api_key: Annotated[str | None, Header(alias="X-LLM-API-Key", max_length=512)] = None,
) -> VerifyKeyResponse:
    """Check a key by listing the models it can use. This makes no billable model call."""
    try:
        models = await list_models_with_key(
            services.settings, body.provider, (llm_api_key or "").strip() or None
        )
    except LLMError as exc:
        raise HTTPException(exc.status_code, exc.message) from None
    return VerifyKeyResponse(provider=body.provider, valid=True, models=models)
