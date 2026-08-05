import asyncio
import json
import logging
from typing import Any

from litellm import acompletion

from app.config import settings

logger = logging.getLogger(__name__)

LLM_MAX_RETRIES = 3
LLM_RETRY_BASE_DELAY = 1.5  # seconds


def _build_kwargs(
    *,
    stream: bool,
    temperature: float,
    response_format: dict[str, Any] | None,
    extra_kwargs: dict[str, Any] | None = None,
) -> dict[str, Any]:
    model = settings.resolved_model
    kwargs: dict[str, Any] = {
        "model": model,
        "stream": stream,
        "temperature": temperature,
    }

    if settings.is_deepseek:
        api_key = settings.effective_deepseek_api_key
        if not api_key:
            raise ValueError("未配置 DEEPSEEK_API_KEY，请在 backend/.env 中设置")
        kwargs["api_key"] = api_key
        kwargs["api_base"] = "https://api.deepseek.com"
    elif settings.effective_openai_api_key:
        kwargs["api_key"] = settings.effective_openai_api_key

    if response_format:
        kwargs["response_format"] = response_format
    if extra_kwargs:
        kwargs.update(extra_kwargs)

    return kwargs


async def llm_complete(
    messages: list[dict[str, str]],
    *,
    stream: bool = False,
    temperature: float = 0.7,
    response_format: dict[str, Any] | None = None,
    **extra_kwargs: Any,
) -> Any:
    kwargs = _build_kwargs(
        stream=stream,
        temperature=temperature,
        response_format=response_format,
        extra_kwargs=extra_kwargs,
    )
    kwargs["messages"] = messages

    last_exc = None
    for attempt in range(LLM_MAX_RETRIES):
        try:
            return await acompletion(**kwargs)
        except Exception as exc:
            last_exc = exc
            if attempt < LLM_MAX_RETRIES - 1:
                delay = LLM_RETRY_BASE_DELAY * (2 ** attempt)
                logger.warning(
                    "LLM attempt %d/%d failed (model=%s), retrying in %.1fs: %s",
                    attempt + 1, LLM_MAX_RETRIES, kwargs.get("model"), delay, exc,
                )
                await asyncio.sleep(delay)
            else:
                logger.exception(
                    "LLM call failed after %d attempts: model=%s",
                    LLM_MAX_RETRIES, kwargs.get("model"),
                )

    raise last_exc  # type: ignore[misc]


async def llm_complete_text(messages: list[dict[str, str]], **kwargs: Any) -> str:
    response = await llm_complete(messages, stream=False, **kwargs)
    return response.choices[0].message.content or ""


async def llm_complete_json(messages: list[dict[str, str]], **kwargs: Any) -> dict[str, Any]:
    response = await llm_complete(
        messages,
        stream=False,
        response_format={"type": "json_object"},
        **kwargs,
    )
    content = response.choices[0].message.content or "{}"
    return json.loads(content)


async def llm_stream_text(messages: list[dict[str, str]], **kwargs: Any):
    response = await llm_complete(messages, stream=True, **kwargs)
    async for chunk in response:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
