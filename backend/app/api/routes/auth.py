from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, ServicesDep, SessionDep
from app.core.security import DUMMY_HASH, create_access_token, hash_password, verify_password
from app.database.models import User
from app.schemas.auth import Token, UserCreate, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


def _token_for(user: User, services: ServicesDep) -> Token:
    token, expires_in = create_access_token(user.id, services.settings)
    return Token(access_token=token, expires_in=expires_in, user=UserOut.model_validate(user))


@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
async def register(body: UserCreate, session: SessionDep, services: ServicesDep) -> Token:
    user = User(
        email=body.email,
        full_name=body.full_name.strip() if body.full_name else None,
        hashed_password=hash_password(body.password),
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists") from None
    return _token_for(user, services)


@router.post("/login", response_model=Token)
async def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: SessionDep,
    services: ServicesDep,
) -> Token:
    """OAuth2 password flow: `username` carries the email. Also powers Swagger's Authorize."""
    user = await session.scalar(select(User).where(User.email == form.username.strip().lower()))
    password_ok = verify_password(form.password, user.hashed_password if user else DUMMY_HASH)
    if user is None or not password_ok or not user.is_active:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _token_for(user, services)


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> User:
    return user
