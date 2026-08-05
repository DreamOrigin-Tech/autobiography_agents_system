import base64

import pytest
from httpx import ASGITransport, AsyncClient

from app.api import routes
from app.config import settings
from app.db.session import init_db
from app.main import app
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
