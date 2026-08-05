import json
import logging
import secrets
from collections.abc import AsyncGenerator
from urllib.parse import quote, urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.auth import (
    clear_session_cookie,
    consume_oauth_state,
    create_oauth_state,
    create_session,
    get_current_user,
    get_or_create_local_user,
    normalize_next_path,
    revoke_current_session,
    set_session_cookie,
)
from app.config import settings
from app.db.session import get_db
from app.models import ChapterStatus, Revision, User
from app.rate_limit import rate_limit_llm
from app.schemas import (
    AuthProvidersResponse,
    AuthUserResponse,
    AsrRequest,
    AsrResponse,
    ChapterManualUpdate,
    ChapterCoverageResponse,
    ChapterQualityResponse,
    EditApplyRequest,
    EditPreviewResponse,
    EditRequest,
    InterviewAnswerRequest,
    InterviewAssistantRequest,
    InterviewAssistantResponse,
    InterviewMessageSchema,
    LoginRequest,
    LoginResponse,
    NextChapterRequest,
    OutlineInterviewAnswerRequest,
    OutlineInterviewState,
    PlanRequest,
    ProjectCreate,
    ProjectDetail,
    ProjectUpdate,
    PublishedProject,
    PublishReadinessResponse,
    PublishResponse,
    RevisionSchema,
    TtsRequest,
    WriteReadinessResponse,
)
from app.services import (
    chapter_service,
    asr_service,
    book_refine_service,
    interview_service,
    outline_interview_service,
    project_service,
    publish_service,
    tts_service,
)
from app.services.book_pdf import BookPdfDependencyError
from app.services import wechat_auth
from app.services.patch import unified_diff

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Auth ────────────────────────────────────────────

@router.get("/auth/providers", response_model=AuthProvidersResponse)
async def auth_providers():
    return AuthProvidersResponse(
        wechat_enabled=settings.wechat_login_enabled,
        password_enabled=bool(settings.access_password),
        auth_required=not settings.dev_auth_bypass,
        dev_auth_bypass=settings.dev_auth_bypass,
        wechat_redirect_uri=settings.resolved_wechat_redirect_uri,
        wechat_issues=settings.wechat_configuration_issues,
    )


