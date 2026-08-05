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

        long_content = (
            "小学时，我在矿区学校读书。刘老师常提醒我，把煤车经过时的声音、结冰的窗户、"
            "教室里的光都写进作文。父亲每天清晨骑车送我上学，车轮碾过冻硬的土路，"
            "我坐在后座上听见风从耳边过去。那时候我还不知道什么叫文学，只知道有些画面"
            "如果不写下来，好像就会从生活里漏掉。"
            "\n\n"
            "那间教室很小，冬天窗户边总有一层白霜。刘老师会把炉子拨旺一点，再让我们"
            "把手搓热，慢慢写当天看到的东西。我第一次把作文交上去时，只写了煤车、操场、"
            "父亲的棉帽和母亲补过的书包。刘老师没有说漂亮话，她只是把作文贴在黑板旁边，"
            "让我自己去看。那一刻我很害羞，也很骄傲。"
            "\n\n"
            "后来我选择师范，其实不是突然做出的决定。它来自很多个这样的早晨：有人认真读"
            "一个孩子写下的笨拙句子，有人相信普通生活也值得被写进纸上。多年以后我回到"
            "小地方教书，还是会想起那扇结冰的窗户。它提醒我，教育不是把人带离自己的出身，"
            "而是让人知道，自己的出身也有被看见、被理解、被郑重讲述的价值。"
            "\n\n"
        ) * 5

        await client.patch(
            f"/api/chapters/{chapter_id}",
            json={"content_md": long_content},
        )
        async with async_session() as db:
            session = InterviewSession(project_id=project_id, chapter_id=chapter_id)
            db.add(session)
            await db.commit()
            db.add_all([
                InterviewMessage(
                    session_id=session.id,
                    role="user",
                    content="小学时我在矿区学校读书，刘老师常让我把煤车和教室写进作文。那是冬天，窗户会结冰。",
                ),
                InterviewMessage(
                    session_id=session.id,
                    role="user",
                    content="父亲每天清晨骑车送我上学，我坐在后座上听见风和煤车的声音。",
                ),
                InterviewMessage(
                    session_id=session.id,
                    role="user",
                    content="刘老师把我的作文贴在黑板旁边，我很害羞，也第一次觉得普通生活值得被写下来。",
                ),
                InterviewMessage(
                    session_id=session.id,
                    role="user",
                    content="母亲给我补过书包，那些细节后来都进入了我的课堂和作文训练。",
                ),
                InterviewMessage(
                    session_id=session.id,
                    role="user",
                    content="后来我选择师范，是因为那段经历让我相信文字能照亮普通人的生活，也让我愿意回到小地方教书。",
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
