import json
import re

from app.services.llm import llm_complete_json, llm_complete_text


REFINER_SYSTEM = """你是一位严谨的中文传记作家和资深编辑。

任务：把自传采访素材精修/扩写成出版级章节草稿。

硬性要求：
- 只使用用户采访素材、项目偏好、章节标题和前后文摘要中提供的信息。
- 不要添加没有素材支撑的人名、年份、地点、机构、金额、医学细节、家庭私密对话或会议细节。
- 如果素材不足，宁可保留克制或写“【待补采访】”，不要硬编。
- 输出给读者看的正文，不要暴露“事实锚点、素材显示、后台指标、覆盖度”等系统术语。
- 文风要有叙事密度：场景、人物关系、冲突、选择、后果、反思都要出现。
"""


async def plan_publish_level_sections(
    chapter_title: str,
    interview_topics: list[str],
    material: str,
) -> list[str]:
    topics_text = "\n".join(f"- {topic}" for topic in interview_topics)
    prompt = f"""章节标题：{chapter_title}

计划采访线索：
{topics_text or "（暂无）"}

采访素材摘录：
{material[:10000]}

请为这一章规划 6-8 个适合出版级传记章节的小节标题。
要求：
1. 标题必须来自采访素材里的真实线索，不要发明新事件。
2. 标题要像章节内的小节，而不是问题。
3. 只输出 JSON：{{"sections": ["小节标题"]}}"""
    try:
        data = await llm_complete_json(
            [
                {"role": "system", "content": REFINER_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0.35,
        )
        sections = data.get("sections", [])
        if isinstance(sections, list):
            cleaned = [_clean_heading(str(item)) for item in sections]
            cleaned = [item for item in cleaned if item]
            if len(cleaned) >= 4:
                return cleaned[:8]
    except Exception:
        pass
    return _fallback_sections(chapter_title, interview_topics)


async def write_publish_level_section(
    chapter_order: int,
    chapter_title: str,
    section_title: str,
    material: str,
    previous_context: str,
    style_context: str | None = None,
) -> str:
    prompt = f"""当前章节：第{chapter_order}章《{chapter_title}》
当前小节：{section_title}

项目风格与偏好：
{style_context or "真实、克制、第一人称自传。"}

采访素材：
{material[:14000]}

已写前文尾部，避免重复：
{previous_context[-1800:] if previous_context else "（本章开头）"}

请写当前小节正文，约 1300-1700 个中文字符。
要求：
1. 以 Markdown 二级标题“## {section_title}”开头。
2. 直接写正文，不要解释写法，不要列提纲。
3. 必须围绕一个或几个具体场景展开，有人物、动作、冲突、选择、后果。
4. 第一人称要自然，不要冒充真实遗稿；如果是公开人物角色扮演，要保持事实边界。
5. 不要重复前文句式，不要输出后台术语。"""
    return (
        await llm_complete_text(
            [
                {"role": "system", "content": REFINER_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0.68,
            max_tokens=3400,
        )
    ).strip()


async def write_publish_level_expansion(
    chapter_order: int,
    chapter_title: str,
    material: str,
    content_so_far: str,
    style_context: str | None = None,
) -> str:
    prompt = f"""第{chapter_order}章《{chapter_title}》仍需要补足出版级章节体量。

项目风格与偏好：
{style_context or "真实、克制、第一人称自传。"}

采访素材：
{material[:14000]}

已有正文尾部：
{content_so_far[-2200:]}

请补写一个新的自然小节，约 1200-1700 个中文字符。
不要重复已有内容，不要添加素材中没有的具体事实。"""
    return (
        await llm_complete_text(
            [
                {"role": "system", "content": REFINER_SYSTEM},
                {"role": "user", "content": prompt},
            ],
            temperature=0.62,
            max_tokens=3200,
        )
    ).strip()


def clean_section_text(text: str, fallback_heading: str) -> str:
    text = text.strip()
    text = re.sub(r"^\s*#+\s*本节[:：]?\s*", f"## {fallback_heading}\n\n", text)
    if not text.startswith("## "):
        text = f"## {fallback_heading}\n\n{text}"
    forbidden_terms = ("事实锚点", "素材显示", "后台指标", "覆盖度", "本节将")
    for term in forbidden_terms:
        text = text.replace(term, "")
    return text.strip()


def _fallback_sections(chapter_title: str, interview_topics: list[str]) -> list[str]:
    sections: list[str] = []
    for topic in interview_topics:
        heading = _clean_heading(topic)
        if heading:
            sections.append(heading)
    if not sections:
        sections = [_clean_heading(chapter_title) or "这一章的核心场景"]
    while len(sections) < 6:
        sections.append(f"场景与余波 {len(sections) + 1}")
    return sections[:8]


def _clean_heading(text: str) -> str:
    text = re.sub(r"^[#\-\s]+", "", text.strip())
    text = re.split(r"[？?。；;]", text, maxsplit=1)[0].strip()
    text = re.sub(r"^(请|能否|是否|你如何|您如何)", "", text).strip("：:，, ")
    if len(text) > 28:
        text = text[:28].rstrip()
    return text
