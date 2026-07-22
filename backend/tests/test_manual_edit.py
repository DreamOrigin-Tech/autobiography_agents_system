import pytest
from httpx import ASGITransport, AsyncClient

from app.db.session import init_db
from app.main import app
from conftest import login_test_user


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()
    yield


@pytest.mark.asyncio
async def test_manual_update_chapter():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await login_test_user(client)
        create_res = await client.post("/api/projects", json={"title": "手动编辑测试"})
        project_id = create_res.json()["id"]
        await client.post(
            f"/api/projects/{project_id}/plan",
            json={"author_background": "测试"},
        )
        project = await client.get(f"/api/projects/{project_id}")
        chapter_id = project.json()["chapters"][0]["id"]

        update_res = await client.patch(
            f"/api/chapters/{chapter_id}",
            json={"content_md": "这是手动编辑的第一段。\n\n这是第二段。"},
        )
        assert update_res.status_code == 200
        data = update_res.json()
        assert "手动编辑" in data["content_md"]
        assert data["status"] == "done"

        revs = await client.get(f"/api/chapters/{chapter_id}/revisions")
        assert revs.status_code == 200
        assert any(r["instruction"] == "手动编辑" for r in revs.json())
