import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import async_session
from app.db.session import init_db
from app.main import app
from app.models import InterviewSession
from app.services import interview_service
from conftest import login_test_user


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()
    yield


@pytest.mark.asyncio
async def test_health():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/health")
        assert res.status_code == 200
        assert res.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_dev_cors_allows_auto_selected_localhost_ports():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.options(
            "/api/projects",
            headers={
                "Origin": "http://localhost:3002",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert res.status_code == 200
        assert res.headers["access-control-allow-origin"] == "http://localhost:3002"


@pytest.mark.asyncio
async def test_create_and_plan_project():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await login_test_user(client)
        create_res = await client.post("/api/projects", json={"title": "测试自传"})
        assert create_res.status_code == 200
        project = create_res.json()
        project_id = project["id"]

        plan_res = await client.post(
            f"/api/projects/{project_id}/plan",
            json={"author_background": "测试作者"},
        )
        assert plan_res.status_code == 200
        planned = plan_res.json()
        assert len(planned["chapters"]) >= 5

        get_res = await client.get(f"/api/projects/{project_id}")
        assert get_res.status_code == 200


@pytest.mark.asyncio
async def test_project_preferences_round_trip():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await login_test_user(client)
        create_res = await client.post(
            "/api/projects",
            json={
                "title": "偏好测试",
                "style_notes": "温情真实",
                "preference_notes": "不要写真实姓名",
            },
        )
        assert create_res.status_code == 200
        project = create_res.json()
        assert project["preference_notes"] == "不要写真实姓名"

        update_res = await client.patch(
            f"/api/projects/{project['id']}",
            json={
                "preference_notes": "多追问家庭细节",
                "memory_notes": "- 我喜欢按时间线讲",
            },
        )
        assert update_res.status_code == 200
        updated = update_res.json()
        assert updated["preference_notes"] == "多追问家庭细节"
        assert updated["memory_notes"] == "- 我喜欢按时间线讲"


@pytest.mark.asyncio
async def test_write_readiness_reports_material_gap():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await login_test_user(client)
        create_res = await client.post("/api/projects", json={"title": "素材进度测试"})
        project_id = create_res.json()["id"]
        await client.post(
            f"/api/projects/{project_id}/plan",
            json={"author_background": "测试作者"},
        )
        project = (await client.get(f"/api/projects/{project_id}")).json()
        chapter_id = project["chapters"][0]["id"]

        res = await client.get(f"/api/chapters/{chapter_id}/write/readiness")
        assert res.status_code == 200
        data = res.json()
        assert data["ready"] is False
        assert data["user_answers"] == 0
        assert data["min_user_answers"] >= 1
        assert "采访素材还不够" in data["message"]


@pytest.mark.asyncio
async def test_project_updated_at_tracks_creative_activity():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await login_test_user(client)
        create_res = await client.post("/api/projects", json={"title": "更新时间测试"})
        project_id = create_res.json()["id"]
        await client.post(
            f"/api/projects/{project_id}/plan",
            json={"author_background": "测试作者"},
        )
        project = (await client.get(f"/api/projects/{project_id}")).json()
        chapter_id = project["chapters"][0]["id"]
        planned_at = project["updated_at"]

        await client.patch(
            f"/api/chapters/{chapter_id}",
            json={"content_md": "我在老家院子里学会写字，这件事让我一直记得。"},
        )
        after_manual = (await client.get(f"/api/projects/{project_id}")).json()
        assert after_manual["updated_at"] != planned_at

        async with async_session() as db:
            session = InterviewSession(project_id=project_id, chapter_id=chapter_id)
            db.add(session)
            await db.commit()
            await db.refresh(session)
            await interview_service.add_message(
                db,
                session,
                "user",
                "我希望后面多追问当时家人的反应。",
            )

        after_interview = (await client.get(f"/api/projects/{project_id}")).json()
        assert after_interview["updated_at"] != after_manual["updated_at"]


@pytest.mark.asyncio
async def test_chapter_coverage_endpoint_reports_missing_dimensions():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await login_test_user(client)
        create_res = await client.post("/api/projects", json={"title": "完成度测试"})
        project_id = create_res.json()["id"]
        await client.post(
            f"/api/projects/{project_id}/plan",
            json={"author_background": "测试作者"},
        )
        project = (await client.get(f"/api/projects/{project_id}")).json()
        chapter_id = project["chapters"][0]["id"]

        res = await client.get(f"/api/chapters/{chapter_id}/coverage")
        assert res.status_code == 200
        data = res.json()
        assert data["score"] == 0
        assert data["max_score"] == 5
        assert data["percent"] == 0
        assert "时间" in data["missing_dimensions"]
        assert data["next_suggestion"]


@pytest.mark.asyncio
async def test_publish_readiness_reports_no_completed_chapters():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await login_test_user(client)
        create_res = await client.post("/api/projects", json={"title": "发布检查测试"})
        project_id = create_res.json()["id"]

        res = await client.get(f"/api/projects/{project_id}/publish/readiness")
        assert res.status_code == 200
        data = res.json()
        assert data["ready"] is False
        assert data["publishable_chapter_count"] == 0
        assert "至少完成一个章节" in data["message"]
