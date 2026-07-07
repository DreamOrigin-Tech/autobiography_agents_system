"""
Planning Module — outline creation + dynamic adjustment.

Architecture role:
  create_plan()      — initial chapter outline from author background
  adjust_plan()      — suggest adding / splitting / merging chapters
  suggest_next_action() — given project state, recommend what to do next
"""

import json

from app.schemas import OutlineChapterPlan, OutlinePlanResult
from app.services.llm import llm_complete_json

PLANNER_SYSTEM = """你是一位专业的自传策划编辑。你的核心任务是根据作者提供的个人背景，为其量身定制独一无二的章节大纲。

关键要求：
- 章节标题和采访话题必须紧扣作者背景中的具体经历、职业、年龄段
- 如果作者提到具体职业（如教师、医生、工程师），章节应体现其职业特点
- 如果作者提到特定年代经历（如文革、改革开放），应作为章节背景
- 如果作者提到特定地域（如东北、上海、农村），应融入地域特色
- 严禁生成泛泛的通用章节（如"童年记忆""求学之路""人生感悟"）
- 每章的 interview_topics 应该是针对该作者才会被问到的问题

输出 JSON 格式：
{
  "chapters": [
    {
      "order": 1,
      "title": "具体的、个性化的章节标题",
      "interview_topics": ["针对该作者的具体问题1", "具体问题2", "具体问题3"]
    }
  ]
}
要求：
- 章节 5-8 个，按时间或主题递进
- 每章 3-5 个采访话题
- 使用中文
"""

async def create_plan(title: str, author_background: str, style_notes: str | None) -> OutlinePlanResult:
    """Generate initial chapter outline."""
    user_content = f"""自传标题：{title}

【作者背景】
{author_background or '未提供'}

【风格偏好】
{style_notes or '真实、温情、第一人称'}

请严格依据上述作者背景，为这位作者规划专属的章节大纲。每一章的标题和采访话题都应能看出是基于该作者的具体经历。"""

    data = await llm_complete_json(
        [
            {"role": "system", "content": PLANNER_SYSTEM},
            {"role": "user", "content": user_content},
        ],
        temperature=0.7,
    )
    return OutlinePlanResult.model_validate(data)


def create_plan_fallback(title: str) -> OutlinePlanResult:
    """Hardcoded fallback outline when LLM is unavailable."""
    _ = title
    return OutlinePlanResult(
        chapters=[
            OutlineChapterPlan(
                order=1, title="童年记忆",
                interview_topics=["最早的记忆", "家庭环境", "童年玩伴", "影响最深的人"],
            ),
            OutlineChapterPlan(
                order=2, title="求学之路",
                interview_topics=["求学经历", "重要老师", "转折点", "青春梦想"],
            ),
            OutlineChapterPlan(
                order=3, title="初入社会",
                interview_topics=["第一份工作", "遇到的困难", "成长收获", "重要决定"],
            ),
            OutlineChapterPlan(
                order=4, title="事业篇章",
                interview_topics=["职业高光", "失败与挫折", "关键人物", "成就与遗憾"],
            ),
            OutlineChapterPlan(
                order=5, title="家庭与情感",
                interview_topics=["爱情故事", "亲子关系", "家庭变化", "情感感悟"],
            ),
            OutlineChapterPlan(
                order=6, title="人生感悟",
                interview_topics=["价值观", "给后辈的话", "未完成的梦", "最想留下的话"],
            ),
        ]
    )


async def suggest_next_action(
    project_status: str,
    chapters_status: list[dict],
) -> dict:
    """Suggest the next action for the user based on project state."""
    pending = sum(1 for c in chapters_status if c["status"] == "pending")
    interviewing = sum(1 for c in chapters_status if c["status"] == "interviewing")
    drafting = sum(1 for c in chapters_status if c["status"] == "drafting")
    done = sum(1 for c in chapters_status if c["status"] == "done")

    if project_status == "planning" and pending == len(chapters_status):
        return {
            "action": "start_interview",
            "message": "大纲已生成，选择一个章节开始采访吧",
            "priority": "high",
        }

    if pending > 0 and interviewing == 0 and drafting == 0:
        return {
            "action": "start_interview",
            "message": f"还有 {pending} 个章节待采访，继续推进",
            "priority": "high",
        }

    if interviewing > 0:
        return {
            "action": "continue_interview",
            "message": f"当前章节采访进行中",
            "priority": "high",
        }

    if drafting > 0:
        return {
            "action": "wait_for_writing",
            "message": "AI 正在撰写中...",
            "priority": "medium",
        }

    if done > 0 and pending == 0 and interviewing == 0:
        return {
            "action": "review_or_publish",
            "message": f"所有 {done} 章已完成，可以审阅并发布",
            "priority": "medium",
        }

    return {
        "action": "continue",
        "message": "继续你的自传之旅",
        "priority": "low",
    }


def topics_to_text(topics: list[str]) -> str:
    return json.dumps(topics, ensure_ascii=False)
