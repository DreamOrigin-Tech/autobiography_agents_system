import pytest

from app.db.session import async_session, init_db
from app.agents.memory import memory
from app.models import Chapter, ChapterStatus, User
from app.services import chapter_service, interview_service, project_service, publish_service


async def create_test_project(db, title: str, style_notes: str, **kwargs):
    user = User(name=f"{title}用户", auth_provider="wechat")
    db.add(user)
    await db.flush()
    return await project_service.create_project(db, user, title, style_notes, **kwargs)


def test_learn_preference_from_answer_records_explicit_preferences():
    notes = memory.learn_preference_from_answer(
        "这段经历可以写，但我希望语气朴素一点，不要太煽情。另一个普通事实不用记。"
    )

    assert notes is not None
    assert "我希望语气朴素一点，不要太煽情" in notes
    assert "普通事实" not in notes


def test_preference_context_combines_style_user_preferences_and_memory():
    context = memory.preference_context(
        "第一人称",
        "不要写真实姓名",
        "- 我喜欢按时间线讲",
    )

    assert "写作风格：第一人称" in context
    assert "用户明确偏好：不要写真实姓名" in context
    assert "Agent 已学习到的偏好和长期记忆：- 我喜欢按时间线讲" in context


def test_forbidden_terms_are_redacted_from_generated_content():
    assert memory.forbidden_terms(preference_notes="不要写张三，别提到李四") == ["张三", "李四"]

    redacted = memory.redact_forbidden_content(
        "那一年，张三和李四都在场。",
        preference_notes="不要写张三，别提到李四",
    )

    assert "张三" not in redacted
    assert "李四" not in redacted
    assert redacted.count("[已按隐私偏好省略]") == 2


def test_ai_draft_requires_enough_interview_material():
    short_messages = [
        {"role": "agent", "content": "请讲讲童年。"},
        {"role": "user", "content": "我小时候住在平房。"},
    ]
    enough_messages = [
        {"role": "agent", "content": "请讲讲童年。"},
        {"role": "user", "content": "我小时候住在抚顺矿区的平房里，冬天火炕很热，母亲会把冻梨放在窗台上。"},
        {"role": "agent", "content": "还有什么细节？"},
        {
            "role": "user",
            "content": (
                "父亲在矿上倒班，家里常有煤灰味。邻居之间来往很多，谁家炖菜整条巷子都闻得到，"
                "我最记得这些寻常日子。冬天放学后我们会在巷子里抽冰尜、踢毽子，玩到帽子上都是霜，"
                "回屋一坐到火炕上，整个人才慢慢缓过来。"
            ),
        },
    ]

    assert chapter_service.has_enough_material_for_ai_draft(short_messages) is False
    assert chapter_service.has_enough_material_for_ai_draft(enough_messages) is True
    with pytest.raises(ValueError, match="采访素材还不够"):
        chapter_service.ensure_enough_material_for_ai_draft(short_messages)


def test_answer_quality_detects_shallow_and_substantive_answers():
    shallow = memory.answer_quality("挺好的，印象很深。")
    substantive = memory.answer_quality(
        "小学时我在矿区子弟学校读书，刘老师常让我把作文里的煤车、教室和同学写具体，"
        "这让我后来慢慢喜欢上语文，也影响了我选择师范。"
    )

    assert shallow["is_substantive"] is False
    assert "地点" in shallow["missing_dimensions"]
    assert substantive["is_substantive"] is True
    assert substantive["score"] >= 2


def test_chapter_coverage_reports_missing_dimensions():
    coverage = chapter_service.chapter_coverage([
        {"role": "agent", "content": "请讲讲求学。"},
        {"role": "user", "content": "小学时我在矿区学校读书，刘老师常让我写作文。"},
    ])

    assert coverage["score"] >= 2
    assert coverage["max_score"] == 5
    assert "感受/影响" in coverage["missing_dimensions"]
    assert "下一轮" in coverage["next_suggestion"] or "请继续" in coverage["next_suggestion"]


