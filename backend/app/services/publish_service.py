import secrets
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.agents.book_designer import design_book_layout
from app.models import Chapter, ChapterStatus, Project
from app.services.book_pdf import BookChapter, BookPdfData, build_book_pdf


def _new_share_token() -> str:
    return secrets.token_urlsafe(16)


def _published_chapters(project: Project) -> list[Chapter]:
    return [
        ch
        for ch in sorted(project.chapters, key=lambda c: c.order)
        if ch.status == ChapterStatus.DONE and ch.content_md
    ]


async def publish_project(db: AsyncSession, project: Project) -> tuple[Project, int]:
    readiness = await publish_readiness(db, project)
    if not readiness["ready"]:
        raise ValueError(str(readiness["message"]))

    result = await db.execute(
        select(Chapter).where(Chapter.project_id == project.id).order_by(Chapter.order)
    )
    chapters = [
        chapter
        for chapter in result.scalars().all()
        if chapter.status == ChapterStatus.DONE and chapter.content_md
    ]

    if not project.share_token:
        project.share_token = _new_share_token()

    project.is_published = True
    project.published_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(project)
    return project, len(chapters)


async def publish_readiness(db: AsyncSession, project: Project) -> dict:
    from app.services import chapter_service

    result = await db.execute(
        select(Chapter).where(Chapter.project_id == project.id).order_by(Chapter.order)
    )
    chapters = [
        chapter
        for chapter in result.scalars().all()
        if chapter.status == ChapterStatus.DONE and chapter.content_md
    ]
    chapter_reports: list[dict] = []
    risky_count = 0

    for chapter in chapters:
        messages = await chapter_service.get_interview_messages(db, chapter)
        quality = chapter_service.chapter_quality_report(
            chapter.content_md,
            messages,
            project.style_notes,
            project.preference_notes,
            project.memory_notes,
        )
        if quality["status"] == "risky":
            risky_count += 1
        chapter_reports.append({
            "chapter_id": chapter.id,
            "order": chapter.order,
            "title": chapter.title,
            "status": chapter.status,
            "quality_score": quality["score"],
            "quality_max_score": quality["max_score"],
            "quality_status": quality["status"],
            "message": quality["message"],
            "risks": quality["risks"],
            "suggestions": quality["suggestions"],
        })

    ready = bool(chapters) and risky_count == 0
    if not chapters:
        message = "至少完成一个章节后才能发布。"
    elif risky_count:
        message = f"有 {risky_count} 章质量风险偏高，建议复核后再发布。"
    else:
        message = f"已有 {len(chapters)} 章可发布。"

    return {
        "ready": ready,
        "publishable_chapter_count": len(chapters),
        "risky_chapter_count": risky_count,
        "message": message,
        "chapters": chapter_reports,
    }


async def unpublish_project(db: AsyncSession, project: Project) -> Project:
    project.is_published = False
    await db.commit()
    await db.refresh(project)
    return project


async def get_published_by_token(db: AsyncSession, share_token: str) -> Project | None:
    result = await db.execute(
        select(Project)
        .where(Project.share_token == share_token, Project.is_published.is_(True))
        .options(selectinload(Project.chapters))
    )
    return result.scalar_one_or_none()


def to_published_view(project: Project) -> dict:
    chapters = _published_chapters(project)
    return {
        "title": project.title,
        "published_at": project.published_at,
        "chapters": [
            {"order": ch.order, "title": ch.title, "content_md": ch.content_md or ""}
            for ch in chapters
        ],
    }


async def export_project_pdf(db: AsyncSession, project: Project) -> tuple[bytes, str]:
    readiness = await publish_readiness(db, project)
    if not readiness["ready"]:
        raise ValueError(str(readiness["message"]))

    result = await db.execute(
        select(Chapter).where(Chapter.project_id == project.id).order_by(Chapter.order)
    )
    chapters = [
        chapter
        for chapter in result.scalars().all()
        if chapter.status == ChapterStatus.DONE and chapter.content_md
    ]
    layout = await design_book_layout(
        project.title,
        [{"order": chapter.order, "title": chapter.title} for chapter in chapters],
        project.style_notes,
        project.preference_notes,
    )
    pdf_bytes = build_book_pdf(
        BookPdfData(
            title=project.title,
            style_notes=project.style_notes,
            chapters=[
                BookChapter(
                    order=chapter.order,
                    title=chapter.title,
                    content_md=chapter.content_md or "",
                )
                for chapter in chapters
            ],
        ),
        layout,
    )
    return pdf_bytes, _safe_pdf_filename(project.title)


def _safe_pdf_filename(title: str) -> str:
    cleaned = "".join(ch for ch in title.strip() if ch not in '\\/:*?"<>|')
    cleaned = cleaned or "autobiography"
    return f"{cleaned[:48]}.pdf"
