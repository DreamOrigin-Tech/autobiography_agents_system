import json
import logging

from app.services.llm import llm_complete_json

logger = logging.getLogger(__name__)


ASSISTANT_SYSTEM = """你是采访助理，不是受访者面前的 AI 记者。

你的服务对象是真人采访员。请根据采访记录，帮助采访员判断下一步怎么问、哪些事实要补齐、哪些地方需要放慢或换角度。

原则：
1. 不替采访员长篇控场，给可以直接拿来问的一句话问题。
2. 每条建议都要尊重受访者，不催促、不审问、不诱导。
3. 优先帮助采访员追具体画面、人物关系、时间地点、行动细节、情绪变化。
4. 如果受访者已经给出足够素材，提醒可以收束并进入写作；对标出版级传记章节时，通常至少需要 12 轮有内容的回答、约 5000 字素材，并覆盖 5-10 个具体场景，才足以支撑较完整的章节。
5. 不要把后台指标、覆盖度、评分等术语暴露给采访员。

输出 JSON：
{
  "next_questions": ["建议采访员接下来问的问题，1-3 条"],
  "followup_focus": ["本轮最值得追问的细节，1-4 条"],
  "missing_facts": ["写作前最好补齐的事实，0-5 条"],
  "live_summary": "给采访员看的现场小结，80 字以内",
  "caution": "需要注意的语气或边界，60 字以内",
  "suggested_action": "continue|write_chapter",
  "reason": "简要说明"
}
"""


async def generate_assistant_brief(
    chapter_title: str,
    interview_topics: list[str],
    messages: list[dict[str, str]],
    coverage_context: str | None = None,
) -> dict:
    fallback = fallback_assistant_brief(chapter_title, interview_topics, messages)
    history_text = "\n".join(f"{_role_label(m.get('role', ''))}：{m.get('content', '')}" for m in messages[-30:])
    topics_text = "\n".join(f"- {topic}" for topic in interview_topics)

    try:
        result = await llm_complete_json(
            [
                {"role": "system", "content": ASSISTANT_SYSTEM},
                {
                    "role": "user",
                    "content": f"""本章：{chapter_title}

计划采访线索：
{topics_text or '（暂无）'}

后台素材提示（只用于判断方向，不要复述指标术语）：
{coverage_context or '（暂无）'}

采访记录：
{history_text or '（暂无）'}

请给真人采访员一份简短、可执行的采访辅助提示。""",
                },
            ],
            temperature=0.45,
        )
    except Exception as exc:
        logger.warning("Interview assistant brief failed, using fallback: %s", exc)
        return fallback

    normalized = _normalize_brief(result, fallback)
    answered, material_chars = _material_stats(messages)
    if not _has_publish_level_material(answered, material_chars):
        normalized["suggested_action"] = "continue"
        normalized["reason"] = "素材还不足以支撑出版级传记章节，建议继续采访"
    return normalized


async def classify_call_speaker(
    text: str,
    recent_messages: list[dict[str, str]],
) -> dict:
    fallback = fallback_speaker_classification(text)
    if fallback["confidence"] >= 0.78:
        return fallback

    history = "\n".join(
        f"{m.get('role', '')}：{m.get('content', '')}"
        for m in recent_messages[-12:]
    )
    try:
        result = await llm_complete_json(
            [
                {
                    "role": "system",
                    "content": (
                        "你在帮助自传采访系统判断一段语音转写是谁说的。"
                        "只能输出 JSON。role 必须是 user、interviewer 或 note。"
                        "user=受访者/自传主人公在讲自己的经历；"
                        "interviewer=采访员在提问、追问、回应或控场；"
                        "note=旁白、环境说明、无效录音、系统说明。"
                    ),
                },
                {
                    "role": "user",
                    "content": f"""近期记录：
{history or '（暂无）'}

待判断文本：
{text}

请输出：
{{"role":"user|interviewer|note","confidence":0到1,"reason":"一句话理由"}}""",
                },
            ],
            temperature=0.2,
        )
    except Exception:
        return fallback

    role = result.get("role")
    if role not in {"user", "interviewer", "note"}:
        role = fallback["role"]
    try:
        confidence = float(result.get("confidence", fallback["confidence"]))
    except (TypeError, ValueError):
        confidence = fallback["confidence"]
    return {
        "role": role,
        "confidence": max(0.0, min(1.0, confidence)),
        "reason": _clean_text(result.get("reason"), fallback["reason"], 80),
    }


