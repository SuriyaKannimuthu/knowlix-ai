"""OpenAI client for grounded answer generation."""

from typing import NoReturn

import openai

from app.core.config import Settings
from app.services.llm_errors import LLMAuthError, LLMModelError, LLMRateLimitError, LLMUnavailableError

DEFAULT_MODEL = "gpt-4.1-mini"
_CHAT_PREFIXES = ("gpt-", "o1", "o3", "o4", "chatgpt")
_NON_CHAT = ("audio", "realtime", "transcribe", "tts", "image", "search", "embedding", "moderation")


def _translate(exc: Exception) -> NoReturn:
    if isinstance(exc, openai.AuthenticationError | openai.PermissionDeniedError):
        raise LLMAuthError("OpenAI rejected the API key. Check that it is correct and active.") from exc
    if isinstance(exc, openai.NotFoundError):
        raise LLMModelError("OpenAI doesn't recognise this model for your key.") from exc
    if isinstance(exc, openai.RateLimitError):
        raise LLMRateLimitError("OpenAI rate limit or quota reached. Try again later.") from exc
    if isinstance(exc, openai.BadRequestError):
        raise LLMModelError(f"OpenAI rejected the request: {exc.message}") from exc
    if isinstance(exc, openai.APIStatusError | openai.APIConnectionError):
        raise LLMUnavailableError("OpenAI did not respond. Please try again in a moment.") from exc
    raise exc


class OpenAIClient:
    provider = "openai"

    def __init__(self, settings: Settings, model: str | None = None, api_key: str | None = None) -> None:
        self.model = model or settings.llm_model or DEFAULT_MODEL
        self.settings = settings
        self._client = openai.AsyncOpenAI(
            api_key=api_key,
            timeout=settings.llm_timeout_seconds,
            max_retries=settings.llm_max_retries,
        )

    async def complete(self, system: str, user: str) -> tuple[str, int, int]:
        try:
            response = await self._client.chat.completions.create(
                model=self.model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=self.settings.llm_temperature,
                max_completion_tokens=self.settings.llm_max_output_tokens,
            )
        except openai.OpenAIError as exc:
            _translate(exc)
        usage = response.usage
        return (
            response.choices[0].message.content or "",
            usage.prompt_tokens if usage else 0,
            usage.completion_tokens if usage else 0,
        )

    async def list_models(self) -> list[str]:
        try:
            ids = [model.id async for model in self._client.models.list()]
        except openai.OpenAIError as exc:
            _translate(exc)
        return sorted(
            i for i in ids if i.startswith(_CHAT_PREFIXES) and not any(word in i for word in _NON_CHAT)
        )

    async def aclose(self) -> None:
        await self._client.close()
