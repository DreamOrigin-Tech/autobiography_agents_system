import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.agents.interviewer import generate_question, parse_topics
from app.models import (
    Chapter,
    ChapterStatus,
    InterviewMessage,
    InterviewSession,
    Project,
    ProjectStatus,
)
from app.services.chapter_service import get_chapter

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

    # ── Agent: Memory-guided interview ──
    from app.agents.orchestra import orchestra

    guidance = await orchestra.guide_interview(chapter.title, topics, msg_dicts)
    unanswered = guidance.get("unanswered_topics", [])

    # Prioritize unanswered topics in the prompt context
    topics_with_hint = list(topics)
    if unanswered:
        topics_with_hint = unanswered + [t for t in topics if t not in unanswered]

    result = await generate_question(chapter.title, topics_with_hint, msg_dicts, summaries)
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
    }


async def submit_answer(db: AsyncSession, chapter: Chapter, content: str) -> dict:
    project_result = await db.execute(select(Project).where(Project.id == chapter.project_id))
    project = project_result.scalar_one()
    session = await get_or_create_session(db, project, chapter)
    await add_message(db, session, "user", content)
    return await generate_interview_question(db, chapter)
