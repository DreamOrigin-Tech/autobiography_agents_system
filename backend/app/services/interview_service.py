import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.agents.interview_assistant import generate_assistant_brief
from app.agents.interviewer import generate_question, parse_topics
from app.agents.memory import memory
from app.models import (
    Chapter,
    ChapterStatus,
    InterviewMessage,
    InterviewSession,
    Project,
    ProjectStatus,
)
from app.services.chapter_service import chapter_coverage

logger = logging.getLogger(__name__)


async def get_or_create_session(db: AsyncSession, project: Project, chapter: Chapter) -> InterviewSession:
    result = await db.execute(
        select(InterviewSession)
        .where(InterviewSession.chapter_id == chapter.id)
        .options(selectinload(InterviewSession.messages))
        .order_by(InterviewSession.created_at.desc())
        .limit(1)
    )
    session = result.scalar_one_or_none()
    if session:
        return session

    session = InterviewSession(project_id=project.id, chapter_id=chapter.id)
    db.add(session)
    chapter.status = ChapterStatus.INTERVIEWING
    project.status = ProjectStatus.INTERVIEWING
    await db.commit()
    await db.refresh(session)
    return session


async def get_session_messages(db: AsyncSession, session_id: str) -> list[InterviewMessage]:
    result = await db.execute(
        select(InterviewMessage)
        .where(InterviewMessage.session_id == session_id)
        .order_by(InterviewMessage.created_at)
    )
    return list(result.scalars().all())


async def add_message(
    db: AsyncSession, session: InterviewSession, role: str, content: str
) -> InterviewMessage:
    message = InterviewMessage(session_id=session.id, role=role, content=content)
    db.add(message)
    result = await db.execute(select(Project).where(Project.id == session.project_id))
    project = result.scalar_one_or_none()
    if project:
        project.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(message)
    return message


async def get_chapter_summaries(db: AsyncSession, project_id: str, before_order: int) -> list[str]:
    result = await db.execute(
        select(Chapter)
        .where(Chapter.project_id == project_id, Chapter.order < before_order, Chapter.summary.isnot(None))
        .order_by(Chapter.order)
    )
    chapters = result.scalars().all()
    return [c.summary for c in chapters if c.summary]


async def generate_interview_question(db: AsyncSession, chapter: Chapter) -> dict:
    project_result = await db.execute(select(Project).where(Project.id == chapter.project_id))
    project = project_result.scalar_one()

    session = await get_or_create_session(db, project, chapter)
    messages = await get_session_messages(db, session.id)
    msg_dicts = [{"role": m.role, "content": m.content} for m in messages]
    topics = parse_topics(chapter.interview_topics)
    summaries = await get_chapter_summaries(db, project.id, chapter.order)
    preference_context = memory.preference_context(
        project.style_notes,
        project.preference_notes,
        project.memory_notes,
    )
    coverage = chapter_coverage(msg_dicts)
    coverage_context = _coverage_prompt_context(coverage)

    # ── Agent: Memory-guided interview ──
    from app.agents.orchestra import orchestra

    guidance = await orchestra.guide_interview(chapter.title, topics, msg_dicts)
    unanswered = guidance.get("unanswered_topics", [])

    # Prioritize unanswered topics in the prompt context
    topics_with_hint = list(topics)
    if unanswered:
        topics_with_hint = unanswered + [t for t in topics if t not in unanswered]

    result = await generate_question(
        chapter.title,
        topics_with_hint,
        msg_dicts,
        summaries,
        preference_context,
        coverage_context,
    )
    question = result.get("question", "请分享一个让您印象最深刻的故事。")

    # Override suggested_action with orchestra's assessment
    if guidance.get("suggested_action") == "write_chapter":
        result["suggested_action"] = "write_chapter"

    await add_message(db, session, "agent", question)
    logger.info(
        "Interview question chapter=%s rounds=%d unanswered=%d suggested=%s",
        chapter.title, len(msg_dicts) // 2, len(unanswered), result.get("suggested_action"),
    )
    return {
        "question": question,
        "intent": result.get("intent", ""),
        "suggested_action": result.get("suggested_action", "continue"),
        "reason": result.get("reason", ""),
        "session_id": session.id,
        "unanswered_topics": unanswered,
        "chapter_coverage": coverage,
    }