def test_chapter_quality_report_flags_privacy_and_invention_risks():
    messages = [
        {"role": "agent", "content": "请讲讲求学。"},
        {
            "role": "user",
            "content": (
                "小学时我在矿区学校读书，刘老师常让我写作文。"
                "那时教室窗户结冰，我觉得语文课很温暖。"
            ),
        },
    ]
    content = (
        "小学时我在矿区学校读书，刘老师常让我写作文。那时教室窗户结冰，语文课让我觉得温暖。"
        "张三后来带我去了很多采访里没有提到的地方，又发生了许多未经确认的事情。" * 12
    )

    report = chapter_service.chapter_quality_report(
        content,
        messages,
        preference_notes="不要写张三",
    )

    assert report["score"] < report["max_score"]
    assert report["status"] in {"needs_review", "risky"}
    assert any(check["name"] == "隐私与禁忌" and check["passed"] is False for check in report["checks"])
    assert any("未经确认" in item or "过长" in item for item in report["risks"])


def test_chapter_quality_report_recognizes_material_anchors():
    messages = [
        {"role": "agent", "content": "请讲讲求学。"},
        {
            "role": "user",
            "content": "小学时我在矿区学校读书，刘老师常让我把煤车和教室写进作文。",
        },
        {
            "role": "user",
            "content": "那时窗户会结冰，我觉得语文课很温暖，也影响了我后来选择师范。",
        },
    ]
    content = (
        "小学时，我在矿区学校读书。刘老师常提醒我，把煤车经过时的声音、结冰的窗户、"
        "教室里的光都写进作文。那些语文课让我觉得温暖，也影响了我后来选择师范。"
    )

    report = chapter_service.chapter_quality_report(content, messages)
    material_check = next(check for check in report["checks"] if check["name"] == "采访素材使用")

    assert material_check["passed"] is True


@pytest.mark.asyncio
async def test_submit_answer_reports_memory_update(monkeypatch):
    await init_db()

    async def fake_generate_question(*_args, **_kwargs):
        return {
            "question": "还有哪个细节最值得保留？",
            "intent": "追问细节",
            "suggested_action": "continue",
            "reason": "test",
        }

    monkeypatch.setattr(interview_service, "generate_question", fake_generate_question)

    async with async_session() as db:
        project = await create_test_project(db, "记忆测试", "第一人称")
        chapter = Chapter(
            project_id=project.id,
            order=1,
            title="童年",
            interview_topics='["家庭"]',
        )
        db.add(chapter)
        await db.commit()
        await db.refresh(chapter)

        result = await interview_service.submit_answer(
            db,
            chapter,
            "这段可以写，但我希望语气朴素一点，不要太煽情。",
        )

    assert result["memory_updated"] is True
    assert "我希望语气朴素一点，不要太煽情" in result["memory_notes"]


@pytest.mark.asyncio
async def test_submit_answer_asks_for_details_when_answer_is_shallow(monkeypatch):
    await init_db()
    llm_called = False

    async def fake_generate_question(*_args, **_kwargs):
        nonlocal llm_called
        llm_called = True
        return {
            "question": "这条问题不应该出现",
            "intent": "追问细节",
            "suggested_action": "continue",
            "reason": "test",
        }

    monkeypatch.setattr(interview_service, "generate_question", fake_generate_question)

    async with async_session() as db:
        project = await create_test_project(db, "追问测试", "第一人称")
        chapter = Chapter(
            project_id=project.id,
            order=1,
            title="求学路",
            interview_topics='["老师和同学"]',
        )
        db.add(chapter)
        await db.commit()
        await db.refresh(chapter)

        result = await interview_service.submit_answer(db, chapter, "挺好的，印象很深。")
        session = await interview_service.get_or_create_session(db, project, chapter)
        messages = await interview_service.get_session_messages(db, session.id)

    assert llm_called is False
    assert result["intent"] == "追问细节"
    assert result["answer_quality"]["is_substantive"] is False
    assert "您刚才提到" in result["question"]
    assert result["question"].count("？") == 1
    assert "能补充一下" not in result["question"]
    assert messages[-1].role == "agent"
    assert messages[-1].content == result["question"]


