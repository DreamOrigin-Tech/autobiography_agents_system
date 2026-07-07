"""Simple in-memory rate limiter for LLM-heavy endpoints."""

import logging
import time
from collections import defaultdict

from fastapi import HTTPException, Request

logger = logging.getLogger(__name__)

# Default: 20 requests per minute for LLM endpoints
RATE_LIMIT_RPM = 20

_requests: dict[str, list[float]] = defaultdict(list)


def rate_limit_llm(request: Request):
    """Limit LLM-heavy endpoints to RATE_LIMIT_RPM requests per minute per IP."""
    client_ip = request.client.host if request.client else "unknown"
    now = time.time()
    window = now - 60  # 1 minute window

    # Clean old entries
    _requests[client_ip] = [t for t in _requests[client_ip] if t > window]

    if len(_requests[client_ip]) >= RATE_LIMIT_RPM:
        logger.warning("Rate limit hit for IP=%s count=%d", client_ip, len(_requests[client_ip]))
        raise HTTPException(
            status_code=429,
            detail="请求过于频繁，请稍后重试（每分钟 {} 次）".format(RATE_LIMIT_RPM),
        )

    _requests[client_ip].append(now)
