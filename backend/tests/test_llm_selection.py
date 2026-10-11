"""Per-request model selection with user-supplied API keys."""

import logging
from pathlib import Path

import anthropic
import httpx2
import openai
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from app.services import llm_providers
from app.services.anthropic_llm import AnthropicClient
from app.services.llm_errors import LLMAuthError, LLMRateLimitError
from app.services.openai_llm import OpenAIClient
from tests.conftest import make_settings
from tests.helpers import register, upload

POLICY = b"Employees must book economy class for flights shorter than six hours."
QUESTION = "Which class must employees book for short flights?"
SECRET = "sk-ant-SECRET-test-key-123"


class FakeLLM:
    instances: list["FakeLLM"] = []

    def __init__(self, provider: str, model: str, api_key: str, error: Exception | None = None) -> None:
        self.provider, self.model, self.api_key, self.error = provider, model, api_key, error
        self.closed = False
        FakeLLM.instances.append(self)

    async def complete(self, system: str, user: str) -> tuple[str, int, int]:
        if self.error:
            raise self.error
        return "Book economy class [1].", 300, 20

    async def list_models(self) -> list[str]:
        if self.error:
            raise self.error
        return ["claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5"]

    async def aclose(self) -> None:
        self.closed = True


@pytest.fixture
def fake_llm(monkeypatch: pytest.MonkeyPatch):
    FakeLLM.instances = []
    state: dict = {"error": None}

    def factory(settings, provider, model, api_key):
        return FakeLLM(provider, model, api_key, state["error"])

    monkeypatch.setattr(llm_providers, "create_llm", factory)
    return state


async def setup(client: AsyncClient) -> dict[str, str]:
    headers = await register(client, "alice@example.com")
    await upload(client, headers, "policy.txt", POLICY)
    return headers


async def test_providers_catalog(client: AsyncClient) -> None:
    assert (await client.get("/llm/providers")).status_code == 401
    headers = await register(client, "alice@example.com")
    body = (await client.get("/llm/providers", headers=headers)).json()
    assert body["default"] == {"provider": "extractive", "model": "extractive"}
    assert body["allow_user_keys"] is True
    ids = {p["id"]: p for p in body["providers"]}
    assert set(ids) == {"anthropic", "openai", "gemini"}
    assert ids["anthropic"]["default_model"] == "claude-opus-5-5"
    assert [m["id"] for m in ids["anthropic"]["models"]] == [
        "claude-opus-5-5",
        "claude-sonnet-5-5",
        "claude-haiku-5-5",
    ]
    assert ids["anthropic"]["server_key_configured"] is False


