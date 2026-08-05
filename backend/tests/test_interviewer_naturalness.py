import pytest

from app.agents import interviewer


def test_first_interview_opening_eases_into_the_topic():
    question = interviewer._opening_question("票证年代的童年光影", [])

    assert "聊家常" in question
    assert "记不清也没关系" in question
    assert "票证年代的童年光影" in question
    assert question.count("？") == 1


def test_opening_shortens_a_written_chapter_title_for_conversation():
    question = interviewer._opening_question("大院里的童年：票证、样板戏和露天电影", [])

    assert "说到大院里的童年" in question
    assert "票证、样板戏和露天电影" not in question


def test_later_chapter_opening_continues_without_repeating_greeting():
    question = interviewer._opening_question("第一次参加工作", ["童年生活摘要"])

    assert "接着" in question
    assert "正式采访" not in question
    assert question.count("？") == 1


def test_natural_fallback_follows_the_last_answer_and_asks_one_question():
    question = interviewer._natural_fallback_question(
        "童年",
        ["家庭环境"],
        [{"role": "user", "content": "我最记得冬天窗台上的冻梨。"}],
    )

    assert "冻梨" in question
    assert question.count("？") == 1


def test_normalize_interview_turn_filters_unintroduced_public_facts():
    question = interviewer._normalize_interview_turn(
        "我听说公开资料里提到过1977年的一次争执，这是最关键的一幕吗？",
        "这段如果要写清楚，还缺哪一个具体场景？",
    )

    assert question == "这段如果要写清楚，还缺哪一个具体场景？"


@pytest.mark.asyncio
async def test_generate_question_replaces_internal_metrics_with_natural_fallback(monkeypatch):
    async def fake_llm_complete_json(*_args, **_kwargs):
        return {
            "question": "当前覆盖度不足，下一轮优先补充地点？还要补充人物？",
            "intent": "追问细节",
            "suggested_action": "continue",
            "reason": "test",
        }

    monkeypatch.setattr(interviewer, "llm_complete_json", fake_llm_complete_json)

    result = await interviewer.generate_question(
        "求学路",
        ["老师和同学"],
        [{"role": "user", "content": "刘老师让我第一次喜欢上写作文。"}],
        [],
        coverage_context="完成度：1/5；缺失维度：地点、感受",
    )

    assert "覆盖度" not in result["question"]
    assert "缺失维度" not in result["question"]
    assert result["question"].count("？") == 1
