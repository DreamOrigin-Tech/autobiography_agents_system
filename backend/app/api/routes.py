import json
import logging
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.auth import verify_auth
from app.db.session import get_db
from app.models import Revision
from app.rate_limit import rate_limit_llm
from app.schemas import (
    ChapterManualUpdate,
    EditApplyRequest,
    EditPreviewResponse,
    EditRequest,
    InterviewAnswerRequest,
    InterviewMessageSchema,
    LoginRequest,
    PlanRequest,
    ProjectCreate,
    ProjectDetail,
    ProjectUpdate,
    PublishedProject,
    PublishResponse,
    RevisionSchema,
)
from app.services import chapter_service, interview_service, project_service, publish_service
from app.services.patch import unified_diff

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Auth ────────────────────────────────────────────

@router.post("/auth/login")
async def login(body: LoginRequest):
    """Verify password and return a token (the password itself)."""
    import secrets

    from app.config import settings

    if not settings.access_password:
        raise HTTPException(status_code=400, detail="未配置 ACCESS_PASSWORD，请联系管理员")

    if not secrets.compare_digest(body.password, settings.access_password):
        logger.warning("Login failed: incorrect password")
        raise HTTPException(status_code=401, detail="密码错误")
    logger.info("Login successful")
    return {"token": settings.access_password, "message": "登录成功"}


# ── Projects ────────────────────────────────────────

