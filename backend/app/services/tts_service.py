import asyncio
import json
import logging
import uuid
from typing import Any

import websockets

from app.config import settings

logger = logging.getLogger(__name__)


class TTSConfigurationError(ValueError):
    pass


class TTSSynthesisError(RuntimeError):
    pass


def build_run_task_message(
    *,
    task_id: str,
    model: str,
    voice: str,
    audio_format: str,
    sample_rate: int,
    rate: float,
    pitch: float,
) -> dict[str, Any]:
    return {
        "header": {
            "action": "run-task",
            "task_id": task_id,
            "streaming": "duplex",
        },
        "payload": {
            "task_group": "audio",
            "task": "tts",
            "function": "SpeechSynthesizer",
            "model": model,
            "parameters": {
                "text_type": "PlainText",
                "voice": voice,
                "format": audio_format,
                "sample_rate": sample_rate,
                "volume": settings.tts_volume,
                "rate": rate,
                "pitch": pitch,
                "enable_ssml": False,
                "language_hints": ["zh"],
            },
            "input": {},
        },
    }


def build_continue_task_message(task_id: str, text: str) -> dict[str, Any]:
    return {
        "header": {
            "action": "continue-task",
            "task_id": task_id,
            "streaming": "duplex",
        },
        "payload": {
            "input": {
                "text": text,
            },
        },
    }


def build_finish_task_message(task_id: str) -> dict[str, Any]:
    return {
        "header": {
            "action": "finish-task",
            "task_id": task_id,
            "streaming": "duplex",
        },
        "payload": {
            "input": {},
        },
    }


async def synthesize_speech(text: str) -> bytes:
    api_key = settings.effective_dashscope_api_key
    if not api_key:
        raise TTSConfigurationError("未配置 DASHSCOPE_API_KEY，请在 backend/.env 中设置")
    voice = settings.tts_voice.strip()
    if not voice:
        raise TTSConfigurationError(
            "未配置 TTS_VOICE，请在 backend/.env 中设置与 TTS_MODEL 兼容的 voice id"
        )

    cleaned_text = _normalise_text(text)
    task_id = str(uuid.uuid4())
    headers = {
        "Authorization": f"Bearer {api_key}",
        "user-agent": "autobiography-agents-system/0.2",
    }

    try:
        return await _synthesize_with_headers(
            cleaned_text,
            task_id,
            voice,
            headers,
            "additional_headers",
        )
    except TypeError as exc:
        if "additional_headers" not in str(exc):
            raise
        return await _synthesize_with_headers(cleaned_text, task_id, voice, headers, "extra_headers")


def _normalise_text(text: str) -> str:
    cleaned = " ".join(text.strip().split())
    if not cleaned:
        raise ValueError("语音文本不能为空")
    return cleaned


async def _synthesize_with_headers(
    text: str,
    task_id: str,
    voice: str,
    headers: dict[str, str],
    headers_arg: str,
) -> bytes:
    connect_kwargs: dict[str, Any] = {
        headers_arg: headers,
        "max_size": None,
        "open_timeout": settings.tts_timeout_seconds,
    }
    audio_parts: list[bytes] = []

    async with websockets.connect(settings.tts_websocket_url, **connect_kwargs) as websocket:
        await websocket.send(
            json.dumps(
                build_run_task_message(
                    task_id=task_id,
                    model=settings.tts_model,
                    voice=voice,
                    audio_format=settings.tts_format,
                    sample_rate=settings.tts_sample_rate,
                    rate=settings.tts_rate,
                    pitch=settings.tts_pitch,
                ),
                ensure_ascii=False,
            )
        )
        await _wait_for_event(websocket, "task-started")

        await websocket.send(
            json.dumps(build_continue_task_message(task_id, text), ensure_ascii=False)
        )
        await websocket.send(json.dumps(build_finish_task_message(task_id), ensure_ascii=False))

        while True:
            message = await asyncio.wait_for(websocket.recv(), timeout=settings.tts_timeout_seconds)
            if isinstance(message, bytes):
                audio_parts.append(message)
                continue

            event, error = _event_from_message(message)
            if event == "task-finished":
                break
            if event == "task-failed":
                raise TTSSynthesisError(error)

    if not audio_parts:
        raise TTSSynthesisError("语音服务没有返回音频")
    return b"".join(audio_parts)


async def _wait_for_event(websocket: Any, expected_event: str) -> None:
    while True:
        message = await asyncio.wait_for(websocket.recv(), timeout=settings.tts_timeout_seconds)
        if isinstance(message, bytes):
            logger.debug("Ignoring unexpected binary frame before %s", expected_event)
            continue

        event, error = _event_from_message(message)
        if event == expected_event:
            return
        if event == "task-failed":
            raise TTSSynthesisError(error)


def _event_from_message(message: str) -> tuple[str, str]:
    try:
        data = json.loads(message)
    except json.JSONDecodeError as exc:
        raise TTSSynthesisError("语音服务返回了无法解析的消息") from exc

    header = data.get("header") or {}
    payload = data.get("payload") or {}
    output = payload.get("output") or {}
    event = str(header.get("event") or "")
    error = (
        header.get("error_message")
        or output.get("message")
        or payload.get("message")
        or header.get("message")
        or "语音合成失败"
    )
    return event, str(error)
