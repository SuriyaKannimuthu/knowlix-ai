"""Claude provider: request shape and response handling, against a fake SDK client."""

from pathlib import Path
from types import SimpleNamespace as NS

import pytest
from httpx import AsyncClient

from app.services.anthropic_llm import DEFAULT_MODEL, FALLBACK_BETA, AnthropicClient
from app.services.generation import DECLINED_MESSAGE, Generator
from app.services.llm_errors import LLMUnavailableError
from app.services.llm_providers import build_default_llm
from app.services.retrieval import Candidate
from tests.conftest import make_settings
from tests.helpers import register, upload


def message(text: str | None = "Economy class [1].", stop_reason: str = "end_turn", **extra) -> NS:
    content = [NS(type="thinking", thinking="")]
    if text is not None:
        content.append(NS(type="text", text=text))
    return NS(
        id="msg_test",
        model=extra.get("model", DEFAULT_MODEL),
        stop_reason=stop_reason,
        stop_details=extra.get("stop_details"),
        content=content,
        usage=NS(
            input_tokens=500,
            cache_creation_input_tokens=None,
            cache_read_input_tokens=100,
            output_tokens=40,
        ),
    )


class FakeMessages:
    def __init__(self, response: NS) -> None:
        self.response = response
        self.calls: list[dict] = []

    async def create(self, **kwargs) -> NS:
        self.calls.append(kwargs)
        return self.response


def make_client(
    tmp_path: Path, response: NS, **overrides
) -> tuple[AnthropicClient, FakeMessages, FakeMessages]:
    settings = make_settings(tmp_path, llm_provider="anthropic", anthropic_api_key="test-key", **overrides)
    client = AnthropicClient(settings, None, "test-key")
    stable, beta = FakeMessages(response), FakeMessages(response)
    client._client = NS(messages=stable, beta=NS(messages=beta))  # type: ignore[assignment]
    return client, stable, beta


PASSAGE = Candidate(
    point_id="p1", document_id="d1", filename="travel.pdf", page=2, chunk_index=0, text="Book economy class."
)


async def test_request_uses_opus_effort_and_refusal_fallback(tmp_path: Path) -> None:
    client, stable, beta = make_client(tmp_path, message())
    text, prompt_tokens, completion_tokens = await client.complete("SYSTEM", "USER")

    assert text == "Economy class [1]."  # thinking blocks are skipped
    assert (prompt_tokens, completion_tokens) == (600, 40)  # cached input tokens are counted
    assert stable.calls == []
    [call] = beta.calls
    assert call["model"] == "claude-opus-5-5"
    assert call["betas"] == [FALLBACK_BETA]
    assert call["fallbacks"] == "default"
    assert call["output_config"] == {"effort": "medium"}
    assert call["max_tokens"] == 16000
    assert call["system"] == "SYSTEM"
    assert call["messages"] == [{"role": "user", "content": "USER"}]
    assert "temperature" not in call  # rejected by Opus 5.5


async def test_fallback_and_model_are_configurable(tmp_path: Path) -> None:
    client, stable, beta = make_client(
        tmp_path,
        message(),
        anthropic_refusal_fallback=False,
        llm_model="claude-sonnet-5-5",
        anthropic_effort="low",
    )
    await client.complete("SYSTEM", "USER")
    [call] = stable.calls
    assert beta.calls == []
    assert call["model"] == "claude-sonnet-5-5"
    assert call["output_config"] == {"effort": "low"}
    assert "betas" not in call and "fallbacks" not in call


async def test_safety_decline_is_reported_separately_from_missing_evidence(tmp_path: Path) -> None:
    declined = message(text=None, stop_reason="refusal", stop_details=NS(category="cyber"))
    client, _, _ = make_client(tmp_path, declined)
    result = await Generator(client).generate("Q?", [PASSAGE])
    assert result.refused is True
    assert result.answer == DECLINED_MESSAGE
    assert result.cited == []


async def test_grounded_answer_flows_through_the_generator(tmp_path: Path) -> None:
    client, _, _ = make_client(tmp_path, message("Book economy for short flights [1]."))
    result = await Generator(client).generate("Which class?", [PASSAGE])
    assert result.refused is False
    assert result.model == "claude-opus-5-5"
    assert result.cited == [1]
    assert (result.prompt_tokens, result.completion_tokens) == (600, 40)


async def test_running_out_of_tokens_before_answering_is_an_error(tmp_path: Path) -> None:
    client, _, _ = make_client(tmp_path, message(text=None, stop_reason="max_tokens"))
    with pytest.raises(LLMUnavailableError):
        await Generator(client).generate("Q?", [PASSAGE])


def test_build_llm_selects_claude(tmp_path: Path) -> None:
    llm = build_default_llm(make_settings(tmp_path, llm_provider="anthropic", anthropic_api_key="test-key"))
    assert isinstance(llm, AnthropicClient)
    assert llm.model == DEFAULT_MODEL


async def test_provider_failure_returns_502(client: AsyncClient) -> None:
    class Broken:
        model = "claude-opus-5-5"

        async def complete(self, system: str, user: str) -> tuple[str, int, int]:
            raise TimeoutError("upstream timed out")

    services = client._transport.app.state.services  # type: ignore[attr-defined]
    services.generator.llm = Broken()

    headers = await register(client, "alice@example.com")
    await upload(client, headers, "travel.txt", b"Employees must book economy class for short flights.")
    response = await client.post(
        "/chat", headers=headers, json={"question": "Which class for short flights?"}
    )
    assert response.status_code == 502
    assert "did not respond" in response.json()["detail"]
