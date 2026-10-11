from httpx import AsyncClient

from tests.helpers import register


async def test_register_login_and_me(client: AsyncClient) -> None:
    headers = await register(client, "Ada@Example.com")

    me = await client.get("/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == "ada@example.com"

    login = await client.post(
        "/auth/login", data={"username": "ada@example.com", "password": "correct-horse-battery"}
    )
    assert login.status_code == 200
    assert login.json()["token_type"] == "bearer"


async def test_duplicate_email_is_rejected(client: AsyncClient) -> None:
    await register(client, "dup@example.com")
    response = await client.post(
        "/auth/register", json={"email": "DUP@example.com", "password": "another-password"}
    )
    assert response.status_code == 409


async def test_wrong_password_and_unknown_user_look_the_same(client: AsyncClient) -> None:
    await register(client, "bob@example.com")
    wrong = await client.post("/auth/login", data={"username": "bob@example.com", "password": "nope-nope"})
    unknown = await client.post(
        "/auth/login", data={"username": "ghost@example.com", "password": "nope-nope"}
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


async def test_weak_password_and_bad_email_are_validated(client: AsyncClient) -> None:
    short = await client.post("/auth/register", json={"email": "x@example.com", "password": "short"})
    bad_email = await client.post(
        "/auth/register", json={"email": "not-an-email", "password": "long-enough-pw"}
    )
    assert short.status_code == bad_email.status_code == 422


async def test_protected_routes_require_a_valid_token(client: AsyncClient) -> None:
    assert (await client.get("/documents")).status_code == 401
    bad = await client.get("/documents", headers={"Authorization": "Bearer not-a-token"})
    assert bad.status_code == 401
    assert (await client.post("/chat", json={"question": "hi"})).status_code == 401
