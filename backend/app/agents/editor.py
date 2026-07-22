from app.services.llm import llm_complete_json
from app.services.patch import apply_patches, number_paragraphs, unified_diff


EDITOR_SYSTEM = """你是一位精准的自传编辑。根据作者指令，对章节进行局部修改。

章节内容以段落编号形式提供，如 [P1]、[P2]。

输出 JSON：
{
  "patches": [
    {
      "paragraph_id": "P1",
      "operation": "replace|delete|insert_after|append",
      "new_text": "修改后的段落内容（delete 时可为 null）"
    }
  ],
  "explanation": "修改说明"
}

规则：
1. 优先局部修改，只改必要的段落
2. 保持第一人称自传风格
3. 若用户要求全文重写，operation 用 replace 替换所有相关段落，或 append 新内容
4. paragraph_id 必须存在于原文中（append 除外）
"""


async def generate_edit(
    content: str,
    instruction: str,
    preference_context: str | None = None,
) -> tuple[list[dict], str, str]:
    numbered, _ = number_paragraphs(content)
    user_content = f"""原文（带段落编号）：
{numbered or '（空内容）'}

用户偏好与长期记忆：
{preference_context or '（暂无）'}

修改指令：{instruction}

请生成修改 patches。"""

    try:
        data = await llm_complete_json(
            [
                {"role": "system", "content": EDITOR_SYSTEM},
                {"role": "user", "content": user_content},
            ],
            temperature=0.4,
        )
        patches = data.get("patches", [])
    except Exception:
        patches = [{"paragraph_id": "P1", "operation": "replace", "new_text": content}]

    if not patches and content:
        patches = [{"paragraph_id": "P1", "operation": "replace", "new_text": content}]

    after = apply_patches(content, patches)
    diff_text = unified_diff(content, after)
    return patches, after, diff_text