async def submit_answer(db: AsyncSession, chapter: Chapter, content: str) -> dict:
    project_result = await db.execute(select(Project).where(Project.id == chapter.project_id))
    project = project_result.scalar_one()
    session = await get_or_create_session(db, project, chapter)
    await add_message(db, session, "user", content)
    previous_notes = project.memory_notes
    learned_notes = memory.learn_preference_from_answer(content, project.memory_notes)
    memory_updated = learned_notes != previous_notes
    if memory_updated:
        project.memory_notes = learned_notes
        await db.commit()
    topics = parse_topics(chapter.interview_topics)
    quality = memory.answer_quality(content)
    if not quality["is_substantive"]:
        question = memory.detail_followup_question(content, chapter.title, topics)
        await add_message(db, session, "agent", question)
        return {
            "question": question,
            "intent": "追问细节",
            "suggested_action": "continue",
            "reason": quality["reason"],
            "session_id": session.id,
            "memory_updated": memory_updated,
            "memory_notes": learned_notes,
            "answer_quality": quality,
        }
    result = await generate_interview_question(db, chapter)
    result["memory_updated"] = memory_updated
    result["memory_notes"] = learned_notes
    result["answer_quality"] = quality
    return result


async def record_assistant_turn(
    db: AsyncSession,
    chapter: Chapter,
    role: str,
    content: str,
) -> dict:
    project_result = await db.execute(select(Project).where(Project.id == chapter.project_id))
    project = project_result.scalar_one()
    session = await get_or_create_session(db, project, chapter)
    await add_message(db, session, role, content)
    messages = await get_session_messages(db, session.id)
    msg_dicts = [{"role": m.role, "content": m.content} for m in messages]
    topics = parse_topics(chapter.interview_topics)
    coverage = chapter_coverage(msg_dicts)
    coverage_context = _coverage_prompt_context(coverage)
    brief = await generate_assistant_brief(chapter.title, topics, msg_dicts, coverage_context)
    brief["session_id"] = session.id
    brief["chapter_coverage"] = coverage
    brief["transcript_stats"] = _assistant_transcript_stats(msg_dicts)
    return brief


async def generate_assistant_guidance(db: AsyncSession, chapter: Chapter) -> dict:
    project_result = await db.execute(select(Project).where(Project.id == chapter.project_id))
    project = project_result.scalar_one()
    session = await get_or_create_session(db, project, chapter)
    messages = await get_session_messages(db, session.id)
    msg_dicts = [{"role": m.role, "content": m.content} for m in messages]
    topics = parse_topics(chapter.interview_topics)
    coverage = chapter_coverage(msg_dicts)
    coverage_context = _coverage_prompt_context(coverage)
    brief = await generate_assistant_brief(chapter.title, topics, msg_dicts, coverage_context)
    brief["session_id"] = session.id
    brief["chapter_coverage"] = coverage
    brief["transcript_stats"] = _assistant_transcript_stats(msg_dicts)
    return brief


def _assistant_transcript_stats(messages: list[dict[str, str]]) -> dict:
    interviewee_turns = [
        m.get("content", "")
        for m in messages
        if m.get("role") == "user" and m.get("content", "").strip()
    ]
    interviewer_turns = [
        m.get("content", "")
        for m in messages
        if m.get("role") == "interviewer" and m.get("content", "").strip()
    ]
    note_turns = [
        m.get("content", "")
        for m in messages
        if m.get("role") == "note" and m.get("content", "").strip()
    ]
    return {
        "interviewee_turns": len(interviewee_turns),
        "interviewer_turns": len(interviewer_turns),
        "note_turns": len(note_turns),
        "interviewee_chars": sum(len(text) for text in interviewee_turns),
    }


def _coverage_prompt_context(coverage: dict) -> str:
    missing = coverage.get("missing_dimensions", [])
    covered = coverage.get("covered_dimensions", [])
    return (
        f"完成度：{coverage.get('score', 0)}/{coverage.get('max_score', 5)}，"
        f"{coverage.get('percent', 0)}%。\n"
        f"已覆盖：{', '.join(covered) if covered else '暂无'}\n"
        f"缺失维度：{', '.join(missing) if missing else '无'}\n"
        f"下一问策略：{coverage.get('next_suggestion', '')}"
    )
