import uuid

from app.services import tts_service


class FakeCosyVoiceWebSocket:
    def __init__(self):
        self.sent_messages = []
        self.responses = [
            '{"header":{"event":"task-started"}}',
            b"mp3-part-1",
            b"mp3-part-2",
            '{"header":{"event":"task-finished"}}',
        ]

    async def send(self, message):
        self.sent_messages.append(message)

    async def recv(self):
        return self.responses.pop(0)


class FakeCosyVoiceConnect:
    def __init__(self, websocket):
        self.websocket = websocket

    async def __aenter__(self):
        return self.websocket

    async def __aexit__(self, *_args):
        return None


async def test_synthesize_speech_uses_bearer_auth_and_normalised_text(monkeypatch):
    calls = []

    async def fake_synthesize_with_headers(text, task_id, voice, headers, headers_arg):
        calls.append(
            {
                "text": text,
                "task_id": task_id,
                "voice": voice,
                "headers": headers,
                "headers_arg": headers_arg,
            }
        )
        return b"audio"

    monkeypatch.setattr(tts_service.settings, "dashscope_api_key", "test-dashscope-key")
    monkeypatch.setattr(tts_service.settings, "tts_voice", "custom-voice-id")
    monkeypatch.setattr(tts_service, "_synthesize_with_headers", fake_synthesize_with_headers)

    audio = await tts_service.synthesize_speech("  讲讲\n那时候的一个画面。  ")

    assert audio == b"audio"
    assert calls == [
        {
            "text": "讲讲 那时候的一个画面。",
            "task_id": calls[0]["task_id"],
            "voice": "custom-voice-id",
            "headers": {
                "Authorization": "Bearer test-dashscope-key",
                "user-agent": "autobiography-agents-system/0.2",
            },
            "headers_arg": "additional_headers",
        }
    ]
    assert str(uuid.UUID(calls[0]["task_id"])) == calls[0]["task_id"]


async def test_synthesize_with_headers_sends_messages_and_collects_audio(monkeypatch):
    websocket = FakeCosyVoiceWebSocket()

    def fake_connect(_url, **_kwargs):
        return FakeCosyVoiceConnect(websocket)

    monkeypatch.setattr(tts_service.websockets, "connect", fake_connect)

    audio = await tts_service._synthesize_with_headers(
        "讲一个画面。",
        "task-123",
        "custom-voice-id",
        {"Authorization": "Bearer test-key"},
        "additional_headers",
    )

    assert audio == b"mp3-part-1mp3-part-2"
    assert len(websocket.sent_messages) == 3
    assert '"action": "run-task"' in websocket.sent_messages[0]
    assert '"voice": "custom-voice-id"' in websocket.sent_messages[0]
    assert '"action": "continue-task"' in websocket.sent_messages[1]
    assert '"text": "讲一个画面。"' in websocket.sent_messages[1]
    assert '"action": "finish-task"' in websocket.sent_messages[2]


async def test_synthesize_speech_requires_voice(monkeypatch):
    monkeypatch.setattr(tts_service.settings, "dashscope_api_key", "test-dashscope-key")
    monkeypatch.setattr(tts_service.settings, "tts_voice", "")

    try:
        await tts_service.synthesize_speech("测试")
    except tts_service.TTSConfigurationError as exc:
        assert "TTS_VOICE" in str(exc)
    else:
        raise AssertionError("expected TTSConfigurationError")


def test_run_task_message_uses_configured_defaults():
    message = tts_service.build_run_task_message(
        task_id="task-123",
        model="qwen-audio-3.0-tts-flash",
        voice="longanhuan_v3.6",
        audio_format="mp3",
        sample_rate=22050,
        rate=0.95,
        pitch=1.0,
    )

    assert message["header"] == {
        "action": "run-task",
        "task_id": "task-123",
        "streaming": "duplex",
    }
    assert message["payload"]["task_group"] == "audio"
    assert message["payload"]["task"] == "tts"
    assert message["payload"]["function"] == "SpeechSynthesizer"
    assert message["payload"]["model"] == "qwen-audio-3.0-tts-flash"
    assert message["payload"]["input"] == {}
    assert message["payload"]["parameters"] == {
        "text_type": "PlainText",
        "voice": "longanhuan_v3.6",
        "format": "mp3",
        "sample_rate": 22050,
        "volume": 50,
        "rate": 0.95,
        "pitch": 1.0,
        "enable_ssml": False,
        "language_hints": ["zh"],
    }


def test_cosyvoice_continue_and_finish_messages_share_task_id():
    continue_message = tts_service.build_continue_task_message("task-123", "讲一段童年的故事。")
    finish_message = tts_service.build_finish_task_message("task-123")

    assert continue_message == {
        "header": {
            "action": "continue-task",
            "task_id": "task-123",
            "streaming": "duplex",
        },
        "payload": {
            "input": {
                "text": "讲一段童年的故事。",
            },
        },
    }
    assert finish_message == {
        "header": {
            "action": "finish-task",
            "task_id": "task-123",
            "streaming": "duplex",
        },
        "payload": {
            "input": {},
        },
    }
