import pytest

from app.agents import interview_assistant


def test_fallback_assistant_brief_stays_actionable():
    brief = interview_assistant.fallback_assistant_brief(
        "童年",
        ["家庭环境"],
        [{"role": "user", "content": "我记得父亲骑车带我去看露天电影。"}],
    )

    assert brief["next_questions"]
    assert "父亲骑车带我去看露天电影"[:10] in brief["next_questions"][0]
    assert brief["suggested_action"] == "continue"


def test_fallback_assistant_brief_uses_publish_level_material_gate():
    old_threshold_messages = [
        {"role": "user", "content": "这是一个有细节的回答。" * 25}
        for _ in range(7)
    ]
    rich_messages = [
        {"role": "user", "content": "这是一个围绕具体场景展开的长回答，有时间地点人物动作和影响。" * 45}
        for _ in range(12)
    ]

    early = interview_assistant.fallback_assistant_brief("童年", ["家庭"], old_threshold_messages)
    ready = interview_assistant.fallback_assistant_brief("童年", ["家庭"], rich_messages)

    assert early["suggested_action"] == "continue"
    assert ready["suggested_action"] == "write_chapter"


@pytest.mark.asyncio
async def test_generate_assistant_brief_filters_internal_jargon(monkeypatch):
    async def fake_llm_complete_json(*_args, **_kwargs):
        return {
            "next_questions": ["当前覆盖度不足，请补齐缺失维度？"],
            "followup_focus": ["地点"],
            "missing_facts": ["评分还不够"],
            "live_summary": "后台指标提示覆盖度不足",
            "caution": "慢一点",
            "suggested_action": "continue",
            "reason": "test",
        }

    monkeypatch.setattr(interview_assistant, "llm_complete_json", fake_llm_complete_json)

    brief = await interview_assistant.generate_assistant_brief(
        "求学路",
        ["老师"],
        [{"role": "user", "content": "刘老师鼓励我写作文。"}],
        coverage_context="完成度：1/5；缺失维度：地点",
    )

    combined = "\n".join(
        brief["next_questions"] + brief["missing_facts"] + [brief["live_summary"]]
    )
    assert "覆盖度" not in combined
    assert "缺失维度" not in combined