@router.post("/projects", response_model=ProjectDetail)
async def create_project(
    body: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    project = await project_service.create_project(db, body.title, body.style_notes)
    return await project_service.get_project(db, project.id)


@router.get("/projects", response_model=list[ProjectDetail])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    projects = await project_service.list_projects(db)
    detailed = []
    for p in projects:
        detail = await project_service.get_project(db, p.id)
        if detail:
            detailed.append(detail)
    return detailed


@router.get("/projects/{project_id}", response_model=ProjectDetail)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    logger.warning("Delete project id=%s", project_id)
    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    await project_service.delete_project(db, project)
    logger.warning("Delete project id=%s title=%s — done", project_id, project.title)


@router.patch("/projects/{project_id}", response_model=ProjectDetail)
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    await project_service.update_project(db, project, body.title, body.style_notes)
    return await project_service.get_project(db, project_id)


@router.post("/projects/{project_id}/plan", response_model=ProjectDetail)
async def plan_project(
    project_id: str,
    body: PlanRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    logger.info("Plan project %s — author_background length=%d", project_id, len(body.author_background))
    rate_limit_llm(request)
    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    await project_service.plan_project_outline(db, project, body.author_background)
    logger.info("Plan project %s — done, chapters=%d", project_id, len(project.chapters))
    return await project_service.get_project(db, project_id)


@router.get("/projects/{project_id}/chapters")
async def get_project_chapters(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    return await chapter_service.list_chapters(db, project_id)


@router.get("/chapters/{chapter_id}")
async def get_chapter(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    chapter = await chapter_service.get_chapter(db, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    return chapter


@router.patch("/chapters/{chapter_id}")
async def manual_update_chapter(
    chapter_id: str,
    body: ChapterManualUpdate,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    chapter = await chapter_service.get_chapter(db, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    updated = await chapter_service.manual_update_chapter(db, chapter, body.content_md)
    return updated


@router.post("/chapters/{chapter_id}/interview/start")
async def start_interview(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    logger.info("Start interview chapter=%s", chapter_id)
    rate_limit_llm(request)
    chapter = await chapter_service.get_chapter(db, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    result = await interview_service.generate_interview_question(db, chapter)
    logger.info("Start interview chapter=%s — suggested_action=%s", chapter_id, result.get("suggested_action"))
    return result


@router.get("/chapters/{chapter_id}/interview/messages", response_model=list[InterviewMessageSchema])
async def get_interview_messages(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    chapter = await chapter_service.get_chapter(db, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    from app.models import InterviewSession

    result = await db.execute(
        select(InterviewSession).where(InterviewSession.chapter_id == chapter_id).limit(1)
    )
    session = result.scalar_one_or_none()
    if not session:
        return []
    messages = await interview_service.get_session_messages(db, session.id)
    return messages


@router.post("/chapters/{chapter_id}/interview/answer")
async def submit_interview_answer(
    chapter_id: str,
    body: InterviewAnswerRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    logger.info("Interview answer chapter=%s answer_len=%d", chapter_id, len(body.content))
    rate_limit_llm(request)
    chapter = await chapter_service.get_chapter(db, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    result = await interview_service.submit_answer(db, chapter, body.content)
    logger.info("Interview answer chapter=%s — next suggested_action=%s", chapter_id, result.get("suggested_action"))
    return result


@router.get("/chapters/{chapter_id}/interview/stream")
async def stream_interview(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    rate_limit_llm(request)
    chapter = await chapter_service.get_chapter(db, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")

    async def event_generator() -> AsyncGenerator[dict, None]:
        try:
            result = await interview_service.generate_interview_question(db, chapter)
            yield {"event": "question", "data": json.dumps(result, ensure_ascii=False)}
            yield {"event": "done", "data": json.dumps({"status": "ok"})}
        except Exception as exc:
            yield {"event": "error", "data": json.dumps({"message": str(exc)})}

    return EventSourceResponse(event_generator())


@router.post("/chapters/{chapter_id}/write")
async def write_chapter(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    logger.info("Write chapter (non-stream) chapter=%s", chapter_id)
    rate_limit_llm(request)
    chapter = await chapter_service.get_chapter(db, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    updated = await chapter_service.write_chapter_content(db, chapter)
    logger.info("Write chapter chapter=%s — done, content_len=%d", chapter_id, len(updated.content_md or ""))
    return updated


@router.get("/chapters/{chapter_id}/write/stream")
async def stream_write_chapter(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    logger.info("Write chapter (SSE stream) chapter=%s", chapter_id)
    rate_limit_llm(request)
    chapter = await chapter_service.get_chapter(db, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")

    async def event_generator() -> AsyncGenerator[dict, None]:
        token_count = 0

        try:
            async for token in chapter_service.stream_write_chapter_content(db, chapter):
                token_count += 1
                yield {"event": "token", "data": json.dumps({"text": token}, ensure_ascii=False)}
            logger.info("SSE write done chapter=%s tokens=%d", chapter_id, token_count)
            refreshed = await chapter_service.get_chapter(db, chapter_id)
            yield {
                "event": "done",
                "data": json.dumps(
                    {"content_md": refreshed.content_md if refreshed else ""},
                    ensure_ascii=False,
                ),
            }
        except Exception as exc:
            logger.exception("SSE write stream failed for chapter=%s", chapter_id)
            yield {"event": "error", "data": json.dumps({"message": str(exc)})}

    return EventSourceResponse(event_generator(), ping=8)


@router.post("/chapters/{chapter_id}/edit", response_model=EditPreviewResponse)
async def preview_edit(
    chapter_id: str,
    body: EditRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    logger.info("Preview edit chapter=%s instruction_len=%d", chapter_id, len(body.instruction))
    rate_limit_llm(request)
    chapter = await chapter_service.get_chapter(db, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    revision = await chapter_service.preview_edit(db, chapter, body.instruction)
    logger.info("Preview edit chapter=%s — revision_id=%s", chapter_id, revision.id)
    diff_text = getattr(revision, "_diff_text", None) or unified_diff(
        revision.content_before or "", revision.content_after or ""
    )
    patches_data = json.loads(revision.diff_json).get("patches", [])
    return EditPreviewResponse(
        revision_id=revision.id,
        instruction=revision.instruction,
        content_before=revision.content_before or "",
        content_after=revision.content_after or "",
        diff_text=diff_text,
        patches=patches_data,
    )


@router.post("/chapters/{chapter_id}/edit/apply")
async def apply_edit(
    chapter_id: str,
    body: EditApplyRequest,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    chapter = await chapter_service.get_chapter(db, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    result = await db.execute(select(Revision).where(Revision.id == body.revision_id))
    revision = result.scalar_one_or_none()
    if not revision or revision.chapter_id != chapter_id:
        raise HTTPException(status_code=404, detail="修改记录不存在")
    updated = await chapter_service.apply_revision(db, chapter, revision)
    return updated


@router.post("/chapters/{chapter_id}/revisions/{revision_id}/rollback")
async def rollback_revision(
    chapter_id: str,
    revision_id: str,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    chapter = await chapter_service.get_chapter(db, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    result = await db.execute(select(Revision).where(Revision.id == revision_id))
    revision = result.scalar_one_or_none()
    if not revision or revision.chapter_id != chapter_id:
        raise HTTPException(status_code=404, detail="修改记录不存在")
    updated = await chapter_service.rollback_revision(db, chapter, revision)
    return updated


@router.get("/chapters/{chapter_id}/revisions", response_model=list[RevisionSchema])
async def list_revisions(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    return await chapter_service.list_revisions(db, chapter_id)


@router.post("/projects/{project_id}/publish", response_model=PublishResponse)
async def publish_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    try:
        updated, count = await publish_service.publish_project(db, project)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return PublishResponse(
        is_published=updated.is_published,
        share_token=updated.share_token or "",
        published_at=updated.published_at,
        published_chapter_count=count,
    )


@router.post("/projects/{project_id}/unpublish", response_model=ProjectDetail)
async def unpublish_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    await publish_service.unpublish_project(db, project)
    return await project_service.get_project(db, project_id)


@router.get("/public/share/{share_token}", response_model=PublishedProject)
async def get_public_project(share_token: str, db: AsyncSession = Depends(get_db)):
    project = await publish_service.get_published_by_token(db, share_token)
    if not project:
        raise HTTPException(status_code=404, detail="分享链接无效或已取消发布")
    data = publish_service.to_published_view(project)
    if not data["chapters"]:
        raise HTTPException(status_code=404, detail="暂无已发布内容")
    return data


# ── Agent: Timeline ─────────────────────────────────

@router.get("/projects/{project_id}/timeline")
async def get_project_timeline(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    try:
        events = json.loads(project.timeline_json) if project.timeline_json else []
    except json.JSONDecodeError:
        events = []
    return {"project_id": project_id, "events": events}


# ── Agent: Reflection Notes ─────────────────────────

@router.get("/chapters/{chapter_id}/reflection")
async def get_chapter_reflection(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    chapter = await chapter_service.get_chapter(db, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    notes = {}
    if chapter.reflection_notes:
        try:
            notes = json.loads(chapter.reflection_notes)
        except json.JSONDecodeError:
            pass
    coverage = {}
    if chapter.topic_coverage:
        try:
            coverage = json.loads(chapter.topic_coverage)
        except json.JSONDecodeError:
            pass
    return {
        "chapter_id": chapter_id,
        "reflection_notes": notes,
        "topic_coverage": coverage,
    }


# ── Agent: Full Cross-Chapter Review ────────────────

@router.get("/projects/{project_id}/review")
async def review_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(verify_auth),
):
    from app.agents.orchestra import orchestra

    project = await project_service.get_project(db, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    chapters_data = [
        {"order": c.order, "title": c.title, "content_md": c.content_md or ""}
        for c in project.chapters
    ]
    review = await orchestra.full_review(chapters_data)

    # Build a chapter-by-chapter summary
    chapter_summaries = []
    for c in project.chapters:
        ref = {}
        if c.reflection_notes:
            try:
                ref = json.loads(c.reflection_notes)
            except json.JSONDecodeError:
                pass
        chapter_summaries.append({
            "order": c.order,
            "title": c.title,
            "status": c.status,
            "quality_score": ref.get("quality_score"),
            "strengths": ref.get("strengths", []),
            "weaknesses": ref.get("weaknesses", []),
        })

    return {
        "project_id": project_id,
        "review": review,
        "chapters": chapter_summaries,
    }
