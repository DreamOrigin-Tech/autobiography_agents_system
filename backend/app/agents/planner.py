"""Compatibility re-export — see planning.py for the full Planning module."""

from app.agents.planning import (
    create_plan,
    create_plan_fallback,
    topics_to_text,
)

# Keep old names for backward compatibility with existing services
plan_outline = create_plan
plan_outline_fallback = create_plan_fallback

__all__ = [
    "plan_outline",
    "plan_outline_fallback",
    "topics_to_text",
]
