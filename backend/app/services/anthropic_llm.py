"""Claude (Anthropic) client for grounded answer generation."""

import logging
from typing import NoReturn

import anthropic

from app.core.config import Settings
from app.services.llm_errors import (
    LLMAuthError,
    LLMDeclinedError,
    LLMModelError,
    LLMRateLimitError,
    LLMUnavailableError,
)

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-opus-5-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"

# Server-side refusal fallback (`fallbacks: "default"`) is offered on these models;
# others (for example Claude Haiku 5.5) have no server-side fallback.
FALLBACK_MODELS = frozenset({"claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"})
# `output_config.effort` is rejected by some older models (Haiku 4.5, Sonnet 4.5).
EFFORT_MODELS = frozenset(
    {
        "claude-fable-5-1",
        "claude-fable-5",
        "claude-opus-5-5",
        "claude-opus-5",
        "claude-opus-4-8",
        "claude-opus-4-7",
        "claude-opus-4-6",
        "claude-sonnet-5-5",
        "claude-sonnet-5",
        "claude-sonnet-4-6",
        "claude-haiku-5-5",
    }
)


def _translate(exc: Exception) -> NoReturn:
    """Map SDK exceptions to provider-neutral errors (most specific first)."""
    if isinstance(exc, anthropic.AuthenticationError | anthropic.PermissionDeniedError):
        raise LLMAuthError("Anthropic rejected the API key. Check that it is correct and active.") from exc
    if isinstance(exc, anthropic.NotFoundError):
        raise LLMModelError("Anthropic doesn't recognise this model for your key.") from exc
    if isinstance(exc, anthropic.RateLimitError):
        raise LLMRateLimitError("Anthropic rate limit reached. Wait a moment and try again.") from exc
    if isinstance(exc, anthropic.BadRequestError):
        raise LLMModelError(f"Anthropic rejected the request: {exc.message}") from exc
    if isinstance(exc, anthropic.APIStatusError | anthropic.APIConnectionError):
        raise LLMUnavailableError("Anthropic did not respond. Please try again in a moment.") from exc
    raise exc


class AnthropicClient:
    provider = "anthropic"

    def __init__(self, settings: Settings, model: str | None = None, api_key: str | None = None) -> None:
        self.model = model or settings.llm_model or DEFAULT_MODEL
        self.settings = settings
        # With no key, the SDK resolves credentials itself
        # (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile).
        self._client = anthropic.AsyncAnthropic(
            api_key=api_key,
            timeout=settings.llm_timeout_seconds,
            max_retries=settings.llm_max_retries,
        )

    async def complete(self, system: str, user: str) -> tuple[str, int, int]:
        request: dict = {
            "model": self.model,
            "max_tokens": self.settings.anthropic_max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        if self.model in EFFORT_MODELS:
            request["output_config"] = {"effort": self.settings.anthropic_effort}
        try:
            if self.settings.anthropic_refusal_fallback and self.model in FALLBACK_MODELS:
                response = await self._client.beta.messages.create(
                    **request, betas=[FALLBACK_BETA], fallbacks="default"
                )
            else:
                response = await self._client.messages.create(**request)
        except anthropic.AnthropicError as exc:
            _translate(exc)

        # A safety-classifier decline is an HTTP 200; check it before reading content.
        if response.stop_reason == "refusal":
            category = response.stop_details.category if response.stop_details else None
            logger.warning("Claude declined the request (category=%s, id=%s)", category, response.id)
            raise LLMDeclinedError(category)

        text = "".join(block.text for block in response.content if block.type == "text")
        if response.model != self.model:
            logger.info("Answer served by fallback model %s (requested %s)", response.model, self.model)
        if response.stop_reason == "max_tokens":
            logger.warning(
                "Claude hit max_tokens=%d (id=%s); raise ANTHROPIC_MAX_TOKENS if answers are cut off",
                self.settings.anthropic_max_tokens,
                response.id,
            )
            if not text.strip():
                raise LLMUnavailableError("Claude used its whole output budget before answering.")

        usage = response.usage
        prompt_tokens = (
            usage.input_tokens
            + (usage.cache_creation_input_tokens or 0)
            + (usage.cache_read_input_tokens or 0)
        )
        return text, prompt_tokens, usage.output_tokens

    async def list_models(self) -> list[str]:
        """Models this key can use. The Models API is free, so this also verifies the key."""
        try:
            return [model.id async for model in self._client.models.list(limit=100)]
        except anthropic.AnthropicError as exc:
            _translate(exc)

    async def aclose(self) -> None:
        await self._client.close()
