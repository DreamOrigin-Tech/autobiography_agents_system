import base64

from app import config
from app.services import asr_service


def test_build_audio_data_url_uses_declared_mime_type():
    data_url = asr_service.build_audio_data_url(b"fake audio", "audio/webm;codecs=opus")

    assert data_url == "data:audio/webm;base64,ZmFrZSBhdWRpbw=="


def test_build_asr_request_uses_qwen_audio_message_shape():
    payload = asr_service.build_asr_request(
        model="qwen3-asr-flash",
        audio_data_url="data:audio/wav;base64,AAA=",
        language="zh",
        enable_itn=False,
    )

    assert payload == {
        "model": "qwen3-asr-flash",
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {"data": "data:audio/wav;base64,AAA="},
                    }
                ],
            }
        ],
        "stream": False,
        "asr_options": {
            "language": "zh",
            "enable_itn": False,
        },
    }


def test_parse_asr_response_reads_openai_compatible_message_content():
    text = asr_service.parse_asr_response(
        {
            "choices": [
                {
                    "message": {
                        "content": "我记得那年冬天很冷。"
                    }
                }
            ]
        }
    )

    assert text == "我记得那年冬天很冷。"


def test_parse_asr_response_reads_dashscope_output_fallback():
    text = asr_service.parse_asr_response(
        {
            "output": {
                "text": "那时候院子里有一棵树。",
            }
        }
    )

    assert text == "那时候院子里有一棵树。"


async def test_transcribe_audio_requires_dashscope_key(monkeypatch):
    monkeypatch.setattr(asr_service.settings, "dashscope_api_key", "")
    monkeypatch.setattr(config, "_read_env_file", lambda _key: "")
    monkeypatch.setattr(asr_service.settings, "asr_model", "qwen3-asr-flash")

    try:
        await asr_service.transcribe_audio_bytes(b"fake audio", "audio/webm")
    except asr_service.ASRConfigurationError as exc:
        assert "DASHSCOPE_API_KEY" in str(exc)
    else:
        raise AssertionError("expected ASRConfigurationError")


async def test_transcribe_audio_rejects_oversized_audio(monkeypatch):
    monkeypatch.setattr(asr_service.settings, "dashscope_api_key", "test-key")
    monkeypatch.setattr(asr_service.settings, "asr_max_audio_bytes", 3)

    try:
        await asr_service.transcribe_audio_bytes(b"fake audio", "audio/webm")
    except ValueError as exc:
        assert "音频太长" in str(exc)
    else:
        raise AssertionError("expected ValueError")
