"""
Orchestrator — coordinates Memory, Planning, Tools, and Reflection modules.

                        ┌──────────────┐
                        │  Orchestra   │
                        └──────┬───────┘
           ┌───────────────────┼───────────────────┐
           │                   │                   │
    ┌──────▼──────┐   ┌───────▼───────┐   ┌───────▼───────┐
    │   Memory    │   │   Planning    │   │  Reflection   │
    │  ─────────  │   │  ───────────  │   │  ───────────  │
    │ ShortTerm   │   │ create_plan   │   │ before_write  │
    │ LongTerm    │   │ suggest_next  │   │ after_write   │
    │ Semantic    │   │               │   │ cross_chapter  │
    └──────┬──────┘   └───────────────┘   └───────┬───────┘
           │                                       │
           │         ┌───────────────┐             │
           └─────────┤   Tool Use    ├─────────────┘
                     │  ───────────  │
                     │ timeline      │
                     │ consistency   │
                     │ coverage      │
                     └───────────────┘
"""

import json
from typing import Any

from app.agents.memory import memory
from app.agents.planning import suggest_next_action as plan_suggest_next
from app.agents.reflection import (
    cross_chapter_review,
    reflect_after_write,
    reflect_before_write,
)
from app.agents.tools import check_consistency, check_topic_coverage, extract_timeline


class Orchestra:
    """Central coordinator that wires together all agent modules."""

    # ── Pre-Write Pipeline ────────────────────────

    async def prepare_for_writing(
        self,
        chapter_title: str,
        interview_topics: list[str],
        messages: list[dict[str, str]],
    ) -> dict[str, Any]:
        """Run all pre-write checks and return a combined report."""
        # Memory: analyze coverage
        coverage = memory.topic_coverage_summary(interview_topics, messages)

        # Reflection: is the material sufficient?
        reflection = await reflect_before_write(chapter_title, interview_topics, messages)

        # Tools: LLM-based topic coverage check
        llm_coverage = await check_topic_coverage(interview_topics, messages)

        return {
            "ready": reflection.get("ready", False),
            "confidence": reflection.get("confidence", 0.5),
            "topic_coverage": coverage,
            "llm_coverage": llm_coverage,
            "material_strengths": reflection.get("material_strengths", []),
            "material_gaps": reflection.get("material_gaps", []),
            "suggestion": reflection.get("suggestion", ""),
        }

    # ── Post-Write Pipeline ───────────────────────

    async def review_after_writing(
        self,
        chapter_title: str,
        content: str,
        messages: list[dict[str, str]],
        chapter_order: int,
        all_chapters: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Run all post-write quality checks."""
        # Reflection: self-critique
        reflection = await reflect_after_write(chapter_title, content, messages)

        # Tools: consistency check
        consistency_issues = await check_consistency(all_chapters)

        # Tools: timeline extraction
        timeline_events = await extract_timeline(messages, chapter_order)

        # Format reflection notes for storage
        notes = {
            "quality_score": reflection.get("quality_score", 0.5),
            "strengths": reflection.get("strengths", []),
            "weaknesses": reflection.get("weaknesses", []),
            "missing_elements": reflection.get("missing_elements", []),
            "improvement_suggestions": reflection.get("improvement_suggestions", []),
        }

        return {
            "reflection_notes": json.dumps(notes, ensure_ascii=False),
            "consistency_issues": consistency_issues,
            "timeline_events": timeline_events,
            "raw_reflection": reflection,
        }

    # ── Interview Guidance ─────────────────────────

    async def guide_interview(
        self,
        chapter_title: str,
        interview_topics: list[str],
        messages: list[dict[str, str]],
    ) -> dict[str, Any]:
        """Provide guidance for the next interview question."""
        # Memory: find unanswered topics
        unanswered = memory.find_unanswered_topics(interview_topics, messages)

        # Memory: topic coverage
        coverage = memory.topic_coverage_summary(interview_topics, messages)

        # Count rounds
        user_rounds = memory.count_user_rounds(messages)

        suggested_action = "continue"
        if user_rounds >= 5 and coverage["total_chars"] > 500:
            suggested_action = "write_chapter"

        return {
            "unanswered_topics": unanswered,
            "topic_coverage": coverage,
            "user_rounds": user_rounds,
            "suggested_action": suggested_action,
            "suggestion": (
                "素材已较充分，可以开始写作" if suggested_action == "write_chapter"
                else f"还有 {len(unanswered)} 个话题未覆盖，建议追问"
            ),
        }

    # ── Planning Advice ────────────────────────────

    async def suggest_next_step(
        self,
        project_status: str,
        chapters_status: list[dict],
    ) -> dict[str, Any]:
        """Suggest what the user should do next."""
        return await plan_suggest_next(project_status, chapters_status)

    # ── Full Cross-Chapter Review ──────────────────

    async def full_review(
        self,
        chapters: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Complete cross-chapter quality review."""
        return await cross_chapter_review(chapters)


# Singleton
orchestra = Orchestra()
