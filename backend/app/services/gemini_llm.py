"""Google Gemini client for grounded answer generation."""

from typing import NoReturn

from google import genai
from google.genai import errors, types

from app.core.config import Settings
from app.services.llm_errors import LLMAuthError, LLMModelError, LLMRateLimitError, LLMUnavailableError

DEFAULT_MODEL = "gemini-2.5-flash"


def _translate(exc: errors.APIError) -> NoReturn:
    code = exc.code
    if code in (401, 403) or (code == 400 and "API key" in (exc.message or "")):
        raise LLMAuthError("Google rejected the API key. Check that it is correct and active.") from exc
    if code == 404:
        raise LLMModelError("Google doesn't recognise this model for your key.") from exc
    if code == 429:
        raise LLMRateLimitError("Gemini rate limit or quota reached. Try again later.") from exc
    if code == 400:
        raise LLMModelError(f"Gemini rejected the request: {exc.message}") from exc
    raise LLMUnavailableError("Gemini did not respond. Please try again in a moment.") from exc


class GeminiClient:
    provider = "gemini"

    def __init__(self, settings: Settings, model: str | None = None, api_key: str | None = None) -> None:
        self.model = model or settings.llm_model or DEFAULT_MODEL
        self.settings = settings
        self._client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(
                timeout=int(settings.llm_timeout_seconds * 1000),
                retry_options=types.HttpRetryOptions(attempts=settings.llm_max_retries + 1),
            ),
        )

    async def complete(self, system: str, user: str) -> tuple[str, int, int]:
        try:
            response = await self._client.aio.models.generate_content(
                model=self.model,
                contents=user,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    temperature=self.settings.llm_temperature,
                    max_output_tokens=self.settings.llm_max_output_tokens,
                ),
            )
        except errors.APIError as exc:
            _translate(exc)
        usage = response.usage_metadata
        return (
            response.text or "",
            (usage.prompt_token_count or 0) if usage else 0,
            (usage.candidates_token_count or 0) if usage else 0,
        )

    async def list_models(self) -> list[str]:
        try:
            pager = await self._client.aio.models.list()
            models = [m async for m in pager]
        except errors.APIError as exc:
            _translate(exc)
        names = [
            (m.name or "").removeprefix("models/")
            for m in models
            if "generateContent" in (m.supported_actions or [])
        ]
        return sorted(n for n in names if n.startswith("gemini"))

    async def aclose(self) -> None:
        await self._client.aio.aclose()