def fallback_speaker_classification(text: str) -> dict:
    cleaned = " ".join(str(text or "").strip().split())
    if not cleaned:
        return {"role": "note", "confidence": 1.0, "reason": "空白录音"}

    interviewer_markers = (
        "请问", "能不能", "能否", "可以讲讲", "你刚才", "您刚才", "接着说",
        "为什么", "什么时候", "在哪里", "谁", "什么感受", "还有吗", "我们先",
        "这个地方", "这段如果", "我想追问", "你能", "您能",
    )
    first_person_markers = (
        "我记得", "我当时", "我觉得", "我后来", "我们家", "我的父亲", "我的母亲",
        "我和", "那时候我", "对我来说", "我希望", "我不想", "我最",
    )
    note_markers = ("测试", "试一下", "听得到吗", "麦克风", "录音", "系统", "旁白")

    question_like = "?" in cleaned or "？" in cleaned
    if any(marker in cleaned for marker in note_markers) and len(cleaned) < 40:
        return {"role": "note", "confidence": 0.82, "reason": "更像测试或环境说明"}
    if question_like or any(marker in cleaned for marker in interviewer_markers):
        return {"role": "interviewer", "confidence": 0.74, "reason": "包含提问或追问语气"}
    if any(marker in cleaned for marker in first_person_markers) or len(cleaned) >= 80:
        return {"role": "user", "confidence": 0.72, "reason": "包含第一人称经历叙述"}
    return {"role": "user", "confidence": 0.55, "reason": "默认按受访者素材记录"}


def fallback_assistant_brief(
    chapter_title: str,
    interview_topics: list[str],
    messages: list[dict[str, str]],
) -> dict:
    last_answer = next(
        (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
        "",
    )
    answered, material_chars = _material_stats(messages)
    topic = _first_uncovered_topic(interview_topics, messages)
    next_question = _question_from_last_answer(last_answer) if last_answer else ""
    if not next_question:
        next_question = (
            f"说到「{topic or chapter_title}」，您脑海里最先浮现的是哪一个具体画面？"
        )

    missing = ["大概时间", "地点", "关键人物", "当时的选择或行动", "后来的影响"]
    return {
        "next_questions": [next_question],
        "followup_focus": [item for item in [topic, "具体画面", "当时感受"] if item],
        "missing_facts": missing[: 3 if answered else 5],
        "live_summary": "先帮受访者进入一个具体场景，再顺着人物和动作往下问。",
        "caution": "一次只问一件事，受访者停顿时给一点回想时间。",
        "suggested_action": "write_chapter" if _has_publish_level_material(answered, material_chars) else "continue",
        "reason": "根据已有回答轮次和计划话题给出保守建议",
    }


def _normalize_brief(result: dict, fallback: dict) -> dict:
    normalized = dict(fallback)
    normalized["next_questions"] = _clean_list(result.get("next_questions"), fallback["next_questions"], 3)
    normalized["followup_focus"] = _clean_list(result.get("followup_focus"), fallback["followup_focus"], 4)
    normalized["missing_facts"] = _clean_list(result.get("missing_facts"), fallback["missing_facts"], 5)
    normalized["live_summary"] = _clean_text(result.get("live_summary"), fallback["live_summary"], 120)
    normalized["caution"] = _clean_text(result.get("caution"), fallback["caution"], 90)
    normalized["suggested_action"] = (
        "write_chapter" if result.get("suggested_action") == "write_chapter" else "continue"
    )
    normalized["reason"] = _clean_text(result.get("reason"), fallback["reason"], 120)
    return normalized


def _has_publish_level_material(answered: int, material_chars: int) -> bool:
    return answered >= 12 and material_chars >= 5000


def _material_stats(messages: list[dict[str, str]]) -> tuple[int, int]:
    user_messages = [
        m.get("content", "").strip()
        for m in messages
        if m.get("role") == "user" and m.get("content", "").strip()
    ]
    return len(user_messages), sum(len(message) for message in user_messages)


def _clean_list(value: object, fallback: list[str], limit: int) -> list[str]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            value = [value]
    if not isinstance(value, list):
        return fallback
    items = [_clean_text(item, "", 90) for item in value]
    items = [item for item in items if item and not _has_internal_jargon(item)]
    return items[:limit] or fallback


def _clean_text(value: object, fallback: str, max_len: int) -> str:
    text = str(value or "").strip()
    text = " ".join(text.split())
    if not text or len(text) > max_len or _has_internal_jargon(text):
        return fallback
    return text


def _has_internal_jargon(text: str) -> bool:
    return any(term in text for term in ("覆盖度", "缺失维度", "评分", "后台指标"))


def _first_uncovered_topic(topics: list[str], messages: list[dict[str, str]]) -> str:
    user_text = " ".join(m.get("content", "") for m in messages if m.get("role") == "user")
    for topic in topics:
        if topic and topic not in user_text:
            return topic
    return topics[0] if topics else ""


def _question_from_last_answer(answer: str) -> str:
    answer = answer.strip()
    if not answer:
        return ""
    fragment = answer[:28]
    return f"刚才您提到「{fragment}」，当时现场还有谁在，大家是什么反应？"


def _role_label(role: str) -> str:
    labels = {
        "agent": "AI记者",
        "user": "受访者",
        "interviewer": "采访员",
        "note": "现场备注",
    }
    return labels.get(role, role or "记录")
