from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode

import httpx
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import User

WECHAT_AUTHORIZE_URL = "https://open.weixin.qq.com/connect/qrconnect"
WECHAT_TOKEN_URL = "https://api.weixin.qq.com/sns/oauth2/access_token"
WECHAT_USERINFO_URL = "https://api.weixin.qq.com/sns/userinfo"


def build_authorize_url(state: str) -> str:
    query = urlencode(
        {
            "appid": settings.wechat_app_id,
            "redirect_uri": settings.resolved_wechat_redirect_uri,
            "response_type": "code",
            "scope": "snsapi_login",
            "state": state,
        }
    )
    return f"{WECHAT_AUTHORIZE_URL}?{query}#wechat_redirect"


def _ensure_wechat_success(payload: dict[str, Any], action: str) -> dict[str, Any]:
    if payload.get("errcode"):
        raise ValueError(f"微信{action}失败，请重新尝试")
    return payload


async def exchange_code(code: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            WECHAT_TOKEN_URL,
            params={
                "appid": settings.wechat_app_id,
                "secret": settings.wechat_app_secret,
                "code": code,
                "grant_type": "authorization_code",
            },
        )
        response.raise_for_status()
        payload = _ensure_wechat_success(response.json(), "授权")
    if not payload.get("access_token") or not payload.get("openid"):
        raise ValueError("微信授权信息不完整，请重新尝试")
    return payload


async def fetch_userinfo(access_token: str, openid: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            WECHAT_USERINFO_URL,
            params={
                "access_token": access_token,
                "openid": openid,
                "lang": "zh_CN",
            },
        )
        response.raise_for_status()
        payload = _ensure_wechat_success(response.json(), "用户信息获取")
    if not payload.get("openid"):
        raise ValueError("微信用户信息不完整，请重新尝试")
    return payload


async def upsert_wechat_user(db: AsyncSession, profile: dict[str, Any]) -> User:
    openid = str(profile.get("openid") or "").strip()
    unionid = str(profile.get("unionid") or "").strip() or None
    if not openid:
        raise ValueError("微信用户信息不完整，请重新尝试")

    conditions = [User.wechat_openid == openid]
    if unionid:
        conditions.insert(0, User.wechat_unionid == unionid)
    result = await db.execute(select(User).where(or_(*conditions)).limit(1))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(
            name=str(profile.get("nickname") or "微信用户")[:255],
            auth_provider="wechat",
            provider_subject=openid,
            wechat_openid=openid,
            wechat_unionid=unionid,
            avatar_url=str(profile.get("headimgurl") or "")[:1024] or None,
        )
        db.add(user)
        await db.flush()
    else:
        user.auth_provider = "wechat"
        user.provider_subject = openid
        user.wechat_openid = openid
        if unionid:
            user.wechat_unionid = unionid
        nickname = str(profile.get("nickname") or "").strip()
        if nickname:
            user.name = nickname[:255]
        avatar_url = str(profile.get("headimgurl") or "").strip()
        if avatar_url:
            user.avatar_url = avatar_url[:1024]
    user.last_login_at = datetime.now(UTC)
    await db.flush()
    return user
