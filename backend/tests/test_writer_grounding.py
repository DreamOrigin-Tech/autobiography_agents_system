import pytest

from app.agents import writer


@pytest.mark.asyncio
async def test_writer_prompt_requires_grounding_in_user_material(monkeypatch):
    captured: dict[str, object] = {}

    async def fake_llm_complete_text(messages, temperature):
        captured["messages"] = messages
        captured["temperature"] = temperature
        return "正文"

    monkeypatch.setattr(writer, "llm_complete_text", fake_llm_complete_text)

    await writer.write_chapter(
        "求学路",
        "朴素真实",
        [
            {"role": "agent", "content": "老师给你什么影响？"},
            {"role": "user", "content": "小学时我在矿区学校读书，刘老师常让我把煤车和教室写进作文。"},
        ],
        None,
        None,
        "用户明确偏好：不要写真实姓名",
    )

    messages = captured["messages"]
    assert isinstance(messages, list)
    system_prompt = messages[0]["content"]
    user_prompt = messages[1]["content"]
    assert "不要虚构新的姓名、地点、年份" in system_prompt
    assert "事实依据清单" in user_prompt
    assert "小学时我在矿区学校读书" in user_prompt
    assert "每一段都必须能在事实依据清单或采访记录中找到依据" in user_prompt


def test_user_material_bullets_only_include_user_answers():
    bullets = writer._user_material_bullets([
        {"role": "agent", "content": "这个问题不应进入事实清单。"},
        {"role": "user", "content": "这是作者亲口提供的素材。"},
    ])

    assert "作者亲口提供" in bullets
    assert "不应进入事实清单" not in bullets
