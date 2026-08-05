import json
import re
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.book_refiner import (
    clean_section_text,
    plan_publish_level_sections,
    write_publish_level_expansion,
    write_publish_level_section,
)
from app.agents.interviewer import parse_topics
from app.agents.memory import memory
from app.models import Chapter, ChapterStatus, Project, ProjectStatus
from app.services.chapter_service import (
    chapter_quality_report,
    ensure_enough_material_for_ai_draft,
    get_interview_messages,
    _unsupported_specifics,
)


MIN_REFINED_CHARS = 8200


async def refine_chapter_to_publish_level(
    db: AsyncSession,
    project: Project,
    chapter: Chapter,
) -> dict:
    messages = await get_interview_messages(db, chapter)
    ensure_enough_material_for_ai_draft(messages)

    material = "\n".join(
        f"- {message.get('content', '').strip()}"
        for message in messages
        if message.get("role") == "user" and message.get("content", "").strip()
    )
    topics = parse_topics(chapter.interview_topics)
    style_context = memory.preference_context(
        project.style_notes,
        project.preference_notes,
        project.memory_notes,
    )
    sections = await plan_publish_level_sections(chapter.title, topics, material)

    parts: list[str] = []
    previous = ""
    for section_title in sections:
        section = await write_publish_level_section(
            chapter.order,
            chapter.title,
            section_title,
            material,
            previous,
            style_context,
        )
        section = clean_section_text(section, section_title)
        parts.append(section)
        previous += "\n\n" + section

    source_text = "\n".join(
        item
        for item in (
            material,
            project.style_notes or "",
            project.preference_notes or "",
            project.memory_notes or "",
        )
        if item
    )
    content = f"# 第{chapter.order}章 {chapter.title}\n\n" + "\n\n".join(parts)
    content = _remove_unsupported_fact_sentences(content, source_text)
    while _compact_len(content) < MIN_REFINED_CHARS:
        expansion = await write_publish_level_expansion(
            chapter.order,
            chapter.title,
            material,
            content,
            style_context,
        )
        content += "\n\n" + clean_section_text(expansion, "余波与回望")
        content = _remove_unsupported_fact_sentences(content, source_text)

    chapter.content_md = content
    chapter.summary = _summary_from_content(content)
    chapter.status = ChapterStatus.DONE
    chapter.updated_at = datetime.now(UTC)
    project.status = ProjectStatus.REVIEWING
    project.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(chapter)

    quality = chapter_quality_report(
        chapter.content_md,
        messages,
        project.style_notes,
        project.preference_notes,
        project.memory_notes,
    )
    return {
        "chapter_id": chapter.id,
        "order": chapter.order,
        "title": chapter.title,
        "chars": _compact_len(chapter.content_md or ""),
        "quality": quality,
    }


async def refine_project_to_publish_level(db: AsyncSession, project: Project) -> dict:
    result = await db.execute(
        select(Chapter).where(Chapter.project_id == project.id).order_by(Chapter.order)
    )
    chapters = list(result.scalars().all())
    results = []
    for chapter in chapters:
        results.append(await refine_chapter_to_publish_level(db, project, chapter))
    return {
        "project_id": project.id,
        "chapters": results,
        "ready": all(item["quality"]["status"] == "good" for item in results),
    }


def _compact_len(text: str) -> int:
    return len(re.sub(r"\s+", "", text or ""))


def _summary_from_content(content: str) -> str:
    text = re.sub(r"#+\s*", "", content)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:260] + ("..." if len(text) > 260 else "")


def _remove_unsupported_fact_sentences(content: str, source_text: str) -> str:
    unsupported = _unsupported_specifics(content, source_text)
    if not unsupported:
        return content

    result_blocks: list[str] = []
    for block in content.split("\n\n"):
        if block.startswith("#"):
            result_blocks.append(block)
            continue
        sentences = re.split(r"(?<=[。！？!?])", block)
        kept = [
            sentence
            for sentence in sentences
            if sentence.strip()
            and not any(anchor in sentence for anchor in unsupported)
        ]
        cleaned = "".join(kept).strip()
        if cleaned:
            result_blocks.append(cleaned)
    return "\n\n".join(result_blocks)
