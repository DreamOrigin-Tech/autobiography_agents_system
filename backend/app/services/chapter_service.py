import json
import logging
import re
from collections.abc import AsyncGenerator
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.editor import generate_edit
from app.agents.interviewer import parse_topics
from app.agents.memory import memory
from app.agents.writer import stream_write_chapter, summarize_chapter, write_chapter
from app.models import Chapter, ChapterStatus, Project, ProjectStatus, Revision
from app.services.patch import patches_to_json

logger = logging.getLogger(__name__)

MIN_USER_ANSWERS_FOR_AI_DRAFT = 12
MIN_USER_CHARS_FOR_AI_DRAFT = 5000
MIN_CHAPTER_CHARS_FOR_BIOGRAPHY = 8000
TARGET_CHAPTER_CHARS_LOW = 8000
TARGET_CHAPTER_CHARS_HIGH = 12000
PIVOTAL_CHAPTER_CHARS_LOW = 12000
PIVOTAL_CHAPTER_CHARS_HIGH = 18000


def _mark_project_activity(project: Project) -> None:
    project.updated_at = datetime.now(UTC)


async def get_chapter(
    db: AsyncSession,
    chapter_id: str,
    user_id: str | None = None,
) -> Chapter | None:
    query = select(Chapter).where(Chapter.id == chapter_id)
    if user_id is not None:
        query = query.join(Project, Project.id == Chapter.project_id).where(
            Project.user_id == user_id
        )
    result = await db.execute(query)
    return result.scalar_one_or_none()


async def list_chapters(
    db: AsyncSession,
    project_id: str,
    user_id: str | None = None,
) -> list[Chapter]:
    query = select(Chapter).where(Chapter.project_id == project_id)
    if user_id is not None:
        query = query.join(Project, Project.id == Chapter.project_id).where(
            Project.user_id == user_id
        )
    result = await db.execute(query.order_by(Chapter.order))
    return list(result.scalars().all())


async def get_adjacent_summaries(db: AsyncSession, chapter: Chapter) -> tuple[str | None, str | None]:
    result = await db.execute(
        select(Chapter).where(Chapter.project_id == chapter.project_id).order_by(Chapter.order)
    )
    chapters = list(result.scalars().all())
    prev_summary = None
    next_summary = None
    for i, ch in enumerate(chapters):
        if ch.id == chapter.id:
            if i > 0:
                prev_summary = chapters[i - 1].summary
            if i < len(chapters) - 1:
                next_summary = chapters[i + 1].summary
            break
    return prev_summary, next_summary


async def get_interview_messages(db: AsyncSession, chapter: Chapter) -> list[dict[str, str]]:
    from app.models import InterviewMessage, InterviewSession

    result = await db.execute(
        select(InterviewSession).where(InterviewSession.chapter_id == chapter.id).limit(1)
    )
    session = result.scalar_one_or_none()
    if not session:
        return []

    msg_result = await db.execute(
        select(InterviewMessage)
        .where(InterviewMessage.session_id == session.id)
        .order_by(InterviewMessage.created_at)
    )
    messages = msg_result.scalars().all()
    return [{"role": m.role, "content": m.content} for m in messages]


