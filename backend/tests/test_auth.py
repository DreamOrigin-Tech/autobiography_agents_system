from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth import create_oauth_state, create_session, consume_oauth_state, hash_token
from app.db.session import async_session, init_db
from app.main import app
from app.models import Chapter, ChapterStatus, Project, User
from app.services import wechat_auth


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()
    yield


async def _user_with_token(name: str, openid: str) -> tuple[User, str]:
    async with async_session() as db:
        user = User(
            name=name,
            auth_provider="wechat",
            wechat_openid=openid,
        )
        db.add(user)
        await db.flush()
        token = await create_session(db, user)
        await db.commit()
        await db.refresh(user)
        return user, token


@pytest.mark.asyncio
async def test_private_api_requires_login():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/projects")

    assert response.status_code == 401
    assert response.json()["detail"] == "请先登录"


@pytest.mark.asyncio
async def test_local_login_me_and_logout_invalidates_session():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        login = await client.post(
            "/api/auth/login",
            json={"password": "test-password"},
        )
        assert login.status_code == 200
        assert "httponly" in login.headers["set-cookie"].lower()
        assert "test-wechat-secret" not in login.text

        me = await client.get("/api/auth/me")
        assert me.status_code == 200
        assert me.json()["auth_provider"] == "local"

        logout = await client.post("/api/auth/logout")
        assert logout.status_code == 204
        assert (await client.get("/api/auth/me")).status_code == 401


@pytest.mark.asyncio
async def test_auth_provider_configuration_never_exposes_secrets():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/auth/providers")

    assert response.status_code == 200
    data = response.json()
    assert data["wechat_enabled"] is True
    assert data["password_enabled"] is True
    assert data["wechat_issues"] == []
    assert data["wechat_redirect_uri"] == "http://test/api/auth/wechat/callback"
    assert "secret" not in response.text.lower()


@pytest.mark.asyncio
async def test_users_cannot_access_each_others_projects_or_chapters():
    user_a, token_a = await _user_with_token("用户 A", "openid-a")
    _, token_b = await _user_with_token("用户 B", "openid-b")
    transport = ASGITransport(app=app)

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": f"Bearer {token_a}"},
    ) as client_a:
        created = await client_a.post("/api/projects", json={"title": "A 的自传"})
        assert created.status_code == 200
        project_id = created.json()["id"]

    async with async_session() as db:
        chapter = Chapter(
            project_id=project_id,
            order=1,
            title="A 的童年",
            status=ChapterStatus.DONE,
            content_md="这是用户 A 的私密内容。",
        )
        db.add(chapter)
        await db.commit()
        await db.refresh(chapter)
        chapter_id = chapter.id

    private_requests = [
        ("GET", f"/api/projects/{project_id}", None),
        ("PATCH", f"/api/projects/{project_id}", {"title": "越权修改"}),
        ("POST", f"/api/projects/{project_id}/plan", {"author_background": "越权"}),
        ("GET", f"/api/projects/{project_id}/chapters", None),
        ("POST", f"/api/projects/{project_id}/publish", None),
        ("GET", f"/api/projects/{project_id}/publish/readiness", None),
        ("POST", f"/api/projects/{project_id}/unpublish", None),
        ("GET", f"/api/projects/{project_id}/timeline", None),
        ("GET", f"/api/projects/{project_id}/review", None),
        ("GET", f"/api/chapters/{chapter_id}", None),
        ("PATCH", f"/api/chapters/{chapter_id}", {"content_md": "越权"}),
        ("POST", f"/api/chapters/{chapter_id}/interview/start", None),
        ("GET", f"/api/chapters/{chapter_id}/interview/messages", None),
        ("POST", f"/api/chapters/{chapter_id}/interview/answer", {"content": "越权"}),
        ("GET", f"/api/chapters/{chapter_id}/interview/stream", None),
        ("POST", f"/api/chapters/{chapter_id}/write", None),
        ("GET", f"/api/chapters/{chapter_id}/write/readiness", None),
        ("GET", f"/api/chapters/{chapter_id}/coverage", None),
        ("GET", f"/api/chapters/{chapter_id}/quality", None),
        ("GET", f"/api/chapters/{chapter_id}/write/stream", None),
        ("POST", f"/api/chapters/{chapter_id}/edit", {"instruction": "越权"}),
        ("GET", f"/api/chapters/{chapter_id}/revisions", None),
        ("GET", f"/api/chapters/{chapter_id}/reflection", None),
    ]

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": f"Bearer {token_b}"},
    ) as client_b:
        projects = await client_b.get("/api/projects")
        assert projects.status_code == 200
        assert projects.json() == []

        for method, path, body in private_requests:
            response = await client_b.request(method, path, json=body)
            assert response.status_code == 404, (method, path, response.text)

        delete = await client_b.delete(f"/api/projects/{project_id}")
        assert delete.status_code == 404

    async with async_session() as db:
        project = await db.get(Project, project_id)
        assert project is not None
        assert project.user_id == user_a.id
        assert project.title == "A 的自传"


