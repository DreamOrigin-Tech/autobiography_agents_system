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
    long_answer = (
        "我小时候住在抚顺矿区的平房里，冬天火炕很热，窗户上有冰花，母亲会把冻梨放在窗台上。"
        "父亲在矿上倒班，夜班回来时脸上总有煤灰，他不太说辛苦，只把饭盒放在桌上。"
        "邻居之间来往很多，谁家炖菜整条巷子都闻得到，孩子们放学后在巷子里抽冰尜、踢毽子。"
        "我记得煤炉上的水壶声、墙角挂着的工作服、门口沾着雪泥的棉鞋，也记得母亲把补过的衣服叠得很平整。"
        "这些日常后来让我理解普通人的生活尊严：不是把童年写成苦难展示，而是写出人在有限条件里保留秩序、骄傲和温柔。"
        "如果写成自传章节，我希望保留这种普通感，让读者看见一个人如何从日常里长出来，而不是一开始就被写成已经完成的人。"
    ) * 3
    enough_messages = [
        item
        for idx in range(12)
        for item in (
            {"role": "agent", "content": f"请讲讲第 {idx + 1} 个具体画面。"},
            {"role": "user", "content": f"第 {idx + 1} 个画面里，{long_answer}"},
        )
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


def test_topic_coverage_matches_question_anchors_not_full_sentences():
    topics = [
        "请描述你第一次意识到自己被收养的情境，以及保罗和克拉拉如何解释这件事。",
        "在车库的工作台上，你父亲是如何教你‘即使看不见的部分也要做好’的？",
        "你最早对电子学产生兴趣是在什么时候？当时你身边有哪些早期硅谷工程师邻居？",
    ]
    messages = [
        {
            "role": "user",
            "content": (
                "我六七岁时知道自己是被收养的，后来去问 Paul 和 Clara。"
                "Paul 在车库里教我做柜子，背面看不见也要做好。"
                "附近有 HP 工程师，硅谷的电子学空气让我觉得机器可以被拆开。"
            ),
        }
    ]

    coverage = memory.topic_coverage_summary(topics, messages)

    assert coverage["topics"][0]["status"] != "untouched"
    assert coverage["topics"][1]["status"] == "covered"
    assert coverage["topics"][2]["status"] == "covered"


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


@pytest.mark.asyncio
async def test_submit_answer_treats_test_phrase_as_meta_input(monkeypatch):
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

        result = await interview_service.submit_answer(
            db,
            chapter,
            "你好，我们来试一下新的千问语音模型。",
        )
        session = await interview_service.get_or_create_session(db, project, chapter)
        messages = await interview_service.get_session_messages(db, session.id)

    assert llm_called is False
    assert result["intent"] == "追问细节"
    assert "先不算正式采访" in result["question"]
    assert "具体画面" in result["question"]
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


def test_detail_followup_handles_test_or_greeting_text():
    question = memory.detail_followup_question(
        "你好，我们来试一下新的千问语音模型。",
        "童年",
        ["家庭环境"],
    )

    assert "先不算正式采访" in question
    assert "具体画面" in question
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
