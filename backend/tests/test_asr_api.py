import base64

import pytest
from httpx import ASGITransport, AsyncClient

from app.api import routes
from app.config import settings
from app.db.session import async_session
from app.db.session import init_db
from app.main import app
from app.models import Chapter
from conftest import login_test_user


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()
    yield


@pytest.fixture(autouse=True)
def bypass_rate_limit(monkeypatch):
    monkeypatch.setattr(routes, "rate_limit_llm", lambda _request: None)


@pytest.mark.asyncio
async def test_asr_requires_login(monkeypatch):
    monkeypatch.setattr(settings, "dev_auth_bypass", False)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/asr",
            json={"audio_base64": "ZmFrZQ==", "mime_type": "audio/webm"},
        )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_asr_returns_transcribed_text(monkeypatch):
    async def fake_transcribe_audio_bytes(audio_bytes: bytes, mime_type: str) -> str:
        assert audio_bytes == b"fake audio"
        assert mime_type == "audio/webm"
        return "我记得那年冬天很冷。"

    monkeypatch.setattr(routes.asr_service, "transcribe_audio_bytes", fake_transcribe_audio_bytes)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await login_test_user(client)
        response = await client.post(
            "/api/asr",
            json={
                "audio_base64": base64.b64encode(b"fake audio").decode("ascii"),
                "mime_type": "audio/webm",
            },
        )

    assert response.status_code == 200
    assert response.json() == {"text": "我记得那年冬天很冷。"}


@pytest.mark.asyncio
async def test_asr_rejects_invalid_base64():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await login_test_user(client)
        response = await client.post(
            "/api/asr",
            json={"audio_base64": "not valid base64", "mime_type": "audio/webm"},
        )

    assert response.status_code == 400
    assert "音频数据格式不正确" in response.json()["detail"]


@pytest.mark.asyncio
async def test_asr_upstream_failure_returns_502(monkeypatch):
    async def fake_transcribe_audio_bytes(_audio_bytes: bytes, _mime_type: str) -> str:
        raise routes.asr_service.ASRTranscriptionError("upstream failed")

    monkeypatch.setattr(routes.asr_service, "transcribe_audio_bytes", fake_transcribe_audio_bytes)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await login_test_user(client)
        response = await client.post(
            "/api/asr",
            json={"audio_base64": "ZmFrZQ==", "mime_type": "audio/webm"},
        )

    assert response.status_code == 502
    assert response.json()["detail"] == "语音识别服务暂时不可用"


@pytest.mark.asyncio
async def test_call_audio_records_detected_speaker(monkeypatch):
    async def fake_transcribe_audio_bytes(audio_bytes: bytes, mime_type: str) -> str:
        assert audio_bytes == b"fake audio"
        assert mime_type == "audio/webm"
        return "您刚才说父亲很沉默，能不能讲讲那个晚上？"

    async def fake_generate_assistant_brief(*_args, **_kwargs):
        return {
            "next_questions": ["那个晚上屋里还有谁？"],
            "followup_focus": ["父亲"],
            "missing_facts": [],
            "live_summary": "采访员在追问父亲的场景。",
            "caution": "慢一点",
            "suggested_action": "continue",
            "reason": "test",
        }

    monkeypatch.setattr(routes.asr_service, "transcribe_audio_bytes", fake_transcribe_audio_bytes)
    monkeypatch.setattr(routes.interview_service, "generate_assistant_brief", fake_generate_assistant_brief)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await login_test_user(client)
        project_response = await client.post(
            "/api/projects",
            json={"title": "通话采访测试", "style_notes": "第一人称"},
        )
        assert project_response.status_code == 200, project_response.text
        project_id = project_response.json()["id"]

        async with async_session() as db:
            chapter = Chapter(project_id=project_id, order=1, title="童年", interview_topics='["父亲"]')
            db.add(chapter)
            await db.commit()
            chapter_id = chapter.id

        response = await client.post(
            f"/api/chapters/{chapter_id}/interview/assistant/call-audio",
            json={
                "audio_base64": base64.b64encode(b"fake audio").decode("ascii"),
                "mime_type": "audio/webm",
            },
        )
        messages_response = await client.get(f"/api/chapters/{chapter_id}/interview/messages")

    assert response.status_code == 200
    body = response.json()
    assert body["transcript"] == "您刚才说父亲很沉默，能不能讲讲那个晚上？"
    assert body["detected_role"] == "interviewer"
    messages = messages_response.json()
    assert messages[-1]["role"] == "interviewer"