@pytest.mark.asyncio
async def test_public_share_remains_anonymous():
    user, _ = await _user_with_token("发布者", "openid-publisher")
    async with async_session() as db:
        project = Project(
            user_id=user.id,
            title="公开自传",
            is_published=True,
            share_token="public-share-token",
            published_at=datetime.now(UTC),
        )
        db.add(project)
        await db.flush()
        db.add(
            Chapter(
                project_id=project.id,
                order=1,
                title="第一章",
                status=ChapterStatus.DONE,
                content_md="可以匿名阅读的内容。",
            )
        )
        await db.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/public/share/public-share-token")

    assert response.status_code == 200
    assert response.json()["chapters"][0]["content_md"] == "可以匿名阅读的内容。"


@pytest.mark.asyncio
async def test_oauth_state_is_single_use_and_rejects_mismatch_or_expiry():
    async with async_session() as db:
        state = await create_oauth_state(db, "/project/demo")
        await db.commit()
        assert await consume_oauth_state(db, state) == "/project/demo"
        with pytest.raises(ValueError, match="登录请求已失效"):
            await consume_oauth_state(db, state)
        with pytest.raises(ValueError, match="登录请求已失效"):
            await consume_oauth_state(db, "mismatched-state")

        expired = await create_oauth_state(db, "/")
        from app.models import OAuthState

        record = (
            await db.execute(
                __import__("sqlalchemy").select(OAuthState).where(
                    OAuthState.state_hash == hash_token(expired)
                )
            )
        ).scalar_one()
        record.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
        with pytest.raises(ValueError, match="登录请求已失效"):
            await consume_oauth_state(db, expired)


@pytest.mark.asyncio
async def test_same_wechat_account_reuses_the_same_local_user():
    async with async_session() as db:
        first = await wechat_auth.upsert_wechat_user(
            db,
            {
                "openid": "same-openid",
                "unionid": "same-unionid",
                "nickname": "第一次昵称",
                "headimgurl": "https://example.test/avatar-1.png",
            },
        )
        await db.commit()
        first_id = first.id

        second = await wechat_auth.upsert_wechat_user(
            db,
            {
                "openid": "same-openid",
                "unionid": "same-unionid",
                "nickname": "更新后的昵称",
                "headimgurl": "https://example.test/avatar-2.png",
            },
        )
        await db.commit()

    assert second.id == first_id
    assert second.name == "更新后的昵称"
    assert second.avatar_url == "https://example.test/avatar-2.png"


@pytest.mark.asyncio
async def test_wechat_start_and_callback_create_authenticated_session(monkeypatch):
    async def fake_exchange_code(_code: str) -> dict[str, str]:
        return {
            "access_token": "wechat-access-token",
            "openid": "callback-openid",
            "unionid": "callback-unionid",
        }

    async def fake_fetch_userinfo(_access_token: str, _openid: str) -> dict[str, str]:
        return {
            "openid": "callback-openid",
            "unionid": "callback-unionid",
            "nickname": "微信用户",
            "headimgurl": "https://example.test/avatar.png",
        }

    monkeypatch.setattr(wechat_auth, "exchange_code", fake_exchange_code)
    monkeypatch.setattr(wechat_auth, "fetch_userinfo", fake_fetch_userinfo)

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        follow_redirects=False,
    ) as client:
        start = await client.get("/api/auth/wechat/start?next=/project/welcome")
        assert start.status_code == 307
        authorize_url = urlparse(start.headers["location"])
        assert authorize_url.netloc == "open.weixin.qq.com"
        query = parse_qs(authorize_url.query)
        assert query["scope"] == ["snsapi_login"]
        assert query["appid"] == ["test-wechat-app"]
        assert "test-wechat-secret" not in start.headers["location"]
        assert "autobiography_oauth_state" in start.headers["set-cookie"]

        callback = await client.get(
            "/api/auth/wechat/callback",
            params={"code": "wechat-code", "state": query["state"][0]},
        )
        assert callback.status_code == 307
        assert callback.headers["location"] == "http://frontend.test/project/welcome"
        assert "httponly" in callback.headers["set-cookie"].lower()

        me = await client.get("/api/auth/me")
        assert me.status_code == 200
        assert me.json()["name"] == "微信用户"
