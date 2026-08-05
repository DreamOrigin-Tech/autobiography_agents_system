import logging
from typing import Any

from app.services.llm import llm_complete_json

logger = logging.getLogger(__name__)


BOOK_DESIGNER_SYSTEM = """你是自传成书排版设计师。

你要根据书名、章节和写作偏好，设计一套适合家庭阅读和纸质导出的中文自传 PDF 排版方案。

原则：
1. 版式要克制、清晰、适合长文阅读。
2. 不要生成正文内容，不要改写章节。
3. 只决定成书结构、章节开篇、字号、留白、页眉页脚和简短设计说明。
4. 输出必须是 JSON。

输出 JSON：
{
  "subtitle": "可选副标题，20字以内",
  "tone": "warm|classic|plain",
  "trim_size": "A4|A5",
  "body_font_size": 10.5,
  "line_spacing": 1.55,
  "include_toc": true,
  "include_preface": true,
  "preface_title": "编者的话",
  "preface": "80-180字的成书说明，不虚构事实",
  "chapter_opening": "numbered|title_only",
  "running_header": "project_title|chapter_title",
  "design_note": "60字以内说明这套排版为什么适合这本书"
}
"""


async def design_book_layout(
    project_title: str,
    chapters: list[dict[str, str | int]],
    style_notes: str | None = None,
    preference_notes: str | None = None,
) -> dict[str, Any]:
    fallback = fallback_book_layout(project_title, chapters)
    chapter_list = "\n".join(
        f"- 第{chapter.get('order')}章：{chapter.get('title')}"
        for chapter in chapters
    )
    try:
        result = await llm_complete_json(
            [
                {"role": "system", "content": BOOK_DESIGNER_SYSTEM},
                {
                    "role": "user",
                    "content": f"""书名：{project_title}

章节：
{chapter_list or '（暂无）'}

写作风格：
{style_notes or '（暂无）'}

采访与隐私偏好：
{preference_notes or '（暂无）'}

请给出一套成书 PDF 排版方案。""",
                },
            ],
            temperature=0.35,
        )
    except Exception as exc:
        logger.warning("Book layout design failed, using fallback: %s", exc)
        return fallback

    return normalize_book_layout(result, fallback)


def fallback_book_layout(project_title: str, chapters: list[dict[str, str | int]]) -> dict[str, Any]:
    return {
        "subtitle": "一段慢慢写下来的生命故事" if chapters else "",
        "tone": "classic",
        "trim_size": "A5",
        "body_font_size": 10.5,
        "line_spacing": 1.55,
        "include_toc": True,
        "include_preface": True,
        "preface_title": "编者的话",
        "preface": (
            f"这本《{project_title}》由采访与写作过程中的章节整理成书。"
            "排版保留充足留白，让每一段回忆都能被安静阅读。"
        ),
        "chapter_opening": "numbered",
        "running_header": "chapter_title",
        "design_note": "采用接近纸书的窄版心和清晰章节开篇，适合长时间阅读。",
    }


def normalize_book_layout(result: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    tone = result.get("tone") if result.get("tone") in {"warm", "classic", "plain"} else fallback["tone"]
    trim_size = result.get("trim_size") if result.get("trim_size") in {"A4", "A5"} else fallback["trim_size"]
    chapter_opening = (
        result.get("chapter_opening")
        if result.get("chapter_opening") in {"numbered", "title_only"}
        else fallback["chapter_opening"]
    )
    running_header = (
        result.get("running_header")
        if result.get("running_header") in {"project_title", "chapter_title"}
        else fallback["running_header"]
    )
    return {
        "subtitle": _clean_text(result.get("subtitle"), fallback["subtitle"], 30),
        "tone": tone,
        "trim_size": trim_size,
        "body_font_size": _clean_float(result.get("body_font_size"), fallback["body_font_size"], 9.5, 12.5),
        "line_spacing": _clean_float(result.get("line_spacing"), fallback["line_spacing"], 1.35, 1.8),
        "include_toc": bool(result.get("include_toc", fallback["include_toc"])),
        "include_preface": bool(result.get("include_preface", fallback["include_preface"])),
        "preface_title": _clean_text(result.get("preface_title"), fallback["preface_title"], 20),
        "preface": _clean_text(result.get("preface"), fallback["preface"], 240),
        "chapter_opening": chapter_opening,
        "running_header": running_header,
        "design_note": _clean_text(result.get("design_note"), fallback["design_note"], 90),
    }


def _clean_text(value: Any, fallback: str, max_len: int) -> str:
    text = " ".join(str(value or "").split())
    if not text or len(text) > max_len:
        return fallback
    return text


def _clean_float(value: Any, fallback: float, minimum: float, maximum: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, min(maximum, number))