async def write_chapter_content(db: AsyncSession, chapter: Chapter) -> Chapter:
    project_result = await db.execute(
        select(Project).where(Project.id == chapter.project_id)
    )
    project = project_result.scalar_one()

    messages = await get_interview_messages(db, chapter)
    ensure_enough_material_for_ai_draft(messages)
    prev_summary, next_summary = await get_adjacent_summaries(db, chapter)
    topics = parse_topics_from_chapter(chapter)
    preference_context = memory.preference_context(
        project.style_notes,
        project.preference_notes,
        project.memory_notes,
    )

    # ── Agent: Pre-write reflection ──
    from app.agents.orchestra import orchestra

    logger.info("Write chapter start: %s — messages=%d topics=%d", chapter.title, len(messages), len(topics))
    pre_check = await orchestra.prepare_for_writing(chapter.title, topics, messages)
    if not pre_check.get("ready"):
        logger.warning(
            "Pre-write check: chapter=%s ready=%s confidence=%.2f — proceeding anyway",
            chapter.title, pre_check.get("ready"), pre_check.get("confidence", 0),
        )
    else:
        logger.info("Pre-write check: chapter=%s ready=True confidence=%.2f", chapter.title, pre_check.get("confidence", 0))

    chapter.status = ChapterStatus.DRAFTING
    project.status = ProjectStatus.WRITING
    _mark_project_activity(project)
    await db.commit()

    content = await write_chapter(
        chapter.title,
        chapter.order,
        project.style_notes,
        messages,
        prev_summary,
        next_summary,
        preference_context,
    )
    content = memory.redact_forbidden_content(
        content,
        project.style_notes,
        project.preference_notes,
        project.memory_notes,
    )
    summary = await summarize_chapter(content)

    # ── Agent: Post-write reflection ──
    chapters_result = await db.execute(
        select(Chapter).where(Chapter.project_id == project.id).order_by(Chapter.order)
    )
    db_chapters = list(chapters_result.scalars().all())

    all_chapters = [
        {
            "order": c.order,
            "title": c.title,
            "content_md": content if c.id == chapter.id else (c.content_md or ""),
        }
        for c in db_chapters
    ]
    post_check = await orchestra.review_after_writing(
        chapter.title, content, messages, chapter.order, all_chapters
    )

    chapter.content_md = content
    chapter.summary = summary
    chapter.reflection_notes = post_check.get("reflection_notes")
    chapter.topic_coverage = json.dumps(pre_check.get("topic_coverage", {}), ensure_ascii=False)
    chapter.status = ChapterStatus.DONE
    project.status = ProjectStatus.REVIEWING
    _mark_project_activity(project)

    # ── Agent: Update project timeline ──
    if post_check.get("timeline_events"):
        _merge_timeline(project, post_check["timeline_events"])

    await db.commit()
    await db.refresh(chapter)

    try:
        quality = json.loads(post_check.get("reflection_notes") or "{}").get("quality_score", "?")
    except (json.JSONDecodeError, TypeError):
        quality = "?"
    logger.info(
        "Write chapter done: %s — content_len=%d quality=%s consistency_issues=%d timeline_events=%d",
        chapter.title, len(content), quality,
        len(post_check.get("consistency_issues", [])),
        len(post_check.get("timeline_events", [])),
    )
    return chapter


async def stream_write_chapter_content(
    db: AsyncSession, chapter: Chapter
) -> AsyncGenerator[str, None]:
    project_result = await db.execute(
        select(Project).where(Project.id == chapter.project_id)
    )
    project = project_result.scalar_one()

    messages = await get_interview_messages(db, chapter)
    ensure_enough_material_for_ai_draft(messages)
    prev_summary, next_summary = await get_adjacent_summaries(db, chapter)
    preference_context = memory.preference_context(
        project.style_notes,
        project.preference_notes,
        project.memory_notes,
    )

    chapter.status = ChapterStatus.DRAFTING
    project.status = ProjectStatus.WRITING
    _mark_project_activity(project)
    await db.commit()

    full_content = ""
    pending_content = ""
    forbidden_terms = memory.forbidden_terms(
        project.style_notes,
        project.preference_notes,
        project.memory_notes,
    )
    max_forbidden_len = max((len(term) for term in forbidden_terms), default=0)
    async for token in stream_write_chapter(
        chapter.title,
        chapter.order,
        project.style_notes,
        messages,
        prev_summary,
        next_summary,
        preference_context,
    ):
        full_content += token
        if not forbidden_terms:
            yield token
            continue
        pending_content += token
        if len(pending_content) > max_forbidden_len:
            safe_part = pending_content[:-max_forbidden_len]
            pending_content = pending_content[-max_forbidden_len:]
            yield memory.redact_forbidden_content(
                safe_part,
                project.style_notes,
                project.preference_notes,
                project.memory_notes,
            )

    if pending_content:
        yield memory.redact_forbidden_content(
            pending_content,
            project.style_notes,
            project.preference_notes,
            project.memory_notes,
        )

    full_content = memory.redact_forbidden_content(
        full_content,
        project.style_notes,
        project.preference_notes,
        project.memory_notes,
    )

    summary = await summarize_chapter(full_content)

    # ── Agent: Post-write reflection ──
    # Query chapters explicitly as dicts to avoid lazy-load in generator context
    from app.agents.orchestra import orchestra

    chapters_result = await db.execute(
        select(Chapter).where(Chapter.project_id == project.id).order_by(Chapter.order)
    )
    db_chapters = list(chapters_result.scalars().all())

    all_chapters = [
        {
            "order": c.order,
            "title": c.title,
            "content_md": full_content if c.id == chapter.id else (c.content_md or ""),
        }
        for c in db_chapters
    ]
    post_check = await orchestra.review_after_writing(
        chapter.title, full_content, messages, chapter.order, all_chapters
    )

    chapter.content_md = full_content
    chapter.summary = summary
    chapter.reflection_notes = post_check.get("reflection_notes")
    chapter.status = ChapterStatus.DONE
    project.status = ProjectStatus.REVIEWING
    _mark_project_activity(project)

    if post_check.get("timeline_events"):
        _merge_timeline(project, post_check["timeline_events"])

    await db.commit()


