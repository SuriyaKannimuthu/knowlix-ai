import base64
import hashlib
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.core.config import Settings


def _prehash(password: str) -> bytes:
    # bcrypt only reads the first 72 bytes; pre-hashing lets long passphrases count in full.
    return base64.b64encode(hashlib.sha256(password.encode("utf-8")).digest())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_prehash(password), bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_prehash(password), hashed.encode("ascii"))
    except ValueError:
        return False


# Compared against when the email is unknown so login timing does not reveal accounts.
DUMMY_HASH = hash_password("knowlix-dummy-password")


def create_access_token(user_id: str, settings: Settings) -> tuple[str, int]:
    now = datetime.now(UTC)
    expires = timedelta(minutes=settings.access_token_minutes)
    payload = {"sub": user_id, "type": "access", "iat": now, "exp": now + expires}
    token = jwt.encode(payload, settings.jwt_secret.get_secret_value(), algorithm=settings.jwt_algorithm)
    return token, int(expires.total_seconds())


def decode_access_token(token: str, settings: Settings) -> str | None:
    """Return the user id in a valid access token, or None."""
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            options={"require": ["sub", "exp"]},
        )
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "access":
        return None
    return str(payload["sub"])
