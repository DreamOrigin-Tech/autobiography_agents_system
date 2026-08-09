from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth import create_session
from app.db.session import async_session, init_db
from app.main import app
from app.models import Chapter, ChapterStatus, Project, User


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()
    yield


async def _user_with_token(name: str, openid: str) -> tuple[User, str]:
    async with async_session() as db:
        user = User(name=name, auth_provider="wechat", wechat_openid=openid)
        db.add(user)
        await db.flush()
        token = await create_session(db, user)
        await db.commit()
        await db.refresh(user)
        return user, token


async def _published_project(user: User) -> Project:
    async with async_session() as db:
        project = Project(
            user_id=user.id,
            title=f"{user.name} 的自传",
            is_published=True,
            share_token=f"token-{user.id}",
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
                summary="这是一个关于成长与选择的故事。",
                content_md="这是一个关于成长与选择的故事。" * 20,
            )
        )
        await db.commit()
        await db.refresh(project)
        return project


@pytest.mark.asyncio
async def test_community_publish_comment_follow_and_messages():
    user_a, token_a = await _user_with_token("作者 A", "community-openid-a")
    user_b, token_b = await _user_with_token("读者 B", "community-openid-b")
    project = await _published_project(user_a)
    transport = ASGITransport(app=app)

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": f"Bearer {token_a}"},
    ) as client_a:
        publish = await client_a.post(f"/api/projects/{project.id}/community/publish")
        assert publish.status_code == 200, publish.text
        post = publish.json()["post"]
        assert post["title"] == "作者 A 的自传"
        assert post["share_token"] == project.share_token
        assert post["is_author_current_user"] is True

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": f"Bearer {token_b}"},
    ) as client_b:
        posts = await client_b.get("/api/community/posts")
        assert posts.status_code == 200
        assert posts.json()[0]["id"] == post["id"]
        assert posts.json()[0]["is_author_current_user"] is False

        followed = await client_b.post(f"/api/community/users/{user_a.id}/follow")
        assert followed.status_code == 200
        assert followed.json()["is_following"] is True
        assert followed.json()["follower_count"] == 1

        comment = await client_b.post(
            f"/api/community/posts/{post['id']}/comments",
            json={"content": "读完很受触动，尤其是第一章。"},
        )
        assert comment.status_code == 200
        assert comment.json()["author"]["id"] == user_b.id

        detail = await client_b.get(f"/api/community/posts/{post['id']}")
        assert detail.status_code == 200
        assert detail.json()["comment_count"] == 1
        assert detail.json()["comments"][0]["content"].startswith("读完")

        message = await client_b.post(
            "/api/community/messages",
            json={"recipient_id": user_a.id, "content": "想和您聊聊这本书。"},
        )
        assert message.status_code == 200
        assert message.json()["sender"]["id"] == user_b.id

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": f"Bearer {token_a}"},
    ) as client_a:
        conversations = await client_a.get("/api/community/messages/conversations")
        assert conversations.status_code == 200
        assert conversations.json()[0]["user"]["id"] == user_b.id
        assert conversations.json()[0]["unread_count"] == 1

        thread = await client_a.get(f"/api/community/messages/{user_b.id}")
        assert thread.status_code == 200
        assert thread.json()[0]["content"] == "想和您聊聊这本书。"

        conversations_after_read = await client_a.get("/api/community/messages/conversations")
        assert conversations_after_read.json()[0]["unread_count"] == 0

    async with async_session() as db:
        stored = await db.get(Project, project.id)
        stored.is_published = False
        await db.commit()

    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": f"Bearer {token_b}"},
    ) as client_b:
        hidden_posts = await client_b.get("/api/community/posts")
        assert hidden_posts.status_code == 200
        assert hidden_posts.json() == []
        hidden_detail = await client_b.get(f"/api/community/posts/{post['id']}")
        assert hidden_detail.status_code == 404
