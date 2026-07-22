"""Database-backed authentication and OAuth state handling."""

import hashlib
import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.db.session import get_db
from app.models import AuthSession, OAuthState, User

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def normalize_next_path(next_path: str | None) -> str:
    value = (next_path or "/").strip()
    if not value.startswith("/") or value.startswith("//"):
        return "/"
    return value[:1024]


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


async def create_session(db: AsyncSession, user: User) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=now + timedelta(days=settings.session_ttl_days),
            last_seen_at=now,
        )
    )
    user.last_login_at = now
    await db.flush()
    return token


async def create_oauth_state(db: AsyncSession, next_path: str | None = None) -> str:
    state = secrets.token_urlsafe(32)
    db.add(
        OAuthState(
            state_hash=hash_token(state),
            next_path=normalize_next_path(next_path),
            expires_at=datetime.now(UTC) + timedelta(minutes=settings.oauth_state_ttl_minutes),
        )
    )
    await db.flush()
    return state


async def consume_oauth_state(db: AsyncSession, state: str) -> str:
    if not state:
        raise ValueError("登录请求已失效，请重新扫码")
    result = await db.execute(
        select(OAuthState).where(OAuthState.state_hash == hash_token(state))
    )
    record = result.scalar_one_or_none()
    now = datetime.now(UTC)
    if (
        record is None
        or record.used_at is not None
        or _as_utc(record.expires_at) <= now
    ):
        raise ValueError("登录请求已失效，请重新扫码")
    record.used_at = now
    await db.flush()
    return normalize_next_path(record.next_path)


async def get_or_create_local_user(db: AsyncSession) -> User:
    result = await db.execute(
        select(User)
        .where(User.auth_provider == "local")
        .order_by(User.created_at)
        .limit(1)
    )
    user = result.scalar_one_or_none()
    if user is None:
        user = User(
            name="本地管理员",
            auth_provider="local",
            provider_subject="local-admin",
        )
        db.add(user)
        await db.flush()
    elif not user.provider_subject:
        user.provider_subject = "local-admin"
    return user


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_ttl_days * 24 * 60 * 60,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
    )


def _request_token(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials],
    query_token: str,
) -> str:
    if credentials and credentials.scheme.lower() == "bearer":
        return credentials.credentials
    if query_token:
        return query_token
    return request.cookies.get(settings.session_cookie_name, "")


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    query_token: str = Query("", alias="token"),
    db: AsyncSession = Depends(get_db),
) -> User:
    if settings.dev_auth_bypass:
        user = await get_or_create_local_user(db)
        await db.commit()
        request.state.dev_auth_bypass = True
        return user

    token = _request_token(request, credentials, query_token)
    if token:
        result = await db.execute(
            select(AuthSession)
            .where(
                AuthSession.token_hash == hash_token(token),
                AuthSession.revoked_at.is_(None),
            )
            .options(selectinload(AuthSession.user))
        )
        session = result.scalar_one_or_none()
        if session and _as_utc(session.expires_at) > datetime.now(UTC):
            session.last_seen_at = datetime.now(UTC)
            request.state.auth_token = token
            request.state.auth_session_id = session.id
            return session.user
        if session:
            session.revoked_at = datetime.now(UTC)
            await db.commit()

    logger.warning(
        "Auth denied for %s %s (IP: %s)",
        request.method,
        request.url.path,
        request.client.host if request.client else "unknown",
    )
    raise HTTPException(status_code=401, detail="请先登录")


async def revoke_current_session(request: Request, db: AsyncSession) -> None:
    session_id = getattr(request.state, "auth_session_id", None)
    if not session_id:
        return
    session = await db.get(AuthSession, session_id)
    if session and session.revoked_at is None:
        session.revoked_at = datetime.now(UTC)
        await db.commit()
