import logging

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.agents.planning import (
    create_next_chapter as generate_next_chapter,
    create_next_chapter_fallback,
    topics_to_text,
)
from app.models import Chapter, ChapterStatus, Project, ProjectStatus, User

logger = logging.getLogger(__name__)


async def create_project(
    db: AsyncSession,
    user: User,
    title: str,
    style_notes: str | None,
    preference_notes: str | None = None,
) -> Project:
    project = Project(
        user_id=user.id,
        title=title,
        style_notes=style_notes,
        preference_notes=preference_notes,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


async def list_projects(db: AsyncSession, user_id: str) -> list[Project]:
    result = await db.execute(
        select(Project)
        .where(Project.user_id == user_id)
        .options(selectinload(Project.chapters))
        .order_by(Project.updated_at.desc())
    )
    return list(result.scalars().all())


async def get_project(db: AsyncSession, project_id: str, user_id: str) -> Project | None:
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id, Project.user_id == user_id)
        .options(selectinload(Project.chapters))
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def update_project(
    db: AsyncSession,
    project: Project,
    title: str | None,
    style_notes: str | None,
    preference_notes: str | None = None,
    memory_notes: str | None = None,
) -> Project:
    if title is not None:
        project.title = title
    if style_notes is not None:
        project.style_notes = style_notes
    if preference_notes is not None:
        project.preference_notes = preference_notes
    if memory_notes is not None:
        project.memory_notes = memory_notes
    await db.commit()
    await db.refresh(project)
    return project


async def delete_project(db: AsyncSession, project: Project) -> None:
    await db.delete(project)
    await db.commit()


async def claim_chapter_generation(
    db: AsyncSession, project_id: str, user_id: str
) -> bool:
    result = await db.execute(
        update(Project)
        .where(
            Project.id == project_id,
            Project.user_id == user_id,
            Project.status != ProjectStatus.GENERATING,
        )
        .values(status=ProjectStatus.GENERATING)
    )
    await db.commit()
    return result.rowcount == 1


async def release_chapter_generation(
    db: AsyncSession, project_id: str, user_id: str, previous_status: str
) -> None:
    await db.execute(
        update(Project)
        .where(
            Project.id == project_id,
            Project.user_id == user_id,
            Project.status == ProjectStatus.GENERATING,
        )
        .values(status=previous_status)
    )
    await db.commit()


async def create_next_project_chapter(
    db: AsyncSession,
    project: Project,
    planning_context: str,
    direction: str | None = None,
) -> Chapter:
    existing = sorted(project.chapters, key=lambda chapter: chapter.order)
    next_order = max((chapter.order for chapter in existing), default=0) + 1
    existing_context = [
        {
            "order": chapter.order,
            "title": chapter.title,
            "summary": chapter.summary or (chapter.content_md or "")[:500],
        }
        for chapter in existing
    ]

    try:
        item = await generate_next_chapter(
            project.title,
            planning_context,
            existing_context,
            direction,
            project.style_notes,
        )
    except Exception:
        logger.exception("Next chapter planning failed for project=%s, using fallback", project.id)
        item = create_next_chapter_fallback(next_order, direction)

    chapter = Chapter(
        project_id=project.id,
        order=next_order,
        title=item.title,
        interview_topics=topics_to_text(item.interview_topics),
        status=ChapterStatus.PENDING,
    )
    db.add(chapter)

    project.status = ProjectStatus.INTERVIEWING
    await db.commit()
    await db.refresh(chapter)
    return chapter
