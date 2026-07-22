import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import async_session
from app.db.session import init_db
from app.main import app
from app.models import InterviewMessage, InterviewSession
from conftest import login_test_user


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()
    yield


@pytest.mark.asyncio
async def test_publish_and_public_share():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await login_test_user(client)
        create_res = await client.post("/api/projects", json={"title": "发布测试"})
        project_id = create_res.json()["id"]
        await client.post(
            f"/api/projects/{project_id}/plan",
            json={"author_background": "测试"},
        )
        project = (await client.get(f"/api/projects/{project_id}")).json()
        chapter_id = project["chapters"][0]["id"]

        fail_res = await client.post(f"/api/projects/{project_id}/publish")
        assert fail_res.status_code == 400

        await client.patch(
            f"/api/chapters/{chapter_id}",
            json={
                "content_md": (
                    "小学时，我在矿区学校读书。刘老师常提醒我，把煤车经过时的声音、结冰的窗户、"
                    "教室里的光都写进作文。那些语文课让我觉得温暖，也影响了我后来选择师范。"
                )
            },
        )
        async with async_session() as db:
            session = InterviewSession(project_id=project_id, chapter_id=chapter_id)
            db.add(session)
            await db.commit()
            db.add_all([
                InterviewMessage(
                    session_id=session.id,
                    role="user",
                    content="小学时我在矿区学校读书，刘老师常让我把煤车和教室写进作文。",
                ),
                InterviewMessage(
                    session_id=session.id,
                    role="user",
                    content="那时窗户会结冰，我觉得语文课很温暖，也影响了我后来选择师范。",
                ),
            ])
            await db.commit()

        pub_res = await client.post(f"/api/projects/{project_id}/publish")
        assert pub_res.status_code == 200
        token = pub_res.json()["share_token"]
        assert token

        public_res = await client.get(f"/api/public/share/{token}")
        assert public_res.status_code == 200
        data = public_res.json()
        assert data["title"] == "发布测试"
        assert len(data["chapters"]) == 1
        assert "矿区学校" in data["chapters"][0]["content_md"]

        await client.post(f"/api/projects/{project_id}/unpublish")
        hidden = await client.get(f"/api/public/share/{token}")
        assert hidden.status_code == 404


@pytest.mark.asyncio
async def test_publish_blocks_risky_chapters():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await login_test_user(client)
        create_res = await client.post(
            "/api/projects",
            json={"title": "风险发布测试", "preference_notes": "不要写张三"},
        )
        project_id = create_res.json()["id"]
        await client.post(
            f"/api/projects/{project_id}/plan",
            json={"author_background": "测试"},
        )
        project = (await client.get(f"/api/projects/{project_id}")).json()
        chapter_id = project["chapters"][0]["id"]
        await client.patch(
            f"/api/chapters/{chapter_id}",
            json={"content_md": "张三出现在这一章里。" * 20},
        )

        pub_res = await client.post(f"/api/projects/{project_id}/publish")

    assert pub_res.status_code == 400
    assert "质量风险偏高" in pub_res.json()["detail"]
