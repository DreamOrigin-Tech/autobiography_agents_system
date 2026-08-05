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
async def test_tts_requires_login(monkeypatch):
    monkeypatch.setattr(settings, "dev_auth_bypass", False)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/tts", json={"text": "测试语音"})

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_tts_requires_dashscope_key(monkeypatch):
    async def fake_synthesize_speech(_text: str) -> bytes:
        raise routes.tts_service.TTSConfigurationError(
            "未配置 DASHSCOPE_API_KEY，请在 backend/.env 中设置"
        )

    monkeypatch.setattr(routes.tts_service, "synthesize_speech", fake_synthesize_speech)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await login_test_user(client)
        response = await client.post("/api/tts", json={"text": "我们继续聊聊童年的一个画面。"})

    assert response.status_code == 503
    assert "DASHSCOPE_API_KEY" in response.json()["detail"]


@pytest.mark.asyncio
async def test_tts_upstream_failure_returns_502(monkeypatch):
    async def fake_synthesize_speech(_text: str) -> bytes:
        raise routes.tts_service.TTSSynthesisError("upstream failed")

    monkeypatch.setattr(routes.tts_service, "synthesize_speech", fake_synthesize_speech)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await login_test_user(client)
        response = await client.post("/api/tts", json={"text": "我们继续聊聊童年的一个画面。"})

    assert response.status_code == 502
    assert response.json()["detail"] == "语音合成服务暂时不可用"


@pytest.mark.asyncio
async def test_tts_returns_audio_from_synthesis_service(monkeypatch):
    async def fake_synthesize_speech(text: str) -> bytes:
        assert text == "我们继续聊聊童年的一个画面。"
        return b"ID3 fake mp3 bytes"

    monkeypatch.setattr(routes.tts_service, "synthesize_speech", fake_synthesize_speech)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await login_test_user(client)
        response = await client.post("/api/tts", json={"text": "我们继续聊聊童年的一个画面。"})

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.headers["cache-control"] == "no-store"
    assert response.content == b"ID3 fake mp3 bytes"
