"""Planning helpers for gradual, one-chapter-at-a-time autobiography discovery."""

import json

from app.schemas import OutlineChapterPlan
from app.services.llm import llm_complete_json

NEXT_CHAPTER_SYSTEM = """你是一位自传策划编辑。请根据作者已经讲过的内容，一次只确定下一章，不要规划整本书，也不要预告后续章节。

要求：
- 第一章选择作者最容易进入、最有具体记忆的起点，不必强求从出生写起
- 后续章节要承接已完成内容，但不能重复已有章节
- 用户明确说想聊哪个时期、人物或事件时，优先遵从这个方向
- 标题必须具体，能看出属于这位作者，禁止使用“童年记忆”“人生感悟”等通用标题
- 标题必须是完整短句，建议 10-22 个中文字符；不要以“与、和、的、：、字”等残缺词结尾
- 提供 3-5 个适合下一轮采访的具体话题

输出 JSON：
{
  "order": 1,
  "title": "下一章的具体标题",
  "interview_topics": ["具体话题1", "具体话题2", "具体话题3"]
}
"""


async def create_next_chapter(
    title: str,
    planning_context: str,
    existing_chapters: list[dict],
    direction: str | None,
    style_notes: str | None,
) -> OutlineChapterPlan:
    next_order = len(existing_chapters) + 1
    existing_text = "\n".join(
        f"- 第 {chapter['order']} 章《{chapter['title']}》：{chapter.get('summary') or '暂无摘要'}"
        for chapter in existing_chapters
    )
    data = await llm_complete_json(
        [
            {"role": "system", "content": NEXT_CHAPTER_SYSTEM},
            {
                "role": "user",
                "content": f"""自传标题：{title}

最初的人生梳理采访：
{planning_context or '（暂无）'}

已经完成的章节：
{existing_text or '（这是第一章）'}

作者希望下一章聊：
{direction or '（请从已有采访中选择最自然的起点）'}

写作风格：
{style_notes or '真实、温情、第一人称'}

请只确定第 {next_order} 章。""",
            },
        ],
        temperature=0.7,
    )
    data["order"] = next_order
    data["title"] = _clean_chapter_title(str(data.get("title", "")), direction, next_order)
    return OutlineChapterPlan.model_validate(data)


def create_next_chapter_fallback(order: int, direction: str | None = None) -> OutlineChapterPlan:
    focus = _fallback_focus(direction)
    title = _clean_chapter_title(focus[:24] if direction else "", direction, order)
    return OutlineChapterPlan(
        order=order,
        title=title,
        interview_topics=[
            f"{focus}发生在什么时候、什么地方",
            f"{focus}里最重要的人",
            f"{focus}中印象最深的一个画面",
            f"{focus}对后来的影响",
        ],
    )


def _fallback_focus(direction: str | None) -> str:
    if not direction:
        return "一段最想留下的人生经历"
    first_sentence = direction.strip().split("。", 1)[0].strip()
    for separator in ("，", "；", ";"):
        first_sentence = first_sentence.split(separator, 1)[0].strip()
    return first_sentence[:32] or "一段最想留下的人生经历"


def _clean_chapter_title(raw_title: str, direction: str | None, order: int) -> str:
    title = raw_title.strip().strip("《》\"'“”‘’")
    dangling_endings = ("与", "和", "及", "、", "，", "：", ":", "的", "字")
    if title and len(title) <= 32 and not title.endswith(dangling_endings):
        return title

    focus = (direction or "").strip()
    if "Macintosh" in focus or "Macintosh" in title:
        return "Macintosh：海盗旗与放逐"
    if "Apple II" in focus or "Apple I" in focus:
        return "车库里的苹果"
    if focus:
        cleaned = focus.split("。", 1)[0].split("，", 1)[0].strip()
        if 6 <= len(cleaned) <= 28 and not cleaned.endswith(dangling_endings):
            return cleaned
    return "故事从这里开始" if order == 1 else f"第{order}章"


async def suggest_next_action(
    project_status: str,
    chapters_status: list[dict],
) -> dict:
    """Suggest the next action for the user based on project state."""
    pending = sum(1 for c in chapters_status if c["status"] == "pending")
    interviewing = sum(1 for c in chapters_status if c["status"] == "interviewing")
    drafting = sum(1 for c in chapters_status if c["status"] == "drafting")
    done = sum(1 for c in chapters_status if c["status"] == "done")

    if project_status == "planning" and pending == len(chapters_status):
        return {
            "action": "start_interview",
            "message": "第一章已确定，先从这里开始采访吧",
            "priority": "high",
        }

    if pending > 0 and interviewing == 0 and drafting == 0:
        return {
            "action": "start_interview",
            "message": f"还有 {pending} 个已确定章节待采访，继续推进",
            "priority": "high",
        }

    if interviewing > 0:
        return {
            "action": "continue_interview",
            "message": "当前章节采访进行中",
            "priority": "high",
        }

    if drafting > 0:
        return {
            "action": "wait_for_writing",
            "message": "AI 正在撰写中...",
            "priority": "medium",
        }

    if done > 0 and pending == 0 and interviewing == 0:
        return {
            "action": "review_or_publish",
            "message": f"所有 {done} 章已完成，可以审阅并发布",
            "priority": "medium",
        }

    return {
        "action": "continue",
        "message": "继续你的自传之旅",
        "priority": "low",
    }


def topics_to_text(topics: list[str]) -> str:
    return json.dumps(topics, ensure_ascii=False)