async def preview_edit(db: AsyncSession, chapter: Chapter, instruction: str) -> Revision:
    project_result = await db.execute(select(Project).where(Project.id == chapter.project_id))
    project = project_result.scalar_one()
    preference_context = memory.preference_context(
        project.style_notes,
        project.preference_notes,
        project.memory_notes,
    )
    content = chapter.content_md or ""
    patches, after, diff_text = await generate_edit(content, instruction, preference_context)
    after = memory.redact_forbidden_content(
        after,
        project.style_notes,
        project.preference_notes,
        project.memory_notes,
    )
    from app.services.patch import unified_diff
    diff_text = unified_diff(content, after)

    revision = Revision(
        chapter_id=chapter.id,
        instruction=instruction,
        diff_json=patches_to_json(patches),
        content_before=content,
        content_after=after,
        applied=False,
    )
    db.add(revision)
    _mark_project_activity(project)
    await db.commit()
    await db.refresh(revision)
    revision._diff_text = diff_text  # type: ignore[attr-defined]
    return revision


async def apply_revision(db: AsyncSession, chapter: Chapter, revision: Revision) -> Chapter:
    project = await _get_project_for_chapter(db, chapter)
    chapter.content_md = revision.content_after
    if revision.content_after:
        chapter.summary = await summarize_chapter(revision.content_after)
    revision.applied = True
    _mark_project_activity(project)
    await db.commit()
    await db.refresh(chapter)
    return chapter


async def rollback_revision(db: AsyncSession, chapter: Chapter, revision: Revision) -> Chapter:
    project = await _get_project_for_chapter(db, chapter)
    if revision.content_before is not None:
        chapter.content_md = revision.content_before
        if revision.content_before:
            chapter.summary = await summarize_chapter(revision.content_before)
    revision.applied = False
    _mark_project_activity(project)
    await db.commit()
    await db.refresh(chapter)
    return chapter


async def list_revisions(db: AsyncSession, chapter_id: str) -> list[Revision]:
    result = await db.execute(
        select(Revision).where(Revision.chapter_id == chapter_id).order_by(Revision.created_at.desc())
    )
    return list(result.scalars().all())


async def manual_update_chapter(db: AsyncSession, chapter: Chapter, content_md: str) -> Chapter:
    project = await _get_project_for_chapter(db, chapter)
    before = chapter.content_md or ""
    content_md = content_md.strip()

    revision = Revision(
        chapter_id=chapter.id,
        instruction="手动编辑",
        diff_json=patches_to_json([]),
        content_before=before,
        content_after=content_md,
        applied=True,
    )
    db.add(revision)

    chapter.content_md = content_md or None
    if content_md:
        chapter.summary = content_md[:200] + ("..." if len(content_md) > 200 else "")
        chapter.status = ChapterStatus.DONE
    _mark_project_activity(project)
    await db.commit()
    await db.refresh(chapter)
    return chapter


# ── Internal helpers ───────────────────────────────


async def _get_project_for_chapter(db: AsyncSession, chapter: Chapter) -> Project:
    project_result = await db.execute(select(Project).where(Project.id == chapter.project_id))
    return project_result.scalar_one()


def parse_topics_from_chapter(chapter: Chapter) -> list[str]:
    """Parse interview topics from a Chapter model."""
    return parse_topics(chapter.interview_topics)


def material_stats(messages: list[dict[str, str]]) -> dict[str, int]:
    """Return simple deterministic stats for interview material."""
    user_messages = [m.get("content", "") for m in messages if m.get("role") == "user"]
    return {
        "user_answers": len(user_messages),
        "user_chars": sum(len(item.strip()) for item in user_messages),
    }


def has_enough_material_for_ai_draft(messages: list[dict[str, str]]) -> bool:
    stats = material_stats(messages)
    return (
        stats["user_answers"] >= MIN_USER_ANSWERS_FOR_AI_DRAFT
        and stats["user_chars"] >= MIN_USER_CHARS_FOR_AI_DRAFT
    )


def ensure_enough_material_for_ai_draft(messages: list[dict[str, str]]) -> None:
    if has_enough_material_for_ai_draft(messages):
        return
    raise ValueError(
        write_readiness(messages)["message"]
    )


