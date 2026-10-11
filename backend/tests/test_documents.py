from pathlib import Path

from httpx import ASGITransport, AsyncClient

from app.main import create_app
from tests.conftest import make_settings
from tests.helpers import make_docx, make_pdf, register, upload

POLICY = b"Remote work policy. Employees may work remotely up to three days per week with manager approval."


async def test_upload_waits_for_calibrate(client: AsyncClient) -> None:
    headers = await register(client, "owner@example.com")
    created = await upload(client, headers, "policy.txt", POLICY, tags="HR, Policy, hr", calibrate=False)
    assert created["status"] == "uploaded"
    assert created["tags"] == ["hr", "policy"]
    assert created["access"] == "owner"

    # Not searchable yet.
    document = (await client.get(f"/documents/{created['id']}", headers=headers)).json()
    assert document["status"] == "uploaded"
    assert document["chunk_count"] == 0
    chat = await client.post("/chat", headers=headers, json={"question": "remote work policy"})
    assert chat.json()["refused"] is True
    assert "Calibrate" in chat.json()["answer"]
    scoped = await client.post(
        "/chat", headers=headers, json={"question": "remote work", "document_id": created["id"]}
    )
    assert scoped.status_code == 409
    assert "Calibrate" in scoped.json()["detail"]

    calibrated = await client.post("/documents/calibrate", headers=headers)
    assert calibrated.status_code == 202
    assert calibrated.json() == {"queued": 1, "document_ids": [created["id"]]}

    document = (await client.get(f"/documents/{created['id']}", headers=headers)).json()
    assert document["status"] == "ready"
    assert document["chunk_count"] >= 1
    assert document["error"] is None


async def test_calibrate_processes_all_pending_documents_together(client: AsyncClient) -> None:
    headers = await register(client, "owner@example.com")
    first = await upload(client, headers, "remote.txt", POLICY, calibrate=False)
    second = await upload(
        client, headers, "report.pdf", make_pdf(["Quarterly revenue grew 12 percent."]), calibrate=False
    )
    third = await upload(
        client, headers, "guide.docx", make_docx("Guide", ["Laptops use disk encryption."]), calibrate=False
    )

    result = (await client.post("/documents/calibrate", headers=headers)).json()
    assert result["queued"] == 3
    assert set(result["document_ids"]) == {first["id"], second["id"], third["id"]}

    statuses = {d["filename"]: d["status"] for d in (await client.get("/documents", headers=headers)).json()}
    assert statuses == {"remote.txt": "ready", "report.pdf": "ready", "guide.docx": "ready"}

    # Chat now spans every calibrated document.
    answer = (
        await client.post("/chat", headers=headers, json={"question": "What percent did revenue grow?"})
    ).json()
    assert answer["refused"] is False
    assert answer["sources"][0]["document"] == "report.pdf"

    # Nothing left to do.
    assert (await client.post("/documents/calibrate", headers=headers)).json()["queued"] == 0


async def test_calibrate_retries_failed_and_only_touches_own_documents(client: AsyncClient) -> None:
    alice = await register(client, "alice@example.com")
    bob = await register(client, "bob@example.com")
    broken = await upload(client, alice, "blank.pdf", make_pdf([" "]))
    assert (await client.get(f"/documents/{broken['id']}", headers=alice)).json()["status"] == "failed"
    bobs = await upload(client, bob, "bob.txt", POLICY, calibrate=False)

    retry = (await client.post("/documents/calibrate", headers=alice)).json()
    assert retry["document_ids"] == [broken["id"]]  # failed doc retried, Bob's untouched
    assert (await client.get(f"/documents/{bobs['id']}", headers=bob)).json()["status"] == "uploaded"