def test_detail_followup_respects_a_request_to_skip():
    question = memory.detail_followup_question(
        "这段我不太方便说，先跳过吧。",
        "家庭生活",
        ["亲子关系"],
    )

    assert question.startswith("没关系，这段我们先放下")
    assert "更愿意" in question
    assert question.count("？") == 1


def test_detail_followup_helps_recall_without_demanding_exact_facts():
    question = memory.detail_followup_question(
        "时间我已经记不清了。",
        "童年",
        ["家庭环境"],
    )

    assert "记不清也很正常" in question
    assert "一个人、一个地方，还是一句话" in question
    assert question.count("？") == 1


@pytest.mark.asyncio
async def test_next_question_receives_chapter_coverage_context(monkeypatch):
    await init_db()
    captured: dict[str, str | None] = {}

    async def fake_generate_question(
        _chapter_title,
        _topics,
        _messages,
        _summaries,
        _preference_context=None,
        coverage_context=None,
    ):
        captured["coverage_context"] = coverage_context
        return {
            "question": "你能补充一下当时的感受吗？",
            "intent": "探索情感",
            "suggested_action": "continue",
            "reason": "test",
        }

    monkeypatch.setattr(interview_service, "generate_question", fake_generate_question)

    async with async_session() as db:
        project = await create_test_project(db, "完成度驱动测试", "第一人称")
        chapter = Chapter(
            project_id=project.id,
            order=1,
            title="求学路",
            interview_topics='["老师和同学"]',
        )
        db.add(chapter)
        await db.commit()
        await db.refresh(chapter)

        session = await interview_service.get_or_create_session(db, project, chapter)
        await interview_service.add_message(
            db,
            session,
            "user",
            "小学时我在矿区学校读书，刘老师常让我写作文。",
        )

        result = await interview_service.generate_interview_question(db, chapter)

    assert result["question"] == "你能补充一下当时的感受吗？"
    assert captured["coverage_context"] is not None
    assert "缺失维度" in captured["coverage_context"]
    assert "感受/影响" in captured["coverage_context"]


@pytest.mark.asyncio
async def test_publish_readiness_counts_risky_chapters():
    await init_db()

    async with async_session() as db:
        project = await create_test_project(
            db,
            "发布风险测试",
            "第一人称",
            preference_notes="不要写张三",
        )
        chapter = Chapter(
            project_id=project.id,
            order=1,
            title="童年",
            status=ChapterStatus.DONE,
            content_md="张三出现在这一章里。" * 20,
            summary="风险章节",
        )
        db.add(chapter)
        await db.commit()
        await db.refresh(project)

        readiness = await publish_service.publish_readiness(db, project)

    assert readiness["ready"] is False
    assert readiness["publishable_chapter_count"] == 1
    assert readiness["risky_chapter_count"] == 1
    assert readiness["chapters"][0]["quality_status"] == "risky"


@pytest.mark.asyncio
async def test_preview_edit_redacts_forbidden_terms(monkeypatch):
    await init_db()

    async def fake_generate_edit(*_args, **_kwargs):
        return [], "这一段提到了张三。", ""

    monkeypatch.setattr(chapter_service, "generate_edit", fake_generate_edit)

    async with async_session() as db:
        project = await create_test_project(
            db,
            "编辑隐私测试",
            "第一人称",
            preference_notes="不要写张三",
        )
        chapter = Chapter(
            project_id=project.id,
            order=1,
            title="工作",
            content_md="这一段没有隐私。",
            interview_topics='["工作"]',
        )
        db.add(chapter)
        await db.commit()
        await db.refresh(chapter)

        revision = await chapter_service.preview_edit(db, chapter, "补充人物")

    assert "张三" not in revision.content_after
    assert "[已按隐私偏好省略]" in revision.content_after
