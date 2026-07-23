import pytest

from app.agents import outline_interviewer


def test_outline_interview_opens_without_generating_chapters():
    message = outline_interviewer.opening_message()

    assert "安排章节之前" in message
    assert "哪些重要阶段" in message
    assert message.count("？") == 1


def test_outline_interview_fallback_finishes_after_five_answers():
    result = outline_interviewer.fallback_turn(5)

    assert result["ready"] is True
    assert "确定第一章" in result["reply"]
    assert "？" not in result["reply"]


@pytest.mark.asyncio
async def test_outline_interview_does_not_finish_before_minimum(monkeypatch):
    async def fake_llm(*_args, **_kwargs):
        return {"reply": "已经够了。", "ready": True, "reason": "test"}

    monkeypatch.setattr(outline_interviewer, "llm_complete_json", fake_llm)
    result = await outline_interviewer.generate_next_turn(
        "我的故事",
        [
            {"role": "agent", "content": outline_interviewer.opening_message()},
            {"role": "user", "content": "我在乡下长大。"},
        ],
    )

    assert result["ready"] is False
    assert result["reply"].endswith("？")
