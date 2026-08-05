import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db.session import async_session
from app.db.session import init_db
from app.main import app
from app.models import Chapter, ChapterStatus, InterviewSession, Project, ProjectStatus
from app.schemas import OutlineChapterPlan
from app.agents import interview_assistant
from app.services import interview_service, outline_interview_service, project_service
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
async def test_create_and_plan_project(monkeypatch):
    async def fake_next_turn(_title, messages):
        answer_count = sum(1 for message in messages if message["role"] == "user")
        return {
            "reply": "这些内容已经可以整理章节了。" if answer_count >= 3 else "再聊一个重要的人生转折？",
            "ready": answer_count >= 3,
            "reason": "test",
        }

    async def fake_next_chapter(_title, _context, existing, direction, _style):
        order = len(existing) + 1
        return OutlineChapterPlan(
            order=order,
            title="北方小城的童年" if order == 1 else "三十岁的职业转弯",
            interview_topics=[direction or "成长环境", "重要人物", "一个具体画面"],
        )

    monkeypatch.setattr(outline_interview_service, "generate_next_turn", fake_next_turn)
    monkeypatch.setattr(project_service, "generate_next_chapter", fake_next_chapter)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await login_test_user(client)
        create_res = await client.post("/api/projects", json={"title": "测试自传"})
        assert create_res.status_code == 200
        project = create_res.json()
        project_id = project["id"]

        start_res = await client.post(f"/api/projects/{project_id}/outline-interview/start")
        assert start_res.status_code == 200
        assert start_res.json()["answer_count"] == 0

        for answer in ("我在北方小城长大。", "三十岁时换了职业。", "母亲对我影响最大。"):
            answer_res = await client.post(
                f"/api/projects/{project_id}/outline-interview/answer",
                json={"content": answer},
            )
            assert answer_res.status_code == 200

        interview = answer_res.json()
        assert interview["ready"] is True
        assert interview["answer_count"] == 3
        assert interview["can_generate"] is True

        resumed = await client.post(f"/api/projects/{project_id}/outline-interview/start")
        assert resumed.json()["messages"] == interview["messages"]

        plan_res = await client.post(f"/api/projects/{project_id}/plan", json={})
        assert plan_res.status_code == 200
        planned = plan_res.json()
        assert len(planned["chapters"]) == 1
        assert planned["chapters"][0]["title"] == "北方小城的童年"

        repeat_res = await client.post(
            f"/api/projects/{project_id}/plan",
            json={"author_background": "重复提交不应再次生成"},
        )
        assert repeat_res.status_code == 200
        assert [chapter["id"] for chapter in repeat_res.json()["chapters"]] == [
            chapter["id"] for chapter in planned["chapters"]
        ]

        blocked_next = await client.post(
            f"/api/projects/{project_id}/chapters/next",
            json={"direction": "三十岁换职业的经历"},
        )
        assert blocked_next.status_code == 409

        async with async_session() as db:
            chapter = (
                await db.execute(select(Chapter).where(Chapter.project_id == project_id))
            ).scalar_one()
            project_model = (
                await db.execute(select(Project).where(Project.id == project_id))
            ).scalar_one()
            chapter.status = ChapterStatus.DONE
            chapter.summary = "我在北方小城长大，三十岁时决定换职业。"
            project_model.status = ProjectStatus.REVIEWING
            await db.commit()

        next_res = await client.post(
            f"/api/projects/{project_id}/chapters/next",
            json={"direction": "三十岁换职业的经历"},
        )
        assert next_res.status_code == 200
        assert [chapter["title"] for chapter in next_res.json()["chapters"]] == [
            "北方小城的童年",
            "三十岁的职业转弯",
        ]

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
async def test_interview_assistant_records_live_interview_turns(monkeypatch):
    async def fake_assistant_brief(_title, _topics, _messages, _coverage_context=None):
        return {
            "next_questions": ["您刚才说到母亲，当时她具体做了什么？"],
            "followup_focus": ["母亲的动作", "当时地点"],
            "missing_facts": ["时间", "地点"],
            "live_summary": "已经出现关键人物，可以顺着动作追问。",
            "caution": "一次只问一件事。",
            "suggested_action": "continue",
            "reason": "test",
        }

    monkeypatch.setattr(interview_service, "generate_assistant_brief", fake_assistant_brief)
    monkeypatch.setattr(interview_assistant, "generate_assistant_brief", fake_assistant_brief)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await login_test_user(client)
        create_res = await client.post("/api/projects", json={"title": "助理模式测试"})
        project_id = create_res.json()["id"]
        await client.post(
            f"/api/projects/{project_id}/plan",
            json={"author_background": "测试作者"},
        )
        project = (await client.get(f"/api/projects/{project_id}")).json()
        chapter_id = project["chapters"][0]["id"]

        interviewer_res = await client.post(
            f"/api/chapters/{chapter_id}/interview/assistant/record",
            json={"role": "interviewer", "content": "您小时候和母亲最常一起做什么？"},
        )
        assert interviewer_res.status_code == 200
        assert interviewer_res.json()["transcript_stats"]["interviewer_turns"] == 1

        user_res = await client.post(
            f"/api/chapters/{chapter_id}/interview/assistant/record",
            json={"role": "user", "content": "母亲常带我去河边洗衣服，我在旁边捡石头。"},
        )
        assert user_res.status_code == 200
        data = user_res.json()
        assert data["next_questions"] == ["您刚才说到母亲，当时她具体做了什么？"]
        assert data["transcript_stats"]["interviewee_turns"] == 1
        assert data["chapter_coverage"]["score"] >= 1

        messages = (await client.get(f"/api/chapters/{chapter_id}/interview/messages")).json()
        assert [message["role"] for message in messages] == ["interviewer", "user"]


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
