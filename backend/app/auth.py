"""Simple Bearer-token authentication for single-user deployment."""

import logging
import secrets
from typing import Optional

from fastapi import Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings

logger = logging.getLogger(__name__)

# Optional: if ACCESS_PASSWORD is not set, auth is disabled
AUTH_ENABLED = bool(settings.access_password)

security = HTTPBearer(auto_error=False)


def _check_password(token: str) -> bool:
    return secrets.compare_digest(token, settings.access_password)


async def verify_auth(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    token: str = Query("", alias="token"),
) -> bool:
    """Return True if the request is authenticated (or auth is disabled)."""
    if not AUTH_ENABLED:
        return True

    # Allow OPTIONS (CORS preflight)
    if request.method == "OPTIONS":
        return True

    # Allow public share endpoint
    if request.url.path.startswith("/api/public/"):
        return True

    # Allow health check
    if request.url.path == "/health":
        return True

    # Allow auth login endpoint
    if request.url.path == "/api/auth/login":
        return True

    # Check Bearer header first, then query param (for EventSource SSE)
    if credentials is not None and _check_password(credentials.credentials):
        return True

    if token and _check_password(token):
        return True

    logger.warning("Auth denied for %s %s (IP: %s)", request.method, request.url.path, request.client.host if request.client else "unknown")
    raise HTTPException(status_code=401, detail="请先登录")
