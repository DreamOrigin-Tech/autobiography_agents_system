from app.agents.planning import create_next_chapter_fallback


def test_next_chapter_fallback_keeps_direction_topics_short():
    plan = create_next_chapter_fallback(
        3,
        (
            "Macintosh 的诞生、海盗旗、图形界面、字体、现实扭曲力场、与团队的冲突。"
            "章节要写出产品理想和人格阴影并存。"
        ),
    )

    assert len(plan.title) <= 32
    assert all(len(topic) < 60 for topic in plan.interview_topics)
    assert "章节要写出" not in "\n".join(plan.interview_topics)