async def test_interrupted_calibration_is_reset_on_restart(tmp_path: Path) -> None:
    settings = make_settings(tmp_path)
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            headers = await register(client, "owner@example.com")
            created = await upload(client, headers, "policy.txt", POLICY, calibrate=False)
            services = app.state.services
            async with services.session_factory() as session:
                from app.database.models import Document

                doc = await session.get(Document, created["id"])
                doc.status = "processing"  # simulate a crash mid-calibration
                await session.commit()

    restarted = create_app(settings)
    async with restarted.router.lifespan_context(restarted):
        async with AsyncClient(transport=ASGITransport(app=restarted), base_url="http://test") as client:
            login = await client.post(
                "/auth/login", data={"username": "owner@example.com", "password": "correct-horse-battery"}
            )
            headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
            doc = (await client.get(f"/documents/{created['id']}", headers=headers)).json()
            assert doc["status"] == "uploaded"


async def test_upload_pdf_and_docx(client: AsyncClient) -> None:
    headers = await register(client, "owner@example.com")
    pdf = await upload(client, headers, "report.pdf", make_pdf(["Page one text.", "Page two text."]))
    docx = await upload(client, headers, "guide.docx", make_docx("Guide", ["Some guidance here."]))

    pdf_doc = (await client.get(f"/documents/{pdf['id']}", headers=headers)).json()
    docx_doc = (await client.get(f"/documents/{docx['id']}", headers=headers)).json()
    assert pdf_doc["status"] == docx_doc["status"] == "ready"
    assert pdf_doc["page_count"] == 2
    assert docx_doc["page_count"] is None


async def test_upload_validation(client: AsyncClient) -> None:
    headers = await register(client, "owner@example.com")
    await upload(client, headers, "malware.exe", b"MZ...", expect=415)
    await upload(client, headers, "fake.pdf", b"just text pretending", expect=415)
    await upload(client, headers, "empty.txt", b"", expect=400)
    await upload(client, headers, "policy.txt", POLICY)
    await upload(client, headers, "policy-copy.txt", POLICY, expect=409)


async def test_upload_size_limit(tmp_path: Path) -> None:
    app = create_app(make_settings(tmp_path, max_upload_mb=1))
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            headers = await register(client, "owner@example.com")
            await upload(client, headers, "big.txt", b"a" * (1024 * 1024 + 1), expect=413)


async def test_unreadable_file_is_marked_failed(client: AsyncClient) -> None:
    headers = await register(client, "owner@example.com")
    created = await upload(client, headers, "blank.pdf", make_pdf([" "]))
    document = (await client.get(f"/documents/{created['id']}", headers=headers)).json()
    assert document["status"] == "failed"
    assert "No extractable text" in document["error"]


async def test_documents_are_private_by_default(client: AsyncClient) -> None:
    alice = await register(client, "alice@example.com")
    bob = await register(client, "bob@example.com")
    doc = await upload(client, alice, "policy.txt", POLICY)

    assert (await client.get("/documents", headers=bob)).json() == []
    # Forbidden and nonexistent look identical, so ids cannot be probed.
    assert (await client.get(f"/documents/{doc['id']}", headers=bob)).status_code == 404
    assert (await client.delete(f"/documents/{doc['id']}", headers=bob)).status_code == 404
    assert (await client.patch(f"/documents/{doc['id']}", headers=bob, json={"tags": []})).status_code == 404


async def test_sharing_grants_read_but_not_write(client: AsyncClient) -> None:
    alice = await register(client, "alice@example.com")
    bob = await register(client, "bob@example.com")
    doc = await upload(client, alice, "policy.txt", POLICY)

    share = await client.post(
        f"/documents/{doc['id']}/shares", headers=alice, json={"email": "bob@example.com"}
    )
    assert share.status_code == 201
    again = await client.post(
        f"/documents/{doc['id']}/shares", headers=alice, json={"email": "bob@example.com"}
    )
    assert again.status_code == 409

    listed = (await client.get("/documents", headers=bob)).json()
    assert [d["access"] for d in listed] == ["shared"]
    assert (await client.delete(f"/documents/{doc['id']}", headers=bob)).status_code == 403
    assert (await client.get(f"/documents/{doc['id']}/shares", headers=bob)).status_code == 403

    shares = (await client.get(f"/documents/{doc['id']}/shares", headers=alice)).json()
    assert [s["email"] for s in shares] == ["bob@example.com"]

    revoke = await client.delete(f"/documents/{doc['id']}/shares/{shares[0]['user_id']}", headers=alice)
    assert revoke.status_code == 204
    assert (await client.get("/documents", headers=bob)).json() == []


