import json
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.outline_interviewer import MIN_ANSWERS, generate_next_turn, opening_message
from app.models import Project


def read_state(project: Project) -> dict:
    if project.planning_interview_json:
        try:
            raw = json.loads(project.planning_interview_json)
            messages = raw.get("messages", [])
            if isinstance(messages, list):
                return {
                    "messages": [
                        {
                            "role": str(message.get("role", "agent")),
                            "content": str(message.get("content", "")),
                        }
                        for message in messages
                        if isinstance(message, dict) and message.get("content")
                    ],
                    "ready": bool(raw.get("ready")),
                }
        except (json.JSONDecodeError, TypeError):
            pass
    return {"messages": [], "ready": False}


async def start(db: AsyncSession, project: Project) -> dict:
    state = read_state(project)
    if not state["messages"]:
        state["messages"].append({"role": "agent", "content": opening_message()})
        await _save(db, project, state)
    return response_state(state)


async def answer(db: AsyncSession, project: Project, content: str) -> dict:
    state = read_state(project)
    if not state["messages"]:
        state["messages"].append({"role": "agent", "content": opening_message()})
    if state["ready"]:
        return response_state(state)

    state["messages"].append({"role": "user", "content": content.strip()})
    result = await generate_next_turn(project.title, state["messages"])
    state["messages"].append({"role": "agent", "content": result["reply"]})
    state["ready"] = bool(result["ready"])
    await _save(db, project, state)
    return response_state(state)


def planning_context(project: Project) -> str:
    state = read_state(project)
    lines = []
    for message in state["messages"]:
        role = "策划编辑" if message["role"] == "agent" else "作者"
        lines.append(f"{role}：{message['content']}")
    return "\n".join(lines)


def response_state(state: dict) -> dict:
    answer_count = sum(1 for message in state["messages"] if message["role"] == "user")
    return {
        "messages": state["messages"],
        "ready": bool(state["ready"]),
        "answer_count": answer_count,
        "min_answers": MIN_ANSWERS,
        "can_generate": answer_count >= 2,
    }


async def _save(db: AsyncSession, project: Project, state: dict) -> None:
    project.planning_interview_json = json.dumps(state, ensure_ascii=False)
    project.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(project)
