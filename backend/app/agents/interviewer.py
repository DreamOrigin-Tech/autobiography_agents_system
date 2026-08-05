import json
import logging
import re

from app.agents.memory import memory
from app.services.llm import llm_complete_json

logger = logging.getLogger(__name__)


INTERVIEWER_SYSTEM = """你是一位善于倾听的自传采访记者。你不是在填写问卷，而是在陪一位普通人慢慢回忆人生。

对话方式：
1. 如果作者刚回答过，先用一小句接住其中一个具体细节，再自然地问下去。不要只说“很好”“很重要”“谢谢分享”。
2. 每次只问一件事。整条回复通常 1-3 句，只保留一个问号，避免把时间、地点、人物、感受连成问题清单。
3. 优先沿着作者刚提到的人、物件、动作或一句话追问，不要为了补齐后台指标突然跳题。
4. 语言口语化、温和、简短。少用“能否补充”“请详细描述”“关于……能跟我多讲讲吗”等采访模板。
5. 作者说记不清时，允许模糊记忆，用轻松的联想线索帮助回想；作者不想说时，明确接受并换一个角度，不施压。
6. 不重复已经问过的问题。每 2-3 轮可以自然过渡到另一个话题，但要有一句衔接。
7. 第一次见面时，先用 1-2 句自然寒暄，让作者知道可以慢慢说、记不清也没关系，再从一个画面、一个人或一件小事轻轻切入。后续章节承接前文，不要重复正式问候。
8. 后台的“完成度、缺失维度、覆盖度”等只用于你选择方向，绝不能在回复里提到这些词。
9. 当素材已经足够撰写时，可以自然收束，例如“这段故事已经很清楚了，我们可以先把它写下来”。对标出版级传记章节时，通常至少需要 12 轮有内容的回答、约 5000 字素材，并覆盖 5-10 个具体场景；不要太早建议写作。
10. 不要把你自己知道的公开资料、新人物、新年份、新数字、新事件塞进问题里。只能追问作者刚刚提到的线索，或用“这段如果要写清楚，还缺哪一个具体场景？”这类方式请作者补充。

输出 JSON：
{
  "question": "完整的对话回复：可以先回应一句，再问一个问题",
  "intent": "追问细节|探索情感|确认事实|过渡话题",
  "suggested_action": "continue|write_chapter",
  "reason": "简要说明"
}
"""


async def generate_question(
    chapter_title: str,
    interview_topics: list[str],
    messages: list[dict[str, str]],
    chapter_summaries: list[str],
    preference_context: str | None = None,
    coverage_context: str | None = None,
) -> dict:
    if not messages:
        return {
            "question": _opening_question(chapter_title, chapter_summaries),
            "intent": "建立关系",
            "suggested_action": "continue",
            "reason": "用轻松开场降低回答压力，再从具体画面进入回忆",
        }

    role_labels = {"agent": "记者", "user": "作者"}
    history_text = "\n".join(
        f"{role_labels.get(m['role'], m['role'])}：{m['content']}"
        for m in messages[-20:]
    )
    topics_text = "\n".join(f"- {t}" for t in interview_topics)
    context_text = "\n".join(f"- {s}" for s in chapter_summaries if s)

    user_content = f"""本章：{chapter_title}

可聊的线索（不必按顺序逐项询问）：
{topics_text}

已完成章节摘要：
{context_text or '（暂无）'}

用户偏好与长期记忆：
{preference_context or '（暂无）'}

后台写作准备提示（只用于判断方向，不要复述其中的指标或术语）：
{coverage_context or '（暂无）'}

对话历史：
{history_text or '（刚开始采访）'}

请像真实记者一样接着聊下去。"""

    fallback_question = _natural_fallback_question(
        chapter_title,
        interview_topics,
        messages,
        coverage_context,
    )
    try:
        result = await llm_complete_json(
            [
                {"role": "system", "content": INTERVIEWER_SYSTEM},
                {"role": "user", "content": user_content},
            ],
            temperature=0.78,
        )
        result["question"] = _normalize_interview_turn(
            str(result.get("question", "")),
            fallback_question,
        )
        return result
    except Exception as exc:
        logger.warning("LLM interview question failed, using fallback: %s", exc)
        user_answers = [
            m.get("content", "").strip()
            for m in messages
            if m.get("role") == "user" and m.get("content", "").strip()
        ]
        has_publish_level_material = (
            len(user_answers) >= 12
            and sum(len(answer) for answer in user_answers) >= 5000
        )
        return {
            "question": fallback_question,
            "intent": "追问细节",
            "suggested_action": "write_chapter" if has_publish_level_material else "continue",
            "reason": "fallback question",
        }


def _find_unanswered_topic(topics: list[str], messages: list[dict[str, str]]) -> str:
    user_text = " ".join(m["content"] for m in messages if m["role"] == "user")
    for topic in topics:
        if topic not in user_text:
            return topic
    return topics[0] if topics else "这一章中您最想分享的故事"


def _natural_fallback_question(
    chapter_title: str,
    topics: list[str],
    messages: list[dict[str, str]],
    coverage_context: str | None = None,
) -> str:
    last_answer = next(
        (m["content"] for m in reversed(messages) if m.get("role") == "user"),
        "",
    )
    if last_answer:
        return memory.detail_followup_question(last_answer, chapter_title, topics)

    topic = _find_unanswered_topic(topics, messages)
    if topic and topic != "这一章中您最想分享的故事":
        return f"我们先从「{topic}」慢慢聊起。现在回想起来，您脑海里最先浮现的是哪一幕？"
    return f"说到「{chapter_title}」，您脑海里最先浮现的是哪个人，或哪一幕？"


def _opening_question(chapter_title: str, chapter_summaries: list[str]) -> str:
    spoken_title = re.split(r"[：:—–]", chapter_title, maxsplit=1)[0].strip() or chapter_title
    if chapter_summaries:
        return (
            "我们接着慢慢往下聊，不用急着一次把事情讲完整。"
            f"说到{spoken_title}，您最先想起的是哪个人，或者哪一个小画面？"
        )
    return (
        "您好，咱们今天就像聊家常一样，慢慢来。"
        "想起多少说多少，记不清也没关系。"
        f"说到{spoken_title}，您最先想到的是谁，或者哪个小画面？"
    )


def _normalize_interview_turn(text: str, fallback: str) -> str:
    normalized = re.sub(r"^(?:问题|采访问题|记者回复)[：:\s]+", "", text.strip())
    normalized = re.sub(r"\s+", " ", normalized)
    forbidden_jargon = ("缺失维度", "完成度", "覆盖度", "下一轮优先补充", "我听说", "公开资料")
    question_marks = normalized.count("？") + normalized.count("?")

    if (
        not normalized
        or len(normalized) > 180
        or question_marks > 1
        or any(term in normalized for term in forbidden_jargon)
    ):
        return fallback

    if question_marks == 0:
        normalized = normalized.rstrip("。！；;，,") + "？"
    return normalized


def parse_topics(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [str(x) for x in data]
    except json.JSONDecodeError:
        pass
    return [line.strip() for line in raw.split("\n") if line.strip()]
