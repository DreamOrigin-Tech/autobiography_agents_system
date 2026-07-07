"""
Tool Use Module — extract, check, verify.

Architecture role:
  extract_timeline()     — pull key events + dates from interview Q&A
  check_consistency()    — cross-reference facts across all chapters
  check_topic_coverage() — verify all planned interview topics were discussed
"""

import json
import logging
from typing import Any

from app.services.llm import llm_complete_json

logger = logging.getLogger(__name__)

TIMELINE_SYSTEM = """你是一位自传编辑助手。请从采访对话中提取关键事件及时间。

输出 JSON：
{
  "events": [
    {
      "date": "1968年" | "1968年夏" | "1960年代" | "不清楚",
      "event": "简短事件描述（15字以内）",
      "chapter": "相关章节序号"
    }
  ]
}

规则：
- 只提取有时间标记的事件
- 日期保留原文表述
- 事件描述保持简洁
"""

CONSISTENCY_SYSTEM = """你是一位严谨的自传编辑。检查以下章节之间是否存在事实矛盾。

输出 JSON：
{
  "issues": [
    {
      "severity": "critical" | "minor",
      "location": "第X章 vs 第Y章",
      "detail": "具体矛盾描述",
      "suggestion": "修改建议"
    }
  ]
}

如果无矛盾，返回 {"issues": []}。
"""


async def extract_timeline(
    messages: list[dict[str, str]],
    chapter_order: int,
) -> list[dict[str, Any]]:
    """Extract key timeline events from interview messages."""
    interview_text = "\n".join(
        f"{m['role']}: {m['content']}" for m in messages[-30:]
    )
    if not interview_text.strip():
        return []

    try:
        data = await llm_complete_json(
            [
                {"role": "system", "content": TIMELINE_SYSTEM},
                {"role": "user", "content": f"第{chapter_order}章采访记录：\n{interview_text}"},
            ],
            temperature=0.3,
        )
        for event in data.get("events", []):
            event["chapter"] = chapter_order
        return data.get("events", [])
    except Exception:
        logger.warning("Timeline extraction failed for chapter %d", chapter_order)
        return []


async def check_consistency(
    chapters: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Check for factual contradictions across all written chapters."""
    written = [c for c in chapters if c.get("content_md")]
    if len(written) < 2:
        return []

    chapter_texts = "\n\n---\n\n".join(
        f"第{c['order']}章《{c['title']}》：\n{c.get('content_md', '')[:2000]}"
        for c in written
    )

    try:
        data = await llm_complete_json(
            [
                {"role": "system", "content": CONSISTENCY_SYSTEM},
                {"role": "user", "content": f"请检查以下自传章节之间的一致性：\n\n{chapter_texts}"},
            ],
            temperature=0.2,
        )
        return data.get("issues", [])
    except Exception:
        logger.warning("Consistency check failed")
        return []


async def check_topic_coverage(
    interview_topics: list[str],
    messages: list[dict[str, str]],
) -> dict[str, Any]:
    """Use LLM to analyze if all interview topics were adequately covered."""
    if not interview_topics:
        return {"coverage": 1.0, "missing": [], "weak": []}

    user_text = "\n".join(
        f"{m['role']}: {m['content']}" for m in messages[-30:]
    )

    prompt = f"""请评估以下采访对每个话题的覆盖程度。

待覆盖话题：
{json.dumps(interview_topics, ensure_ascii=False)}

采访记录：
{user_text}

输出 JSON：
{{
  "coverage": 0.0-1.0,
  "missing": ["完全没聊到的话题"],
  "weak": ["聊了但不够深入的话题"],
  "strong": ["覆盖充分的话题"],
  "suggestion": "一句话建议：还需要重点追问什么"
}}"""

    try:
        data = await llm_complete_json(
            [
                {"role": "system", "content": "你是一位采访质量评估专家。请严格评估采访是否充分覆盖了计划中的话题。"},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
        )
        data.setdefault("coverage", 0.5)
        data.setdefault("missing", [])
        data.setdefault("weak", [])
        data.setdefault("strong", [])
        return data
    except Exception:
        logger.warning("Topic coverage check failed")
        return {"coverage": 0.5, "missing": [], "weak": [], "strong": [], "suggestion": ""}