async def test_user_key_is_used_for_that_request_only(client: AsyncClient, fake_llm: dict) -> None:
    headers = await setup(client)
    response = await client.post(
        "/chat",
        headers={**headers, "X-LLM-API-Key": SECRET},
        json={"question": QUESTION, "llm": {"provider": "anthropic", "model": "claude-sonnet-5-5"}},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["model"] == "claude-sonnet-5-5"
    assert body["answer"] == "Book economy class [1]."
    assert body["usage"]["total_tokens"] == 320

    [llm] = FakeLLM.instances
    assert (llm.provider, llm.model, llm.api_key) == ("anthropic", "claude-sonnet-5-5", SECRET)
    assert llm.closed  # short-lived client is released

    # Without the selection, the server default answers again.
    default = await client.post("/chat", headers=headers, json={"question": QUESTION})
    assert default.json()["model"] == "extractive"


async def test_provider_default_model_is_used_when_model_omitted(client: AsyncClient, fake_llm: dict) -> None:
    headers = await setup(client)
    await client.post(
        "/chat",
        headers={**headers, "X-LLM-API-Key": SECRET},
        json={"question": QUESTION, "llm": {"provider": "anthropic"}},
    )
    assert FakeLLM.instances[0].model == "claude-opus-5-5"


async def test_missing_key_is_a_clear_400(client: AsyncClient) -> None:
    headers = await setup(client)
    response = await client.post(
        "/chat", headers=headers, json={"question": QUESTION, "llm": {"provider": "anthropic"}}
    )
    assert response.status_code == 400
    assert "Anthropic Claude API key" in response.json()["detail"]


async def test_no_llm_is_not_selectable(client: AsyncClient) -> None:
    headers = await setup(client)
    response = await client.post(
        "/chat", headers=headers, json={"question": QUESTION, "llm": {"provider": "extractive"}}
    )
    assert response.status_code == 422


def test_server_default_is_gemini_and_needs_no_server_key() -> None:
    from app.core.config import Settings
    from app.services.llm_providers import build_default_llm, default_model

    settings = Settings(_env_file=None)
    assert default_model(settings) == ("gemini", "gemini-2.5-flash")
    assert build_default_llm(settings) is None  # no server key: users bring theirs


async def test_gemini_default_uses_the_users_key(tmp_path: Path, fake_llm: dict) -> None:
    app = create_app(make_settings(tmp_path, llm_provider="gemini"))
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            headers = await setup(client)
            body = (await client.get("/llm/providers", headers=headers)).json()
            assert body["default"] == {"provider": "gemini", "model": "gemini-2.5-flash"}

            missing = await client.post("/chat", headers=headers, json={"question": QUESTION})
            assert missing.status_code == 400
            assert "Google Gemini API key" in missing.json()["detail"]

            response = await client.post(
                "/chat", headers={**headers, "X-LLM-API-Key": "AIza-user-key"}, json={"question": QUESTION}
            )
            assert response.status_code == 200, response.text
            [llm] = FakeLLM.instances
            assert (llm.provider, llm.model, llm.api_key) == ("gemini", "gemini-2.5-flash", "AIza-user-key")
            assert response.json()["model"] == "gemini-2.5-flash"


@pytest.mark.parametrize(
    ("error", "status"),
    [(LLMAuthError("Anthropic rejected the API key."), 400), (LLMRateLimitError("Slow down."), 429)],
)
async def test_provider_errors_map_to_statuses(
    client: AsyncClient, fake_llm: dict, error: Exception, status: int
) -> None:
    headers = await setup(client)
    fake_llm["error"] = error
    response = await client.post(
        "/chat",
        headers={**headers, "X-LLM-API-Key": SECRET},
        json={"question": QUESTION, "llm": {"provider": "anthropic"}},
    )
    assert response.status_code == status
    assert response.json()["detail"] == error.message  # type: ignore[attr-defined]
    assert FakeLLM.instances[0].closed


async def test_invalid_model_id_is_rejected(client: AsyncClient) -> None:
    headers = await setup(client)
    response = await client.post(
        "/chat",
        headers=headers,
        json={"question": QUESTION, "llm": {"provider": "anthropic", "model": "../../etc/passwd now"}},
    )
    assert response.status_code == 422


async def test_user_keys_can_be_disabled(tmp_path: Path, fake_llm: dict) -> None:
    app = create_app(make_settings(tmp_path, allow_user_llm_keys=False))
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            headers = await setup(client)
            response = await client.post(
                "/chat",
                headers={**headers, "X-LLM-API-Key": SECRET},
                json={"question": QUESTION, "llm": {"provider": "anthropic"}},
            )
            assert response.status_code == 400
            assert "does not accept" in response.json()["detail"]
            assert FakeLLM.instances == []


async def test_verify_lists_models(client: AsyncClient, fake_llm: dict) -> None:
    headers = await register(client, "alice@example.com")
    ok = await client.post(
        "/llm/verify", headers={**headers, "X-LLM-API-Key": SECRET}, json={"provider": "anthropic"}
    )
    assert ok.status_code == 200
    assert ok.json() == {
        "provider": "anthropic",
        "valid": True,
        "models": ["claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5"],
    }

    fake_llm["error"] = LLMAuthError("Anthropic rejected the API key.")
    bad = await client.post(
        "/llm/verify", headers={**headers, "X-LLM-API-Key": "nope"}, json={"provider": "anthropic"}
    )
    assert bad.status_code == 400

    missing = await client.post("/llm/verify", headers=headers, json={"provider": "openai"})
    assert missing.status_code == 400


async def test_key_never_reaches_the_logs(
    client: AsyncClient, fake_llm: dict, caplog: pytest.LogCaptureFixture
) -> None:
    headers = await setup(client)
    fake_llm["error"] = LLMAuthError("Anthropic rejected the API key.")
    with caplog.at_level(logging.DEBUG):
        await client.post(
            "/chat",
            headers={**headers, "X-LLM-API-Key": SECRET},
            json={"question": QUESTION, "llm": {"provider": "anthropic"}},
        )
    assert SECRET not in caplog.text


# --- Real SDKs against a mock HTTP transport: error translation and model listing ----


def mock_transport(status: int, payload: dict) -> httpx2.MockTransport:
    return httpx2.MockTransport(lambda request: httpx2.Response(status, json=payload))


async def test_anthropic_sdk_errors_and_models(tmp_path: Path) -> None:
    settings = make_settings(tmp_path, llm_max_retries=0)

    rejected = AnthropicClient(settings, None, "bad-key")
    rejected._client = anthropic.AsyncAnthropic(
        api_key="bad-key",
        max_retries=0,
        http_client=anthropic.DefaultAsyncHttpxClient(
            transport=mock_transport(
                401,
                {"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}},
            )
        ),
    )
    with pytest.raises(LLMAuthError):
        await rejected.complete("S", "U")

    listing = AnthropicClient(settings, None, "good-key")
    listing._client = anthropic.AsyncAnthropic(
        api_key="good-key",
        http_client=anthropic.DefaultAsyncHttpxClient(
            transport=mock_transport(
                200,
                {
                    "data": [
                        {
                            "type": "model",
                            "id": "claude-opus-5-5",
                            "display_name": "Claude Opus 5.5",
                            "created_at": "2026-09-01T00:00:00Z",
                        }
                    ],
                    "has_more": False,
                    "first_id": "claude-opus-5-5",
                    "last_id": "claude-opus-5-5",
                },
            )
        ),
    )
    assert await listing.list_models() == ["claude-opus-5-5"]


async def test_openai_sdk_errors_and_model_filter(tmp_path: Path) -> None:
    settings = make_settings(tmp_path, llm_max_retries=0)

    rejected = OpenAIClient(settings, None, "bad-key")
    rejected._client = openai.AsyncOpenAI(
        api_key="bad-key",
        max_retries=0,
        http_client=openai.DefaultAsyncHttpxClient(
            transport=mock_transport(
                401, {"error": {"message": "Incorrect API key", "type": "invalid_request_error"}}
            )
        ),
    )
    with pytest.raises(LLMAuthError):
        await rejected.complete("S", "U")

    models = [
        "gpt-4.1",
        "gpt-4.1-mini",
        "text-embedding-3-small",
        "gpt-4o-realtime-preview",
        "o3",
        "dall-e-3",
    ]
    listing = OpenAIClient(settings, None, "good-key")
    listing._client = openai.AsyncOpenAI(
        api_key="good-key",
        http_client=openai.DefaultAsyncHttpxClient(
            transport=mock_transport(
                200,
                {
                    "object": "list",
                    "data": [{"id": m, "object": "model", "created": 0, "owned_by": "x"} for m in models],
                },
            )
        ),
    )
    assert await listing.list_models() == ["gpt-4.1", "gpt-4.1-mini", "o3"]