async def test_organization_visibility(client: AsyncClient) -> None:
    alice = await register(client, "alice@example.com")
    bob = await register(client, "bob@example.com")
    doc = await upload(client, alice, "handbook.txt", POLICY)

    updated = await client.patch(
        f"/documents/{doc['id']}", headers=alice, json={"visibility": "organization"}
    )
    assert updated.status_code == 200
    listed = (await client.get("/documents", headers=bob)).json()
    assert [(d["id"], d["access"]) for d in listed] == [(doc["id"], "organization")]


async def test_delete_removes_document_and_vectors(client: AsyncClient) -> None:
    headers = await register(client, "owner@example.com")
    doc = await upload(client, headers, "policy.txt", POLICY)

    before = await client.post("/search", headers=headers, json={"query": "remote work policy"})
    assert before.json()["hits"]

    assert (await client.delete(f"/documents/{doc['id']}", headers=headers)).status_code == 204
    assert (await client.get(f"/documents/{doc['id']}", headers=headers)).status_code == 404

    services = client._transport.app.state.services  # type: ignore[attr-defined]
    count = await services.vector_store.client.count(services.vector_store.collection)
    assert count.count == 0


async def test_reuploading_same_name_replaces_the_document(client: AsyncClient) -> None:
    headers = await register(client, "owner@example.com")
    original = await upload(client, headers, "policy.txt", b"Remote work is allowed two days per week.")
    await client.patch(f"/documents/{original['id']}", headers=headers, json={"visibility": "organization"})

    async def top_hit(query: str) -> str | None:
        hits = (await client.post("/search", headers=headers, json={"query": query})).json()["hits"]
        return hits[0]["content"] if hits else None

    assert "two days" in (await top_hit("remote work days per week") or "")

    # New version under the same name: same document, old content gone at once.
    replaced = await upload(
        client, headers, "policy.txt", b"Remote work is allowed four days per week.", calibrate=False
    )
    assert replaced["id"] == original["id"]
    assert replaced["status"] == "uploaded"
    assert replaced["visibility"] == "organization"  # sharing settings survive
    assert await top_hit("remote work days per week") is None
    assert len((await client.get("/documents", headers=headers)).json()) == 1

    # Calibrate picks it up again and only the new text is searchable.
    assert (await client.post("/documents/calibrate", headers=headers)).json()["queued"] == 1
    content = await top_hit("remote work days per week") or ""
    assert "four days" in content and "two days" not in content


async def test_cannot_replace_while_calibrating(client: AsyncClient) -> None:
    headers = await register(client, "owner@example.com")
    doc = await upload(client, headers, "policy.txt", POLICY, calibrate=False)
    services = client._transport.app.state.services  # type: ignore[attr-defined]
    async with services.session_factory() as session:
        from app.database.models import Document

        row = await session.get(Document, doc["id"])
        row.status = "processing"
        await session.commit()
    await upload(client, headers, "policy.txt", b"A newer policy text.", expect=409)


async def test_recalibrate_all_rebuilds_ready_documents(client: AsyncClient) -> None:
    headers = await register(client, "owner@example.com")
    first = await upload(client, headers, "a.txt", POLICY)
    second = await upload(client, headers, "b.txt", b"Laptops must use full-disk encryption.")
    assert (await client.post("/documents/calibrate", headers=headers)).json()["queued"] == 0

    again = (await client.post("/documents/calibrate?all=true", headers=headers)).json()
    assert set(again["document_ids"]) == {first["id"], second["id"]}
    statuses = {d["status"] for d in (await client.get("/documents", headers=headers)).json()}
    assert statuses == {"ready"}
