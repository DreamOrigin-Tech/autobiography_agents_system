"""
Memory Module — short-term / long-term / semantic recall.

Architecture role:
  ShortTerm:  recent Q&A context (last N messages)
  LongTerm:   chapter summaries from completed chapters
  Semantic:   keyword-based search across all interviews to avoid
              repeating questions and find related material.
"""

import re
from typing import Any


class AgentMemory:
    """Unified memory interface used by Interviewer, Writer, and Editor."""

    # ── Short-Term Memory ─────────────────────────

    @staticmethod
    def recent_messages(
        messages: list[dict[str, str]], last_n: int = 20
    ) -> list[dict[str, str]]:
        """Return the most recent N messages (sliding window)."""
        return messages[-last_n:] if len(messages) > last_n else messages

    @staticmethod
    def count_user_rounds(messages: list[dict[str, str]]) -> int:
        """How many questions has the user answered."""
        return sum(1 for m in messages if m.get("role") == "user")

    # ── Long-Term Memory ──────────────────────────

    @staticmethod
    def chapter_context(
        summaries: list[str],
        prev_summary: str | None = None,
        next_summary: str | None = None,
    ) -> str:
        """Build cross-chapter context string for the Writer."""
        parts: list[str] = []
        if prev_summary:
            parts.append(f"上一章摘要：{prev_summary}")
        if next_summary:
            parts.append(f"下一章摘要：{next_summary}")
        if summaries:
            parts.append("已完成章节摘要：\n" + "\n".join(f"- {s}" for s in summaries))
        return "\n".join(parts)

    # ── Semantic Memory ───────────────────────────

    @staticmethod
    def extract_keywords(text: str, min_length: int = 2) -> list[str]:
        """Simple keyword extraction for Chinese text."""
        # Split on Chinese punctuation and whitespace
        segments = re.split(r"[，。！？；：、\s]+", text)
        keywords: list[str] = []
        for seg in segments:
            seg = seg.strip()
            if len(seg) >= min_length:
                keywords.append(seg)
        return keywords

    def find_unanswered_topics(
        self, topics: list[str], messages: list[dict[str, str]]
    ) -> list[str]:
        """Return topics that have NOT been discussed yet."""
        user_text = " ".join(
            m.get("content", "") for m in messages if m.get("role") == "user"
        )
        unanswered: list[str] = []
        for topic in topics:
            # Check if any significant part of the topic was mentioned
            kws = self.extract_keywords(topic)
            if not kws:
                continue
            # If fewer than half the keywords appear, consider it unanswered
            matched = sum(1 for kw in kws if kw in user_text)
            if matched < max(1, len(kws) // 2):
                unanswered.append(topic)
        return unanswered

    @staticmethod
    def topic_coverage_summary(
        interview_topics: list[str], messages: list[dict[str, str]]
    ) -> dict[str, Any]:
        """Analyze which topics have been covered and how deeply."""
        user_text = " ".join(
            m.get("content", "") for m in messages if m.get("role") == "user"
        )
        total_chars = len(user_text)

        result: dict[str, Any] = {"topics": [], "total_rounds": 0, "total_chars": total_chars}
        user_rounds = sum(1 for m in messages if m.get("role") == "user")
        result["total_rounds"] = user_rounds

        for topic in interview_topics:
            kws = AgentMemory.extract_keywords(topic)
            matched = sum(1 for kw in kws if kw in user_text)
            coverage = matched / max(1, len(kws))
            result["topics"].append({
                "topic": topic,
                "coverage": round(coverage, 2),
                "status": "covered" if coverage >= 0.5 else "shallow" if coverage >= 0.2 else "untouched",
            })

        return result


# Singleton
memory = AgentMemory()
