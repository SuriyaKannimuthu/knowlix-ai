from pathlib import Path

from httpx import ASGITransport, AsyncClient

from app.main import create_app
from tests.conftest import make_settings
from tests.helpers import ask, make_pdf, register, upload

TRAVEL = (
    b"Travel policy.\n\n"
    b"Employees must book economy class for flights shorter than six hours. "
    b"Business class is allowed for flights longer than six hours.\n\n"
    b"Hotel stays are reimbursed up to 180 dollars per night in major cities."
)
SECURITY = (
    b"Security handbook.\n\n"
    b"Laptops must use full-disk encryption. The incident hotline code is ZX-4471. "
    b"Report lost devices within 24 hours."
)


async def test_grounded_answer_cites_its_sources(client: AsyncClient) -> None:
    headers = await register(client, "alice@example.com")
    await upload(client, headers, "travel.txt", TRAVEL)
    await upload(client, headers, "security.txt", SECURITY)

    result = await ask(client, headers, "What class must employees book for short flights?")

    assert result["refused"] is False
    assert "economy class" in result["answer"]
    assert "[1]" in result["answer"]
    assert result["sources"][0]["document"] == "travel.txt"
    assert [s["index"] for s in result["sources"]] == list(range(1, len(result["sources"]) + 1))
    assert result["model"] == "extractive"


async def test_refuses_when_evidence_is_insufficient(client: AsyncClient) -> None:
    headers = await register(client, "alice@example.com")
    await upload(client, headers, "travel.txt", TRAVEL)

    result = await ask(client, headers, "What is the boiling point of tungsten?")

    assert result["refused"] is True
    assert result["sources"] == []
    assert "enough evidence" in result["answer"]


async def test_refuses_when_user_has_no_documents(client: AsyncClient) -> None:
    headers = await register(client, "alice@example.com")
    result = await ask(client, headers, "Anything?")
    assert result["refused"] is True
    assert "no calibrated documents" in result["answer"].lower()


async def test_sparse_retrieval_finds_exact_identifiers(client: AsyncClient) -> None:
    headers = await register(client, "alice@example.com")
    await upload(client, headers, "travel.txt", TRAVEL)
    await upload(client, headers, "security.txt", SECURITY)

    hits = (await client.post("/search", headers=headers, json={"query": "ZX-4471"})).json()["hits"]
    assert hits[0]["document"] == "security.txt"
    assert hits[0]["sparse_score"] is not None

    result = await ask(client, headers, "Which hotline code is ZX-4471 for?")
    assert result["refused"] is False
    assert result["sources"][0]["document"] == "security.txt"


async def test_users_cannot_retrieve_each_others_documents(client: AsyncClient) -> None:
    alice = await register(client, "alice@example.com")
    bob = await register(client, "bob@example.com")
    secret = await upload(client, alice, "security.txt", SECURITY)
    await upload(client, bob, "travel.txt", TRAVEL)

    leaked = await ask(client, bob, "What is the incident hotline code?")
    assert leaked["refused"] is True
    assert all(s["document_id"] != secret["id"] for s in leaked["sources"])

    direct = await client.post(
        "/chat", headers=bob, json={"question": "hotline code", "document_id": secret["id"]}
    )
    assert direct.status_code == 404

    search = (await client.post("/search", headers=bob, json={"query": "ZX-4471 hotline"})).json()
    assert all(h["document_id"] != secret["id"] for h in search["hits"])

    await client.post(f"/documents/{secret['id']}/shares", headers=alice, json={"email": "bob@example.com"})
    shared = await ask(client, bob, "What is the incident hotline code?")
    assert shared["refused"] is False
    assert shared["sources"][0]["document_id"] == secret["id"]


async def test_metadata_filters_narrow_the_search(client: AsyncClient) -> None:
    headers = await register(client, "alice@example.com")
    travel = await upload(client, headers, "travel.txt", TRAVEL, tags="finance")
    await upload(client, headers, "security.txt", SECURITY, tags="it")
    await upload(client, headers, "hotels.pdf", make_pdf(["Hotel stays are reimbursed in major cities."]))

    by_tag = await ask(client, headers, "Hotel stays reimbursed per night?", filters={"tags": ["finance"]})
    assert {s["document"] for s in by_tag["sources"]} == {"travel.txt"}

    by_type = await ask(client, headers, "Hotel stays reimbursed per night?", filters={"file_types": ["pdf"]})
    assert {s["document"] for s in by_type["sources"]} == {"hotels.pdf"}
    assert by_type["sources"][0]["page"] == 1

    wrong_scope = await ask(client, headers, "What is the incident hotline code?", document_id=travel["id"])
    assert wrong_scope["refused"] is True


async def test_chat_validates_input(client: AsyncClient) -> None:
    headers = await register(client, "alice@example.com")
    assert (await client.post("/chat", headers=headers, json={"question": "   "})).status_code == 422
    assert (await client.post("/chat", headers=headers, json={"question": "x" * 2001})).status_code == 422
    bad_filter = {"question": "hi", "filters": {"file_types": ["exe"]}}
    assert (await client.post("/chat", headers=headers, json=bad_filter)).status_code == 422


async def test_chat_is_rate_limited(tmp_path: Path) -> None:
    app = create_app(make_settings(tmp_path, chat_rate_limit_per_minute=2))
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            headers = await register(client, "alice@example.com")
            for _ in range(2):
                assert (
                    await client.post("/chat", headers=headers, json={"question": "hi"})
                ).status_code == 200
            limited = await client.post("/chat", headers=headers, json={"question": "hi"})
            assert limited.status_code == 429
            assert int(limited.headers["Retry-After"]) >= 1


async def test_health(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == body["vector_store"] == "ok"
    assert response.headers["X-Request-ID"]