def write_readiness(messages: list[dict[str, str]]) -> dict[str, int | bool | str]:
    stats = material_stats(messages)
    ready = has_enough_material_for_ai_draft(messages)
    if ready:
        message = "采访素材已达到出版级传记章节写作门槛，可以开始生成较完整正文。"
    else:
        missing_answers = max(0, MIN_USER_ANSWERS_FOR_AI_DRAFT - stats["user_answers"])
        missing_chars = max(0, MIN_USER_CHARS_FOR_AI_DRAFT - stats["user_chars"])
        parts: list[str] = []
        if missing_answers:
            parts.append(f"还差 {missing_answers} 轮回答")
        if missing_chars:
            parts.append(f"还差约 {missing_chars} 字素材")
        message = "采访素材还不够，不建议直接写正文。" + "，".join(parts) + "。"
    return {
        "ready": ready,
        "user_answers": stats["user_answers"],
        "user_chars": stats["user_chars"],
        "min_user_answers": MIN_USER_ANSWERS_FOR_AI_DRAFT,
        "min_user_chars": MIN_USER_CHARS_FOR_AI_DRAFT,
        "message": message,
    }


def chapter_coverage(messages: list[dict[str, str]]) -> dict[str, int | str | list[str]]:
    user_text = "\n".join(
        m.get("content", "").strip() for m in messages if m.get("role") == "user"
    ).strip()
    quality = memory.answer_quality(user_text)
    dimensions = ["时间", "地点", "人物", "动作/事件", "感受/影响"]
    missing = [str(item) for item in quality.get("missing_dimensions", [])]
    covered = [item for item in dimensions if item not in missing]
    score = len(covered)
    max_score = len(dimensions)
    percent = round(score / max_score * 100)

    if score == max_score:
        message = "本章素材的关键维度已经比较完整。"
        next_suggestion = "可以继续补充最有画面感的一幕，或进入 AI 写作。"
    elif score >= 3:
        message = "本章已有可写基础，但还缺少少量关键细节。"
        next_suggestion = f"下一轮优先补充{_join_cn(missing[:2])}。"
    elif score > 0:
        message = "本章有一些素材，但还不够立体。"
        next_suggestion = f"请继续补充{_join_cn(missing[:3])}，让故事更像亲历回忆。"
    else:
        message = "本章还缺少可写的具体素材。"
        next_suggestion = "请先讲一个具体场景：什么时候、在哪里、和谁、发生了什么、当时什么感受。"

    return {
        "score": score,
        "max_score": max_score,
        "percent": percent,
        "covered_dimensions": covered,
        "missing_dimensions": missing,
        "message": message,
        "next_suggestion": next_suggestion,
    }


def _join_cn(items: list[str]) -> str:
    if not items:
        return "一个印象最深的具体场景"
    if len(items) == 1:
        return items[0]
    return "、".join(items[:-1]) + "和" + items[-1]


