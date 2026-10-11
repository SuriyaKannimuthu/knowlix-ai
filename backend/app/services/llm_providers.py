"""LLM provider catalog, client factory, and per-request model selection.

Users can pick a provider and model per question and bring their own API key.
The key arrives in a request header, is used for that one request, and is never
stored or logged. Without a user key, the server's own key for that provider
(if configured) is used.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

from app.core.config import Settings
from app.services.generation import Generator, LLMClient
from app.services.llm_errors import LLMConfigError

PROVIDER_NAMES = {"anthropic": "Anthropic Claude", "openai": "OpenAI", "gemini": "Google Gemini"}


@dataclass(frozen=True)
class ModelOption:
    id: str
    label: str


@dataclass(frozen=True)
class ProviderInfo:
    id: str
    name: str
    default_model: str
    models: tuple[ModelOption, ...]
    key_prefix: str
    key_url: str


PROVIDERS: dict[str, ProviderInfo] = {
    "anthropic": ProviderInfo(
        id="anthropic",
        name="Anthropic Claude",
        default_model="claude-opus-5-5",
        models=(
            ModelOption("claude-opus-5-5", "Claude Opus 5.5"),
            ModelOption("claude-sonnet-5-5", "Claude Sonnet 5.5"),
            ModelOption("claude-haiku-5-5", "Claude Haiku 5.5"),
        ),
        key_prefix="sk-ant-",
        key_url="https://console.anthropic.com/settings/keys",
    ),
    "openai": ProviderInfo(
        id="openai",
        name="OpenAI",
        default_model="gpt-4.1-mini",
        models=(ModelOption("gpt-4.1-mini", "GPT-4.1 mini"), ModelOption("gpt-4.1", "GPT-4.1")),
        key_prefix="sk-",
        key_url="https://platform.openai.com/api-keys",
    ),
    "gemini": ProviderInfo(
        id="gemini",
        name="Google Gemini",
        default_model="gemini-2.5-flash",
        models=(
            ModelOption("gemini-2.5-flash", "Gemini 2.5 Flash"),
            ModelOption("gemini-2.5-pro", "Gemini 2.5 Pro"),
        ),
        key_prefix="",
        key_url="https://aistudio.google.com/apikey",
    ),
}


def server_key(settings: Settings, provider: str) -> str | None:
    secret = {
        "anthropic": settings.anthropic_api_key,
        "openai": settings.openai_api_key,
        "gemini": settings.gemini_api_key,
    }.get(provider)
    return secret.get_secret_value() if secret else None


def create_llm(settings: Settings, provider: str, model: str | None, api_key: str | None) -> LLMClient:
    if provider == "anthropic":
        from app.services.anthropic_llm import AnthropicClient

        return AnthropicClient(settings, model, api_key)
    if provider == "openai":
        from app.services.openai_llm import OpenAIClient

        return OpenAIClient(settings, model, api_key)
    if provider == "gemini":
        from app.services.gemini_llm import GeminiClient

        return GeminiClient(settings, model, api_key)
    raise LLMConfigError(f"Unknown LLM provider: {provider}")


def default_model(settings: Settings) -> tuple[str, str]:
    """The server-default (provider, model)."""
    if settings.llm_provider == "extractive":
        return "extractive", "extractive"
    return settings.llm_provider, settings.llm_model or PROVIDERS[settings.llm_provider].default_model


def build_default_llm(settings: Settings) -> LLMClient | None:
    """A long-lived client for the default model, if the server holds a key for it.

    Without a server key, requests for the default model need the user's own key
    and get a short-lived client instead (see `generator_for`).
    """
    provider, model = default_model(settings)
    if provider == "extractive":
        return None
    key = server_key(settings, provider)
    return create_llm(settings, provider, model, key) if key else None


def resolve_key(settings: Settings, provider: str, user_key: str | None) -> str:
    if user_key:
        if not settings.allow_user_llm_keys:
            raise LLMConfigError("This server does not accept user-supplied API keys.")
        return user_key
    key = server_key(settings, provider)
    if not key:
        raise LLMConfigError(f"Enter your {PROVIDER_NAMES[provider]} API key to use this model.")
    return key


@asynccontextmanager
async def generator_for(
    default: Generator,
    settings: Settings,
    provider: str | None,
    model: str | None,
    user_key: str | None,
) -> AsyncIterator[Generator]:
    """The generator for one request: the server default, or a short-lived client.

    `provider=None` means "the server default"; the user's key, if sent, applies to it.
    """
    if provider is None:
        provider, default_id = default_model(settings)
        # The long-lived default client (built when the server holds a key) serves
        # everyone who hasn't sent their own key.
        if not user_key and (default.llm is not None or provider == "extractive"):
            yield default
            return
        model = model or default_id
    if provider == "extractive":
        yield Generator(None)
        return
    if provider not in PROVIDERS:
        raise LLMConfigError(f"Unknown LLM provider: {provider}")

    model = model or PROVIDERS[provider].default_model
    if (
        not user_key
        and default.llm is not None
        and (getattr(default.llm, "provider", None) == provider and default.llm.model == model)
    ):
        yield default
        return

    client = create_llm(settings, provider, model, resolve_key(settings, provider, user_key))
    try:
        yield Generator(client)
    finally:
        await client.aclose()


async def list_models_with_key(settings: Settings, provider: str, user_key: str | None) -> list[str]:
    """Verify a key by listing the models it can use. Model listing costs no tokens."""
    if provider not in PROVIDERS:
        raise LLMConfigError(f"Unknown LLM provider: {provider}")
    client = create_llm(settings, provider, None, resolve_key(settings, provider, user_key))
    try:
        return await client.list_models()
    finally:
        await client.aclose()
