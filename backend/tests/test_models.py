"""End-to-end retrieval with the real FastEmbed embedder and cross-encoder reranker.

Downloads ~150 MB of models on first run, so it is opt-in:

    RUN_MODEL_TESTS=1 pytest -m models
"""

import os
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from tests.conftest import make_settings
from tests.helpers import ask, register, upload

pytestmark = [
    pytest.mark.models,
    pytest.mark.skipif(not os.getenv("RUN_MODEL_TESTS"), reason="set RUN_MODEL_TESTS=1 to run"),
]

HANDBOOK = b"""Employee handbook.

Paid time off. Full-time employees accrue 25 days of paid vacation per year. Unused days
can be carried over until the end of March of the following year.

Parental leave. Primary caregivers receive 16 weeks of fully paid parental leave.

Expenses. Meals during business travel are reimbursed up to 60 euros per day. Receipts must be
submitted within 30 days through the finance portal.

Equipment. Every employee receives a laptop, which must be returned on the last working day."""


@pytest.fixture
async def client(tmp_path: Path):
    settings = make_settings(
        tmp_path, embedding_provider="fastembed", reranker_provider="cross-encoder", chunk_size=300
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
            yield http


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        ("How many vacation days do I get each year?", "25 days"),  # paraphrase, no keyword overlap
        ("How long is maternity or paternity leave?", "16 weeks"),
        ("What's the daily limit for food when travelling for work?", "60 euros"),
        ("Who has to return a laptop when leaving?", "laptop"),
        pytest.param(
            "Do I have to give back my computer when I leave?",
            "laptop",
            marks=pytest.mark.xfail(
                reason="Known limitation: MiniLM-L-6 scores this computer/laptop paraphrase "
                "at -7.9, below the off-topic margin. A larger reranker such as "
                "BAAI/bge-reranker-base closes the gap.",
                strict=True,
            ),
        ),
    ],
)
async def test_paraphrased_questions_are_answered(client: AsyncClient, question: str, expected: str) -> None:
    headers = await register(client, "alice@example.com")
    await upload(client, headers, "handbook.txt", HANDBOOK)
    result = await ask(client, headers, question)
    assert result["refused"] is False, result
    assert expected in result["sources"][0]["content"]


@pytest.mark.parametrize(
    "question",
    [
        "What is the capital of Australia?",
        "Who won the 2018 football world cup?",
        "How do I bake sourdough?",
        "How many employees work at the company?",
    ],
)
async def test_off_topic_questions_are_refused(client: AsyncClient, question: str) -> None:
    headers = await register(client, "alice@example.com")
    await upload(client, headers, "handbook.txt", HANDBOOK)
    result = await ask(client, headers, question)
    assert result["refused"] is True, result