def chapter_quality_report(
    content: str | None,
    messages: list[dict[str, str]],
    style_notes: str | None = None,
    preference_notes: str | None = None,
    memory_notes: str | None = None,
) -> dict[str, int | str | list]:
    draft = (content or "").strip()
    user_text = "\n".join(
        m.get("content", "").strip() for m in messages if m.get("role") == "user"
    ).strip()
    source_text = "\n".join(
        item
        for item in (user_text, style_notes or "", preference_notes or "", memory_notes or "")
        if item
    )
    user_keywords = _material_anchors(user_text)
    matched_keywords = [kw for kw in user_keywords if kw and kw in draft]
    keyword_ratio = len(set(matched_keywords)) / max(1, len(set(user_keywords)))
    forbidden = [
        term for term in memory.forbidden_terms(style_notes, preference_notes, memory_notes)
        if term in draft
    ]

    checks: list[dict[str, str | bool]] = []
    risks: list[str] = []
    suggestions: list[str] = []
    score = 0

    has_draft = len(draft) >= 80
    checks.append({
        "name": "正文完整度",
        "passed": has_draft,
        "detail": "已有可读正文。" if has_draft else "正文还太短或尚未生成。",
    })
    if has_draft:
        score += 1
    else:
        suggestions.append("先生成或补写一版完整正文。")

    has_biography_length = len(draft) >= MIN_CHAPTER_CHARS_FOR_BIOGRAPHY
    checks.append({
        "name": "传记章节体量",
        "passed": has_biography_length,
        "detail": (
            f"正文约 {len(draft)} 字，已达到传记章节最低体量。"
            if has_biography_length
            else (
                f"正文约 {len(draft)} 字，低于传记章节建议最低 "
                f"{MIN_CHAPTER_CHARS_FOR_BIOGRAPHY} 字。"
            )
        ),
    })
    if has_biography_length:
        score += 1
    else:
        risks.append("正文更像短文或章节梗概，尚未达到出版级传记章节体量。")
        suggestions.append(
            f"继续采访补足 5-10 个关键场景，并扩写到普通章节约 "
            f"{TARGET_CHAPTER_CHARS_LOW}-{TARGET_CHAPTER_CHARS_HIGH} 字；"
            f"关键转折章节约 {PIVOTAL_CHAPTER_CHARS_LOW}-{PIVOTAL_CHAPTER_CHARS_HIGH} 字。"
        )

    uses_material = bool(user_text) and keyword_ratio >= 0.08
    checks.append({
        "name": "采访素材使用",
        "passed": uses_material,
        "detail": f"正文命中了约 {round(keyword_ratio * 100)}% 的采访关键词。",
    })
    if uses_material:
        score += 1
    else:
        risks.append("正文和采访素材的直接关联偏弱。")
        suggestions.append("补入采访里出现过的具体人物、地点、物件或场景。")

    respects_privacy = not forbidden
    checks.append({
        "name": "隐私与禁忌",
        "passed": respects_privacy,
        "detail": "未发现禁忌词。" if respects_privacy else "发现用户要求避免出现的词。",
    })
    if respects_privacy:
        score += 1
    else:
        risks.append("正文包含用户明确要求避免的内容。")
        suggestions.append("按偏好删除或替换敏感称呼、姓名和隐私细节。")

    unsupported_specifics = _unsupported_specifics(draft, source_text)
    facts_grounded = not unsupported_specifics
    checks.append({
        "name": "事实锚点支撑",
        "passed": facts_grounded,
        "detail": (
            "未发现明显缺少素材支撑的具体事实。"
            if facts_grounded
            else f"发现 {len(unsupported_specifics)} 个可能缺少素材支撑的具体事实。"
        ),
    })
    if facts_grounded:
        score += 1
    else:
        risks.append("正文出现采访素材或用户偏好中没有支撑的具体事实。")
        suggestions.append(
            "复核或补采这些事实锚点："
            + "、".join(unsupported_specifics[:8])
        )

    material_chars = len(user_text)
    length_ratio = len(draft) / max(1, material_chars)
    low_invention_risk = (
        material_chars >= MIN_USER_CHARS_FOR_AI_DRAFT
        and length_ratio <= 3.5
    )
    checks.append({
        "name": "编造风险",
        "passed": low_invention_risk,
        "detail": f"正文约为采访素材的 {length_ratio:.1f} 倍。",
    })
    if low_invention_risk:
        score += 1
    else:
        risks.append("正文相对采访素材过长，可能混入未经确认的推断。")
        suggestions.append("继续采访补充素材，或删去没有采访依据的细节。")

    coverage = chapter_coverage(messages)
    coverage_ok = int(coverage["score"]) >= 4
    checks.append({
        "name": "素材维度覆盖",
        "passed": coverage_ok,
        "detail": f"已覆盖 {coverage['score']}/{coverage['max_score']} 个关键维度。",
    })
    if coverage_ok:
        score += 1
    else:
        risks.append("采访素材维度还不够完整。")
        suggestions.append(str(coverage["next_suggestion"]))

    if not has_biography_length:
        status = "risky"
        message = "这版正文更像短文或章节梗概，离出版级传记章节体量还不够，建议继续采访并扩写后再定稿。"
    elif unsupported_specifics:
        status = "needs_review" if len(unsupported_specifics) <= 3 else "risky"
        message = "这版正文已有传记体量，但部分具体事实缺少素材支撑，建议复核后再定稿。"
    elif score >= 7:
        status = "good"
        message = "这版正文整体可靠，可以进入精修。"
    elif score >= 5:
        status = "needs_review"
        message = "这版正文已有基础，建议按提示补充或删改后再定稿。"
    else:
        status = "risky"
        message = "这版正文风险偏高，建议继续采访或大幅修订。"

    return {
        "score": score,
        "max_score": 7,
        "status": status,
        "checks": checks,
        "risks": risks,
        "suggestions": _dedupe_strings(suggestions),
        "message": message,
    }


