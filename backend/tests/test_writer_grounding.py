import pytest

from app.agents import writer
from app.services import chapter_service


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
        6,
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
    assert "630 页、42 章" in system_prompt
    assert "43 万字" in system_prompt
    assert "8000-12000" in system_prompt
    assert "12000-18000" in system_prompt
    assert "事实依据清单" in user_prompt
    assert "当前章节：第6章" in user_prompt
    assert "# 第6章 求学路" in user_prompt
    assert "小学时我在矿区学校读书" in user_prompt
    assert "每一段都必须能在事实依据清单或采访记录中找到依据" in user_prompt
    assert "普通章节目标长度为 8000-12000 个中文字符" in user_prompt
    assert "关键转折章节可写到 12000-18000 个中文字符" in user_prompt


def test_user_material_bullets_only_include_user_answers():
    bullets = writer._user_material_bullets([
        {"role": "agent", "content": "这个问题不应进入事实清单。"},
        {"role": "user", "content": "这是作者亲口提供的素材。"},
    ])

    assert "作者亲口提供" in bullets
    assert "不应进入事实清单" not in bullets


def test_short_chapter_is_risky_for_biography_length():
    messages = [
        {"role": "user", "content": "1990 年，我在矿区学校读书，刘老师常让我写作文。"},
        {"role": "user", "content": "那间教室窗户会结冰，父亲骑车送我上学，我记得煤车的声音。"},
        {"role": "user", "content": "我后来选择师范，是因为那段经历让我相信文字能照亮普通人的生活。"},
        {"role": "user", "content": "刘老师会把我的作文贴在黑板旁边，我既害羞又骄傲。"},
        {"role": "user", "content": "这件事影响了我很多年，也让我愿意回到小地方教书。"},
    ]

    report = chapter_service.chapter_quality_report("我在矿区学校读书。" * 20, messages)

    assert report["status"] == "risky"
    assert any("传记章节体量" == check["name"] for check in report["checks"])
    assert any("出版级传记章节体量" in risk for risk in report["risks"])


def test_quality_report_flags_unsupported_specific_fact_anchors():
    messages = [
        {"role": "user", "content": "我和 Woz 做过蓝盒子，它让我意识到技术也可以被包装和销售。"},
        {"role": "user", "content": "后来 Apple I 有了订单，我们开始在车库里组装机器。"},
        {"role": "user", "content": "我卖掉自己的车，Woz 卖掉计算器，才凑到一些启动资金。"},
        {"role": "user", "content": "Apple II 必须是一台完整产品，而不是一块裸露主板。"},
        {"role": "user", "content": "那段经历让我意识到，普通人需要的是可以信任的完整体验。"},
    ]
    content = (
        "我和 Woz 做过蓝盒子，它让我意识到技术也可以被包装和销售。"
        "后来 Apple I 有了订单，我们开始在车库里组装机器。"
        "我卖掉自己的车，Woz 卖掉计算器，才凑到一些启动资金。"
        "Apple II 必须是一台完整产品，而不是一块裸露主板。"
        "那段经历让我意识到，普通人需要的是可以信任的完整体验。"
        "我还记得 AT&T 系统里的 2600赫兹 声音，以及 1977年 的某次展会。"
    ) * 12

    report = chapter_service.chapter_quality_report(content, messages)

    assert report["status"] in {"needs_review", "risky"}
    assert any("事实锚点支撑" == check["name"] and not check["passed"] for check in report["checks"])
    assert any("AT&T" in suggestion or "2600" in suggestion for suggestion in report["suggestions"])
