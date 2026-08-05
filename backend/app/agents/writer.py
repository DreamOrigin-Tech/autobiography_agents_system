from app.services.llm import llm_complete_text, llm_stream_text


WRITER_SYSTEM = """你是一位优秀的自传作家。根据采访素材，以第一人称撰写自传章节。

传记体量参考：
- Walter Isaacson 的《Steve Jobs》约 630 页、42 章，平均每章是十几页的传记章节，而不是一篇短散文
- 中文版《史蒂夫·乔布斯传》约 43 万字，42 章平均约 1 万字；普通章节目标 8000-12000 个中文字符
- 关键转折章节（离开、创业失败、回归、疾病、重大产品发布等）目标 12000-18000 个中文字符；素材极丰富时可写到 25000 字左右
- 如果素材不足以支撑长章，不要硬编；应在文末用“【待补采访】”列出还缺哪些采访素材

要求：
- 语言真实、有温度，符合口述历史风格
- 结构清晰，有叙事弧线（开端-发展-高潮-感悟）
- 保留作者原话中的细节和情感
- 使用 Markdown 格式，段落之间空一行
- 正文长度要匹配出版传记章节体量：围绕 5-10 个关键场景展开，每个场景有时间/地点/人物/动作/影响，而不是只写概括
- 不要用空泛抒情凑字；扩写只能来自采访记录、用户偏好、前后章节摘要中的事实依据
- 不要添加采访者提问，只写正文
- 严格只使用采访记录、用户偏好、前后章节摘要中能支持的信息
- 禁止为了增强传记感而调用你自己的常识补充精确事实；公开人物、年份、地点、机构、金额、技术参数、杂志/会议/展会名称，必须在事实依据清单、采访记录、用户偏好或章节摘要中出现过
- 不要虚构新的姓名、地点、年份、事故、职业转折、家庭关系或心理独白
- 如果某个细节没有采访依据，宁可概括或留白，也不要编造
"""


async def write_chapter(
    chapter_title: str,
    chapter_order: int,
    style_notes: str | None,
    messages: list[dict[str, str]],
    prev_summary: str | None,
    next_summary: str | None,
    preference_context: str | None = None,
) -> str:
    interview_text = "\n".join(f"{m['role']}: {m['content']}" for m in messages)
    material_bullets = _user_material_bullets(messages)
    user_content = f"""当前章节：第{chapter_order}章
章节标题：{chapter_title}
风格偏好：{style_notes or '真实、温情、第一人称'}
用户偏好与长期记忆：
{preference_context or '（暂无）'}

上一章摘要：{prev_summary or '（第一章）'}
下一章摘要：{next_summary or '（待定）'}

事实依据清单（优先使用这些用户亲口提供的素材）：
{material_bullets or '（暂无用户回答，不应生成正文）'}

采访记录：
{interview_text}

请撰写这一章的自传正文。每一段都必须能在事实依据清单或采访记录中找到依据。
如果正文使用 Markdown 一级标题，必须写成“# 第{chapter_order}章 {chapter_title}”，不得自行推断或改写章节编号。
不要加入事实依据中没有出现过的新人物、新机构、新地点、新年份、新数字或新技术细节。
如果素材足够，普通章节目标长度为 8000-12000 个中文字符，关键转折章节可写到 12000-18000 个中文字符；如果达不到，请不要虚构，而是在正文后列出“【待补采访】”。"""

    return await llm_complete_text(
        [
            {"role": "system", "content": WRITER_SYSTEM},
            {"role": "user", "content": user_content},
        ],
        temperature=0.8,
        max_tokens=16000,
    )


async def stream_write_chapter(
    chapter_title: str,
    chapter_order: int,
    style_notes: str | None,
    messages: list[dict[str, str]],
    prev_summary: str | None,
    next_summary: str | None,
    preference_context: str | None = None,
):
    interview_text = "\n".join(f"{m['role']}: {m['content']}" for m in messages)
    material_bullets = _user_material_bullets(messages)
    user_content = f"""当前章节：第{chapter_order}章
章节标题：{chapter_title}
风格偏好：{style_notes or '真实、温情、第一人称'}
用户偏好与长期记忆：
{preference_context or '（暂无）'}

上一章摘要：{prev_summary or '（第一章）'}
下一章摘要：{next_summary or '（待定）'}

事实依据清单（优先使用这些用户亲口提供的素材）：
{material_bullets or '（暂无用户回答，不应生成正文）'}

采访记录：
{interview_text}

请撰写这一章的自传正文。每一段都必须能在事实依据清单或采访记录中找到依据。
如果正文使用 Markdown 一级标题，必须写成“# 第{chapter_order}章 {chapter_title}”，不得自行推断或改写章节编号。
不要加入事实依据中没有出现过的新人物、新机构、新地点、新年份、新数字或新技术细节。
如果素材足够，普通章节目标长度为 8000-12000 个中文字符，关键转折章节可写到 12000-18000 个中文字符；如果达不到，请不要虚构，而是在正文后列出“【待补采访】”。"""

    async for token in llm_stream_text(
        [
            {"role": "system", "content": WRITER_SYSTEM},
            {"role": "user", "content": user_content},
        ],
        temperature=0.8,
        max_tokens=16000,
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
        if len(content) > 1600:
            content = content[:1600].rstrip() + "..."
        bullets.append(f"- {content}")
    return "\n".join(bullets)