def _dedupe_strings(items: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in items:
        normalized = item.strip()
        if normalized and normalized not in seen:
            result.append(normalized)
            seen.add(normalized)
    return result


def _unsupported_specifics(content: str, source_text: str) -> list[str]:
    """Find precise fact anchors in content that are absent from source material.

    This is intentionally conservative and deterministic. It catches the common
    failure mode where the model adds public-looking but uncollected details
    such as extra English names, institutions, years, counts, prices, or
    technical parameters.
    """
    if not content.strip():
        return []

    patterns = (
        r"\b[A-Z][A-Za-z0-9.+#&-]{1,}(?:\s+[A-Z][A-Za-z0-9.+#&-]{1,})*\b",
        r"\d{3,4}\s*(?:年|台|美元|赫兹|Hz|hz)?",
        r"[一二三四五六七八九十百千万]+(?:台|美元|赫兹)",
    )
    allow = {
        "AI", "API", "Markdown",
    }
    generic_quantities = {"一台", "一个", "一种", "一件", "一次"}
    anchors: list[str] = []
    seen: set[str] = set()
    for pattern in patterns:
        for match in re.finditer(pattern, content):
            anchor = match.group(0).strip()
            if (
                not anchor
                or anchor in allow
                or anchor in generic_quantities
                or _anchor_supported(anchor, source_text)
                or anchor in seen
            ):
                continue
            anchors.append(anchor)
            seen.add(anchor)
    return anchors[:20]


def _anchor_supported(anchor: str, source_text: str) -> bool:
    if anchor in source_text or anchor.lower() in source_text.lower():
        return True

    latin_parts = re.findall(r"[A-Za-z][A-Za-z0-9.+#-]*", anchor)
    if len(latin_parts) > 1 and all(part.lower() in source_text.lower() for part in latin_parts):
        return True

    digit_parts = re.findall(r"\d+", anchor)
    if digit_parts and all(part in source_text for part in digit_parts):
        return True

    chinese_number = re.match(r"^([一二三四五六七八九十百千万]+)(台|美元|赫兹)$", anchor)
    if chinese_number:
        number = _chinese_number_to_int(chinese_number.group(1))
        unit = chinese_number.group(2)
        if number is not None and (
            f"{number}{unit}" in source_text or f"{number} {unit}" in source_text
        ):
            return True

    return False


def _chinese_number_to_int(value: str) -> int | None:
    digits = {
        "零": 0,
        "一": 1,
        "二": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
    }
    units = {"十": 10, "百": 100, "千": 1000, "万": 10000}
    if not value:
        return None
    total = 0
    current = 0
    for char in value:
        if char in digits:
            current = digits[char]
            continue
        if char not in units:
            return None
        unit = units[char]
        if current == 0:
            current = 1
        total += current * unit
        current = 0
    return total + current


def _material_anchors(text: str) -> list[str]:
    anchors: list[str] = []
    for segment in memory.extract_keywords(text, min_length=2):
        segment = segment.strip()
        if not segment:
            continue
        if len(segment) <= 8:
            anchors.append(segment)
            continue
        for size in (2, 3, 4):
            for index in range(0, max(0, len(segment) - size + 1)):
                piece = segment[index:index + size]
                if _is_useful_anchor(piece):
                    anchors.append(piece)
    deduped: list[str] = []
    seen: set[str] = set()
    for anchor in anchors:
        if anchor not in seen:
            deduped.append(anchor)
            seen.add(anchor)
    return deduped[:120]


def _is_useful_anchor(value: str) -> bool:
    stopwords = {
        "时候", "一个", "这个", "那个", "后来", "当时", "觉得", "因为", "所以", "但是",
        "我们", "他们", "自己", "什么", "怎么", "可以", "没有", "常让", "让我",
    }
    return value not in stopwords and not value.isdigit()


def _merge_timeline(project: Project, new_events: list[dict]) -> None:
    """Merge new timeline events into the project's timeline JSON."""
    import json as _json

    existing: list[dict] = []
    if project.timeline_json:
        try:
            existing = _json.loads(project.timeline_json)
        except _json.JSONDecodeError:
            existing = []

    # Simple dedup by event text similarity
    existing_texts = {e.get("event", "") for e in existing}
    for event in new_events:
        if event.get("event", "") not in existing_texts:
            existing.append(event)
            existing_texts.add(event.get("event", ""))

    # Sort by chapter order
    existing.sort(key=lambda e: e.get("chapter", 0))
    project.timeline_json = _json.dumps(existing, ensure_ascii=False)
