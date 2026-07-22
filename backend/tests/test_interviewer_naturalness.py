import pytest

from app.agents import interviewer


def test_natural_fallback_follows_the_last_answer_and_asks_one_question():
    question = interviewer._natural_fallback_question(
        "童年",
        ["家庭环境"],
        [{"role": "user", "content": "我最记得冬天窗台上的冻梨。"}],
    )

    assert "冻梨" in question
    assert question.count("？") == 1


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
