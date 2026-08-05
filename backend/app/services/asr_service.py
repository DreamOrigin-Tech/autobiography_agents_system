import base64
import binascii
import logging
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class ASRConfigurationError(ValueError):
    pass


class ASRTranscriptionError(RuntimeError):
    pass


def decode_audio_base64(value: str) -> bytes:
    try:
        audio = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("音频数据格式不正确") from exc
    if not audio:
        raise ValueError("音频数据不能为空")
    return audio


def build_audio_data_url(audio_bytes: bytes, mime_type: str) -> str:
    clean_mime_type = mime_type.split(";", 1)[0].strip() or "audio/webm"
    encoded = base64.b64encode(audio_bytes).decode("ascii")
    return f"data:{clean_mime_type};base64,{encoded}"


def build_asr_request(
    *,
    model: str,
    audio_data_url: str,
    language: str,
    enable_itn: bool,
) -> dict[str, Any]:
    return {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": audio_data_url,
                        },
                    }
                ],
            }
        ],
        "stream": False,
        "asr_options": {
            "language": language,
            "enable_itn": enable_itn,
        },
    }


async def transcribe_audio_bytes(audio_bytes: bytes, mime_type: str) -> str:
    api_key = settings.effective_dashscope_api_key
    if not api_key:
        raise ASRConfigurationError("未配置 DASHSCOPE_API_KEY，请在 backend/.env 中设置")
    if len(audio_bytes) > settings.asr_max_audio_bytes:
        raise ValueError("音频太长，请缩短后再试")

    audio_data_url = build_audio_data_url(audio_bytes, mime_type)
    payload = build_asr_request(
        model=settings.asr_model,
        audio_data_url=audio_data_url,
        language=settings.asr_language,
        enable_itn=settings.asr_enable_itn,
    )
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=settings.asr_timeout_seconds) as client:
            response = await client.post(settings.asr_compatible_url, headers=headers, json=payload)
    except httpx.HTTPError as exc:
        raise ASRTranscriptionError("语音识别请求失败") from exc

    if response.status_code >= 400:
        logger.warning("ASR request failed: status=%s body=%s", response.status_code, response.text)
        raise ASRTranscriptionError("语音识别服务返回错误")

    try:
        data = response.json()
    except ValueError as exc:
        raise ASRTranscriptionError("语音识别服务返回了无法解析的消息") from exc

    return parse_asr_response(data)


def parse_asr_response(data: dict[str, Any]) -> str:
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(message, dict):
            text = _text_from_content(message.get("content"))
            if text:
                return text

    output = data.get("output")
    if isinstance(output, dict):
        text = _text_from_content(output.get("text") or output.get("content"))
        if text:
            return text

    raise ASRTranscriptionError("语音识别服务没有返回文本")


def _text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                value = item.get("text") or item.get("content")
                if isinstance(value, str):
                    parts.append(value)
        return "".join(parts).strip()
    return ""
