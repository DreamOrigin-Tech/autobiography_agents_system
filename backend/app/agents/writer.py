from app.services.llm import llm_complete_text, llm_stream_text


WRITER_SYSTEM = """你是一位优秀的自传作家。根据采访素材，以第一人称撰写自传章节。

要求：
- 语言真实、有温度，符合口述历史风格
- 结构清晰，有叙事弧线（开端-发展-高潮-感悟）
- 保留作者原话中的细节和情感
- 使用 Markdown 格式，段落之间空一行
- 正文长度要匹配素材密度：素材少就写短，不要为了凑字扩写；素材充分时可写 800-1500 字
- 不要添加采访者提问，只写正文
- 严格只使用采访记录、用户偏好、前后章节摘要中能支持的信息
- 不要虚构新的姓名、地点、年份、事故、职业转折、家庭关系或心理独白
- 如果某个细节没有采访依据，宁可概括或留白，也不要编造
"""


async def write_chapter(
    chapter_title: str,
    style_notes: str | None,
    messages: list[dict[str, str]],
    prev_summary: str | None,
    next_summary: str | None,
    preference_context: str | None = None,
) -> str:
    interview_text = "\n".join(f"{m['role']}: {m['content']}" for m in messages)
    material_bullets = _user_material_bullets(messages)
    user_content = f"""章节标题：{chapter_title}
风格偏好：{style_notes or '真实、温情、第一人称'}
用户偏好与长期记忆：
{preference_context or '（暂无）'}

上一章摘要：{prev_summary or '（第一章）'}
下一章摘要：{next_summary or '（待定）'}

事实依据清单（优先使用这些用户亲口提供的素材）：
{material_bullets or '（暂无用户回答，不应生成正文）'}

采访记录：
{interview_text}

请撰写这一章的自传正文。每一段都必须能在事实依据清单或采访记录中找到依据。"""

    return await llm_complete_text(
        [
            {"role": "system", "content": WRITER_SYSTEM},
            {"role": "user", "content": user_content},
        ],
        temperature=0.8,
    )


async def stream_write_chapter(
    chapter_title: str,
    style_notes: str | None,
    messages: list[dict[str, str]],
    prev_summary: str | None,
    next_summary: str | None,
    preference_context: str | None = None,
):
    interview_text = "\n".join(f"{m['role']}: {m['content']}" for m in messages)
    material_bullets = _user_material_bullets(messages)
    user_content = f"""章节标题：{chapter_title}
风格偏好：{style_notes or '真实、温情、第一人称'}
用户偏好与长期记忆：
{preference_context or '（暂无）'}

上一章摘要：{prev_summary or '（第一章）'}
下一章摘要：{next_summary or '（待定）'}

事实依据清单（优先使用这些用户亲口提供的素材）：
{material_bullets or '（暂无用户回答，不应生成正文）'}

采访记录：
{interview_text}

请撰写这一章的自传正文。每一段都必须能在事实依据清单或采访记录中找到依据。"""

    async for token in llm_stream_text(
        [
            {"role": "system", "content": WRITER_SYSTEM},
            {"role": "user", "content": user_content},
        ],
        temperature=0.8,
    ):
        yield token


SUMMARY_SYSTEM = "请用 2-3 句话概括以下自传章节的核心内容，用于后续章节的上下文衔接。只输出摘要，不要其他内容。"


async def summarize_chapter(content: str) -> str:
    return await llm_complete_text(
        [
            {"role": "system", "content": SUMMARY_SYSTEM},
            {"role": "user", "content": content[:4000]},
        ],
        temperature=0.3,
    )


def _user_material_bullets(messages: list[dict[str, str]]) -> str:
    bullets: list[str] = []
    for message in messages:
        if message.get("role") != "user":
            continue
        content = message.get("content", "").strip()
        if not content:
            continue
        if len(content) > 220:
            content = content[:220].rstrip() + "..."
        bullets.append(f"- {content}")
    return "\n".join(bullets)
