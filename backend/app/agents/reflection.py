"""
Reflection Module — self-critique and quality assurance.

Architecture role:
  reflect_before_write()  — is the interview material sufficient?
  reflect_after_write()   — self-critique the draft chapter
  cross_chapter_review()  — check coherence across the whole book
"""

import logging
from typing import Any

from app.services.llm import llm_complete_json

logger = logging.getLogger(__name__)

BEFORE_WRITE_SYSTEM = """你是一位自传写作督导。请评估当前采访素材是否足够撰写一章。

输出 JSON：
{
  "ready": true/false,
  "confidence": 0.0-1.0,
  "material_strengths": ["素材优点1", "优点2"],
  "material_gaps": ["缺失的素材1"],
  "suggestion": "如果 ready=false，建议继续追问什么；如果 ready=true，写作时应注意什么"
}

判断标准：
- ready=true 需要至少 5 轮有效问答且有具体故事/细节/情感
- ready=false 明确指出还需要什么信息
"""

AFTER_WRITE_SYSTEM = """你是一位自传编辑。请对刚写完的章节进行自我批评。

输出 JSON：
{
  "quality_score": 0.0-1.0,
  "strengths": ["写得好的地方"],
  "weaknesses": ["需要改进的地方"],
  "missing_elements": ["遗漏了采访中的哪些重要内容"],
  "tone_issues": "语气/风格问题（如有）",
  "improvement_suggestions": ["具体修改建议"]
}
"""

CROSS_CHECK_SYSTEM = """你是一位自传总编辑。请检查这本自传的跨章节一致性。

输出 JSON：
{
  "overall_score": 0.0-1.0,
  "narrative_flow": "叙事流畅度评价",
  "contradictions": [{"chapters": "X章 vs Y章", "issue": "具体矛盾"}],
  "repetitions": ["重复出现的内容"],
  "gaps": ["叙事中的重要缺失"],
  "final_suggestion": "整体改进建议"
}
"""


async def reflect_before_write(
    chapter_title: str,
    interview_topics: list[str],
    messages: list[dict[str, str]],
) -> dict[str, Any]:
    """Evaluate if interview material is sufficient for writing."""
    interview_text = "\n".join(
        f"{m['role']}: {m['content']}" for m in messages[-30:]
    )
    topics_text = "\n".join(f"- {t}" for t in interview_topics)

    if not interview_text.strip():
        return {
            "ready": False,
            "confidence": 0.0,
            "material_strengths": [],
            "material_gaps": ["尚未开始采访"],
            "suggestion": "请先进行采访，收集足够素材后再开始写作",
        }

    try:
        data = await llm_complete_json(
            [
                {"role": "system", "content": BEFORE_WRITE_SYSTEM},
                {
                    "role": "user",
                    "content": f"章节：{chapter_title}\n\n计划话题：\n{topics_text}\n\n采访记录：\n{interview_text}",
                },
            ],
            temperature=0.3,
        )
        return data
    except Exception:
        logger.warning("Pre-write reflection failed")
        return {
            "ready": True,
            "confidence": 0.5,
            "material_strengths": ["无法评估"],
            "material_gaps": [],
            "suggestion": "素材评估失败，建议人工判断后决定是否写作",
        }


async def reflect_after_write(
    chapter_title: str,
    content: str,
    messages: list[dict[str, str]],
) -> dict[str, Any]:
    """Self-critique the generated chapter."""
    interview_text = "\n".join(
        f"{m['role']}: {m['content']}" for m in messages[-20:]
    )

    if not content.strip():
        return {
            "quality_score": 0.0,
            "strengths": [],
            "weaknesses": ["章节内容为空"],
            "missing_elements": [],
            "tone_issues": "",
            "improvement_suggestions": ["请重新生成或手动撰写"],
        }

    try:
        data = await llm_complete_json(
            [
                {"role": "system", "content": AFTER_WRITE_SYSTEM},
                {
                    "role": "user",
                    "content": f"章节标题：{chapter_title}\n\n采访素材（供参考是否遗漏内容）：\n{interview_text}\n\n章节正文：\n{content[:4000]}",
                },
            ],
            temperature=0.4,
        )
        return data
    except Exception:
        logger.warning("Post-write reflection failed for chapter: %s", chapter_title)
        return {
            "quality_score": 0.6,
            "strengths": ["已生成"],
            "weaknesses": ["无法自动评估"],
            "missing_elements": [],
            "tone_issues": "",
            "improvement_suggestions": ["请人工审阅"],
        }


async def cross_chapter_review(
    chapters: list[dict[str, Any]],
) -> dict[str, Any]:
    """Cross-chapter coherence check."""
    written = [c for c in chapters if c.get("content_md")]
    if len(written) < 2:
        return {
            "overall_score": 1.0,
            "narrative_flow": "章节数不足，无法评估",
            "contradictions": [],
            "repetitions": [],
            "gaps": [],
            "final_suggestion": "完成更多章节后再进行跨章节审查",
        }

    chapter_texts = "\n\n---\n\n".join(
        f"第{c['order']}章《{c['title']}》：\n{c.get('content_md', '')[:3000]}"
        for c in written
    )

    try:
        data = await llm_complete_json(
            [
                {"role": "system", "content": CROSS_CHECK_SYSTEM},
                {"role": "user", "content": f"请审查以下自传的跨章节质量：\n\n{chapter_texts}"},
            ],
            temperature=0.3,
        )
        return data
    except Exception:
        logger.warning("Cross-chapter review failed")
        return {
            "overall_score": 0.6,
            "narrative_flow": "无法自动评估",
            "contradictions": [],
            "repetitions": [],
            "gaps": [],
            "final_suggestion": "请人工审阅",
        }
