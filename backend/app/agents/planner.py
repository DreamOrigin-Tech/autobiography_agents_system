"""Compatibility re-export — see planning.py for the full Planning module."""

from app.agents.planning import (
    create_next_chapter,
    create_next_chapter_fallback,
    topics_to_text,
)

__all__ = [
    "create_next_chapter",
    "create_next_chapter_fallback",
    "topics_to_text",
]
