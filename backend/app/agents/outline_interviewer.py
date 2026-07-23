import logging
import re

from app.services.llm import llm_complete_json

logger = logging.getLogger(__name__)

MIN_ANSWERS = 3
MAX_ANSWERS = 5

OUTLINE_INTERVIEW_SYSTEM = """你是一位温和、善于梳理人生脉络的自传策划编辑。
你的任务不是立刻列章节，而是先通过简短对话了解作者的人生阶段、重要转折、关键人物和最想留下的内容。

要求：
1. 每次只问一个容易回答的问题，回复不超过 3 句，只保留一个问号。
2. 先接住作者刚提到的具体内容，再自然追问，不要像填写履历表。
3. 优先补充尚不清楚的部分：人生阶段、重要转折、关键人物、最想重点写或避开的内容。
4. 至少获得 3 次回答后，信息足够时可以结束；最多询问 5 次。
5. 不要安排整本书，不要提“覆盖度、信息采集、字段”等后台术语。

输出 JSON：
{
  "reply": "对作者的简短回应和下一问；如果可以结束，则是自然的收束语",
  "ready": false,
  "reason": "为什么继续或结束"
}
"""


def opening_message() -> str:
    return (
        "在安排章节之前，我想先听您聊聊整个人生的大致轮廓。"
        "不用按年份说得很完整，回头看，您觉得自己的人生大概经历了哪些重要阶段？"
    )


async def generate_next_turn(
    project_title: str,
    messages: list[dict[str, str]],
) -> dict:
    answer_count = sum(1 for message in messages if message.get("role") == "user")
    fallback = fallback_turn(answer_count)
    history = "\n".join(
        f"{'作者' if message.get('role') == 'user' else '策划编辑'}：{message.get('content', '')}"
        for message in messages[-12:]
    )

    try:
        result = await llm_complete_json(
            [
                {"role": "system", "content": OUTLINE_INTERVIEW_SYSTEM},
                {
                    "role": "user",
                    "content": (
                        f"自传项目：{project_title}\n"
                        f"作者已回答 {answer_count} 次。\n\n"
                        f"对话记录：\n{history}\n\n"
                        "请判断是继续追问还是自然收束。"
                    ),
                },
            ],
            temperature=0.72,
        )
        requested_ready = bool(result.get("ready"))
        ready = answer_count >= MAX_ANSWERS or (
            answer_count >= MIN_ANSWERS and requested_ready
        )
        reply = _normalize_reply(str(result.get("reply", "")), fallback["reply"], ready)
        if ready and "？" in reply:
            reply = "这些线索已经足够帮您确定第一章了。我们先从最容易讲起的一段开始，后面写完一章再决定下一章。"
        return {
            "reply": reply,
            "ready": ready,
            "reason": str(result.get("reason", "")),
        }
    except Exception as exc:
        logger.warning("Outline interview failed, using fallback: %s", exc)
        return fallback


def fallback_turn(answer_count: int) -> dict:
    prompts = [
        "您提到的这些阶段里，哪一段对后来的您影响最大？可以先讲一个转折或决定。",
        "一路走来，有没有哪几个人对您特别重要，或者改变过您看事情的方式？",
        "如果家人以后读到这本自传，您最希望他们记住您经历过的哪件事？",
        "有没有哪段经历您特别想多写一些，或者不希望被写得太详细？",
    ]
    if answer_count >= MAX_ANSWERS:
        return {
            "reply": "这些线索已经足够帮您确定第一章了。我们先从最容易讲起的一段开始，后面写完一章再决定下一章。",
            "ready": True,
            "reason": "已完成规划采访",
        }
    index = max(0, min(answer_count - 1, len(prompts) - 1))
    return {
        "reply": prompts[index],
        "ready": False,
        "reason": "继续了解人生脉络",
    }


def _normalize_reply(text: str, fallback: str, ready: bool) -> str:
    normalized = re.sub(r"\s+", " ", text.strip())
    question_marks = normalized.count("？") + normalized.count("?")
    forbidden = ("覆盖度", "信息采集", "字段", "整本书安排如下")
    if (
        not normalized
        or len(normalized) > 220
        or question_marks > 1
        or any(term in normalized for term in forbidden)
    ):
        return fallback
    if not ready and question_marks == 0:
        normalized = normalized.rstrip("。！；;，,") + "？"
    return normalized