@router.post("/auth/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Local administrator fallback for development and legacy data."""
    import secrets

    if not settings.access_password:
        raise HTTPException(status_code=400, detail="未配置 ACCESS_PASSWORD，请联系管理员")

    if not secrets.compare_digest(body.password, settings.access_password):
        logger.warning("Login failed: incorrect password")
        raise HTTPException(status_code=401, detail="密码错误")
    user = await get_or_create_local_user(db)
    token = await create_session(db, user)
    await db.commit()
    set_session_cookie(response, token)
    logger.info("Local login successful user=%s", user.id)
    return LoginResponse(user=AuthUserResponse.model_validate(user), message="登录成功")


@router.get("/auth/me", response_model=AuthUserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/auth/logout", status_code=204)
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    await revoke_current_session(request, db)
    clear_session_cookie(response)


@router.get("/auth/wechat/start")
async def wechat_login_start(
    next_path: str = Query("/", alias="next"),
    db: AsyncSession = Depends(get_db),
):
    if not settings.wechat_login_enabled:
        raise HTTPException(status_code=503, detail="微信登录尚未配置")
    state = await create_oauth_state(db, next_path)
    await db.commit()
    response = RedirectResponse(wechat_auth.build_authorize_url(state), status_code=307)
    response.set_cookie(
        key=settings.oauth_state_cookie_name,
        value=state,
        max_age=settings.oauth_state_ttl_minutes * 60,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
        path="/",
    )
    return response


def _frontend_auth_redirect(next_path: str, error: str | None = None) -> str:
    target = f"{settings.frontend_url.rstrip('/')}{normalize_next_path(next_path)}"
    if error:
        separator = "&" if "?" in target else "?"
        target = f"{target}{separator}{urlencode({'auth_error': error})}"
    return target


@router.get("/auth/wechat/callback")
async def wechat_login_callback(
    request: Request,
    code: str = "",
    state: str = "",
    db: AsyncSession = Depends(get_db),
):
    try:
        cookie_state = request.cookies.get(settings.oauth_state_cookie_name, "")
        if not cookie_state or not secrets.compare_digest(cookie_state, state):
            raise ValueError("登录请求已失效，请重新扫码")
        next_path = await consume_oauth_state(db, state)
        await db.commit()
        if not code:
            raise ValueError("微信未返回授权码，请重新扫码")
        token_payload = await wechat_auth.exchange_code(code)
        profile = await wechat_auth.fetch_userinfo(
            str(token_payload["access_token"]),
            str(token_payload["openid"]),
        )
        if token_payload.get("unionid") and not profile.get("unionid"):
            profile["unionid"] = token_payload["unionid"]
        user = await wechat_auth.upsert_wechat_user(db, profile)
        session_token = await create_session(db, user)
        await db.commit()
    except Exception as exc:
        logger.warning("WeChat login failed: %s", exc)
        await db.rollback()
        response = RedirectResponse(
            _frontend_auth_redirect("/", "微信登录失败，请重新扫码"),
            status_code=307,
        )
        response.delete_cookie(
            key=settings.oauth_state_cookie_name,
            path="/",
            secure=settings.session_cookie_secure,
            samesite=settings.session_cookie_samesite,
        )
        return response

    response = RedirectResponse(_frontend_auth_redirect(next_path), status_code=307)
    set_session_cookie(response, session_token)
    response.delete_cookie(
        key=settings.oauth_state_cookie_name,
        path="/",
        secure=settings.session_cookie_secure,
        samesite=settings.session_cookie_samesite,
    )
    return response


# ── Projects ────────────────────────────────────────

@router.post("/projects", response_model=ProjectDetail)
async def create_project(
    body: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await project_service.create_project(
        db, current_user, body.title, body.style_notes, body.preference_notes
    )
    return await project_service.get_project(db, project.id, current_user.id)


@router.get("/projects", response_model=list[ProjectDetail])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await project_service.list_projects(db, current_user.id)


@router.get("/projects/{project_id}", response_model=ProjectDetail)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    logger.warning("Delete project id=%s", project_id)
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    await project_service.delete_project(db, project)
    logger.warning("Delete project id=%s title=%s — done", project_id, project.title)


@router.patch("/projects/{project_id}", response_model=ProjectDetail)
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    await project_service.update_project(
        db,
        project,
        body.title,
        body.style_notes,
        body.preference_notes,
        body.memory_notes,
    )
    return await project_service.get_project(db, project_id, current_user.id)


@router.post("/projects/{project_id}/plan", response_model=ProjectDetail)
async def plan_project(
    project_id: str,
    body: PlanRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    logger.info("Plan project %s — author_background length=%d", project_id, len(body.author_background))
    rate_limit_llm(request)
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    if project.chapters:
        return project
    planning_context = outline_interview_service.planning_context(project)
    author_background = body.author_background.strip() or planning_context
    if not author_background:
        raise HTTPException(status_code=400, detail="请先完成几轮人生梳理采访")
    previous_status = project.status
    claimed = await project_service.claim_chapter_generation(db, project_id, current_user.id)
    if not claimed:
        raise HTTPException(status_code=409, detail="第一章正在确定，请稍候")
    project = await project_service.get_project(db, project_id, current_user.id)
    try:
        await project_service.create_next_project_chapter(
            db,
            project,
            author_background,
        )
    except BaseException:
        await db.rollback()
        await project_service.release_chapter_generation(
            db, project_id, current_user.id, previous_status
        )
        raise
    logger.info("Plan first chapter for project %s — done", project_id)
    return await project_service.get_project(db, project_id, current_user.id)


@router.post("/projects/{project_id}/chapters/next", response_model=ProjectDetail)
async def create_next_chapter(
    project_id: str,
    body: NextChapterRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit_llm(request)
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    if not project.chapters:
        raise HTTPException(status_code=409, detail="请先完成人生梳理采访并开始第一章")
    if any(chapter.status != ChapterStatus.DONE for chapter in project.chapters):
        raise HTTPException(status_code=409, detail="请先完成当前章节，再确定下一章")

    previous_status = project.status
    claimed = await project_service.claim_chapter_generation(db, project_id, current_user.id)
    if not claimed:
        raise HTTPException(status_code=409, detail="下一章正在整理，请稍候")
    project = await project_service.get_project(db, project_id, current_user.id)
    try:
        await project_service.create_next_project_chapter(
            db,
            project,
            outline_interview_service.planning_context(project),
            body.direction,
        )
    except BaseException:
        await db.rollback()
        await project_service.release_chapter_generation(
            db, project_id, current_user.id, previous_status
        )
        raise
    return await project_service.get_project(db, project_id, current_user.id)


@router.post(
    "/projects/{project_id}/outline-interview/start",
    response_model=OutlineInterviewState,
)
async def start_outline_interview(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return await outline_interview_service.start(db, project)


@router.post(
    "/projects/{project_id}/outline-interview/answer",
    response_model=OutlineInterviewState,
)
async def answer_outline_interview(
    project_id: str,
    body: OutlineInterviewAnswerRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit_llm(request)
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    if project.chapters:
        raise HTTPException(status_code=409, detail="第一章已经开始")
    return await outline_interview_service.answer(db, project, body.content)


@router.get("/projects/{project_id}/chapters")
async def get_project_chapters(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return await chapter_service.list_chapters(db, project_id, current_user.id)


@router.get("/chapters/{chapter_id}")
async def get_chapter(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    return chapter


@router.patch("/chapters/{chapter_id}")
async def manual_update_chapter(
    chapter_id: str,
    body: ChapterManualUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    updated = await chapter_service.manual_update_chapter(db, chapter, body.content_md)
    return updated


@router.post("/chapters/{chapter_id}/interview/start")
async def start_interview(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    logger.info("Start interview chapter=%s", chapter_id)
    rate_limit_llm(request)
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    result = await interview_service.generate_interview_question(db, chapter)
    logger.info("Start interview chapter=%s — suggested_action=%s", chapter_id, result.get("suggested_action"))
    return result


@router.get("/chapters/{chapter_id}/interview/messages", response_model=list[InterviewMessageSchema])
async def get_interview_messages(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
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
    current_user: User = Depends(get_current_user),
):
    logger.info("Interview answer chapter=%s answer_len=%d", chapter_id, len(body.content))
    rate_limit_llm(request)
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    result = await interview_service.submit_answer(db, chapter, body.content)
    logger.info("Interview answer chapter=%s — next suggested_action=%s", chapter_id, result.get("suggested_action"))
    return result


@router.get(
    "/chapters/{chapter_id}/interview/assistant",
    response_model=InterviewAssistantResponse,
)
async def get_interview_assistant_guidance(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit_llm(request)
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    return await interview_service.generate_assistant_guidance(db, chapter)


@router.post(
    "/chapters/{chapter_id}/interview/assistant/record",
    response_model=InterviewAssistantResponse,
)
async def record_interview_assistant_turn(
    chapter_id: str,
    body: InterviewAssistantRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit_llm(request)
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    return await interview_service.record_assistant_turn(db, chapter, body.role, body.content)


@router.get("/chapters/{chapter_id}/interview/stream")
async def stream_interview(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit_llm(request)
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
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


@router.post("/tts")
async def synthesize_tts(
    body: TtsRequest,
    request: Request,
    _: User = Depends(get_current_user),
):
    rate_limit_llm(request)
    try:
        audio = await tts_service.synthesize_speech(body.text)
    except tts_service.TTSConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("TTS synthesis failed: %s", exc)
        raise HTTPException(status_code=502, detail="语音合成服务暂时不可用") from exc

    response = Response(content=audio, media_type="audio/mpeg")
    response.headers["Cache-Control"] = "no-store"
    return response


@router.post("/asr", response_model=AsrResponse)
async def transcribe_asr(
    body: AsrRequest,
    request: Request,
    _: User = Depends(get_current_user),
):
    rate_limit_llm(request)
    try:
        audio = asr_service.decode_audio_base64(body.audio_base64)
        text = await asr_service.transcribe_audio_bytes(audio, body.mime_type)
    except asr_service.ASRConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("ASR transcription failed: %s", exc)
        raise HTTPException(status_code=502, detail="语音识别服务暂时不可用") from exc

    return AsrResponse(text=text)


@router.post("/chapters/{chapter_id}/write")
async def write_chapter(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    logger.info("Write chapter (non-stream) chapter=%s", chapter_id)
    rate_limit_llm(request)
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    try:
        updated = await chapter_service.write_chapter_content(db, chapter)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    logger.info("Write chapter chapter=%s — done, content_len=%d", chapter_id, len(updated.content_md or ""))
    return updated


@router.get("/chapters/{chapter_id}/write/readiness", response_model=WriteReadinessResponse)
async def get_write_readiness(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    messages = await chapter_service.get_interview_messages(db, chapter)
    return chapter_service.write_readiness(messages)


@router.get("/chapters/{chapter_id}/coverage", response_model=ChapterCoverageResponse)
async def get_chapter_coverage(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    messages = await chapter_service.get_interview_messages(db, chapter)
    return chapter_service.chapter_coverage(messages)


@router.get("/chapters/{chapter_id}/quality", response_model=ChapterQualityResponse)
async def get_chapter_quality(
    chapter_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    project = await project_service.get_project(db, chapter.project_id, current_user.id)
    messages = await chapter_service.get_interview_messages(db, chapter)
    return chapter_service.chapter_quality_report(
        chapter.content_md,
        messages,
        project.style_notes if project else None,
        project.preference_notes if project else None,
        project.memory_notes if project else None,
    )


@router.post("/chapters/{chapter_id}/refine/publish-level")
async def refine_chapter_to_publish_level(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit_llm(request)
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    project = await project_service.get_project(db, chapter.project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    try:
        return await book_refine_service.refine_chapter_to_publish_level(db, project, chapter)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/chapters/{chapter_id}/write/stream")
async def stream_write_chapter(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    logger.info("Write chapter (SSE stream) chapter=%s", chapter_id)
    rate_limit_llm(request)
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")

    async def event_generator() -> AsyncGenerator[dict, None]:
        token_count = 0

        try:
            async for token in chapter_service.stream_write_chapter_content(db, chapter):
                token_count += 1
                yield {"event": "token", "data": json.dumps({"text": token}, ensure_ascii=False)}
            logger.info("SSE write done chapter=%s tokens=%d", chapter_id, token_count)
            refreshed = await chapter_service.get_chapter(db, chapter_id, current_user.id)
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
    current_user: User = Depends(get_current_user),
):
    logger.info("Preview edit chapter=%s instruction_len=%d", chapter_id, len(body.instruction))
    rate_limit_llm(request)
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
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
    current_user: User = Depends(get_current_user),
):
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
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
    current_user: User = Depends(get_current_user),
):
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
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
    current_user: User = Depends(get_current_user),
):
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")
    return await chapter_service.list_revisions(db, chapter_id)


@router.post("/projects/{project_id}/publish", response_model=PublishResponse)
async def publish_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await project_service.get_project(db, project_id, current_user.id)
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


@router.get("/projects/{project_id}/publish/readiness", response_model=PublishReadinessResponse)
async def get_publish_readiness(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return await publish_service.publish_readiness(db, project)


@router.post("/projects/{project_id}/refine/publish-level")
async def refine_project_to_publish_level(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit_llm(request)
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    try:
        return await book_refine_service.refine_project_to_publish_level(db, project)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/projects/{project_id}/export/pdf")
async def export_project_pdf(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit_llm(request)
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    try:
        pdf_bytes, filename = await publish_service.export_project_pdf(db, project)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except BookPdfDependencyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
        "Cache-Control": "no-store",
    }
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)


@router.post("/projects/{project_id}/unpublish", response_model=ProjectDetail)
async def unpublish_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await project_service.get_project(db, project_id, current_user.id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    await publish_service.unpublish_project(db, project)
    return await project_service.get_project(db, project_id, current_user.id)


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
    current_user: User = Depends(get_current_user),
):
    project = await project_service.get_project(db, project_id, current_user.id)
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
    current_user: User = Depends(get_current_user),
):
    chapter = await chapter_service.get_chapter(db, chapter_id, current_user.id)
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
    current_user: User = Depends(get_current_user),
):
    from app.agents.orchestra import orchestra

    project = await project_service.get_project(db, project_id, current_user.id)
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
