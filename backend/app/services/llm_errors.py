"""Provider-neutral errors raised by LLM clients.

Each carries the HTTP status the API should answer with and a message that is
safe to show users. 401 is deliberately not used: the frontend treats 401 as
"your session expired" and would sign the user out over a bad provider key.
"""


class LLMDeclinedError(Exception):
    """The model's safety system declined the request (not an evidence problem)."""

    def __init__(self, category: str | None = None) -> None:
        super().__init__(f"Request declined by the model (category={category})")
        self.category = category


class LLMError(Exception):
    status_code = 502

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class LLMConfigError(LLMError):
    """Missing key, unknown provider, user keys disabled..."""

    status_code = 400


class LLMAuthError(LLMError):
    """The provider rejected the API key."""

    status_code = 400


class LLMModelError(LLMError):
    """Unknown model, or a request the model does not accept."""

    status_code = 400


class LLMRateLimitError(LLMError):
    status_code = 429


class LLMUnavailableError(LLMError):
    """Timeout, outage or any other provider failure."""

    status_code = 502
