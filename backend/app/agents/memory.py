"""
Memory Module — short-term / long-term / semantic recall.

Architecture role:
  ShortTerm:  recent Q&A context (last N messages)
  LongTerm:   chapter summaries from completed chapters
  Semantic:   keyword-based search across all interviews to avoid
              repeating questions and find related material.
"""

import re
from typing import Any


def _contains_any(text: str, phrases: tuple[str, ...]) -> bool:
    return any(phrase in text for phrase in phrases)


class AgentMemory:
    """Unified memory interface used by Interviewer, Writer, and Editor."""

    # ── Short-Term Memory ─────────────────────────

    @staticmethod
    def recent_messages(
        messages: list[dict[str, str]], last_n: int = 20
    ) -> list[dict[str, str]]:
        """Return the most recent N messages (sliding window)."""
        return messages[-last_n:] if len(messages) > last_n else messages

    @staticmethod
    def count_user_rounds(messages: list[dict[str, str]]) -> int:
        """How many questions has the user answered."""
        return sum(1 for m in messages if m.get("role") == "user")

    # ── Long-Term Memory ──────────────────────────

    @staticmethod
    def chapter_context(
        summaries: list[str],
        prev_summary: str | None = None,
        next_summary: str | None = None,
    ) -> str:
        """Build cross-chapter context string for the Writer."""
        parts: list[str] = []
        if prev_summary:
            parts.append(f"上一章摘要：{prev_summary}")
        if next_summary:
            parts.append(f"下一章摘要：{next_summary}")
        if summaries:
            parts.append("已完成章节摘要：\n" + "\n".join(f"- {s}" for s in summaries))
        return "\n".join(parts)

    # ── Semantic Memory ───────────────────────────

    @staticmethod
    def extract_keywords(text: str, min_length: int = 2) -> list[str]:
        """Simple keyword extraction for Chinese text."""
        # Split on Chinese punctuation and whitespace
        segments = re.split(r"[，。！？；：、\s]+", text)
        keywords: list[str] = []
        for seg in segments:
            seg = seg.strip()
            if len(seg) >= min_length:
                keywords.append(seg)
        return keywords

    @staticmethod
    def topic_anchors(topic: str) -> list[str]:
        """Extract compact anchors from a planned topic question.

        Planned topics are often full interviewer questions. Matching the full
        sentence against interview answers makes clearly covered topics look
        untouched, so we keep only short, content-bearing anchors.
        """
        anchors: list[str] = []
        seen: set[str] = set()
        stopwords = {
            "请描述", "描述", "第一次", "意识到", "情境", "如何", "解释", "这件事",
            "工作台", "能否", "回忆", "一个", "具体", "项目", "最早", "产生",
            "兴趣", "时候", "当时", "身边", "哪些", "他们", "有何", "影响",
            "有没有", "某件", "物品", "玩具", "设计", "执着", "发生", "什么",
            "以及", "的是", "如何", "请", "你", "您",
        }
        stop_substrings = (
            "请描述", "第一次", "意识到", "情境", "如何", "这件事", "能否",
            "什么时候", "当时", "哪些", "有何", "影响", "有没有", "发生",
            "什么", "让你", "对你", "教你",
        )
        preferred_terms = (
            "被收养", "收养", "保罗", "克拉拉", "父亲", "母亲", "车库", "工作台",
            "看不见", "背面", "电子学", "电子", "硅谷", "工程师", "邻居",
            "童年", "物品", "玩具", "设计", "执着", "手艺", "家庭",
        )

        for term in preferred_terms:
            if term in topic and term not in seen:
                anchors.append(term)
                seen.add(term)

        for segment in AgentMemory.extract_keywords(topic):
            latin_parts = re.findall(r"[A-Za-z][A-Za-z0-9.+#-]*", segment)
            for part in latin_parts:
                if part not in seen:
                    anchors.append(part)
                    seen.add(part)

            cjk = re.sub(r"[^\u4e00-\u9fff]", "", segment)
            if not cjk:
                continue
            candidates: list[str] = []
            for size in (3, 4, 2):
                for index in range(0, max(0, len(cjk) - size + 1)):
                    candidates.append(cjk[index:index + size])

            for candidate in candidates:
                if (
                    len(candidate) < 2
                    or candidate in stopwords
                    or any(part in candidate for part in stop_substrings)
                    or candidate.startswith(("请", "你", "您", "他", "她", "它"))
                    or candidate.endswith(("吗", "呢", "么", "的", "了"))
                    or candidate in seen
                ):
                    continue
                anchors.append(candidate)
                seen.add(candidate)

        return anchors[:24]

    def find_unanswered_topics(
        self, topics: list[str], messages: list[dict[str, str]]
    ) -> list[str]:
        """Return topics that have NOT been discussed yet."""
        user_text = " ".join(
            m.get("content", "") for m in messages if m.get("role") == "user"
        )
        unanswered: list[str] = []
        for topic in topics:
            # Check if any significant part of the topic was mentioned
            kws = self.topic_anchors(topic)
            if not kws:
                continue
            # If fewer than half the keywords appear, consider it unanswered
            matched = sum(1 for kw in kws if kw in user_text)
            if matched < max(1, min(3, len(kws) // 3)):
                unanswered.append(topic)
        return unanswered

    @staticmethod
    def topic_coverage_summary(
        interview_topics: list[str], messages: list[dict[str, str]]
    ) -> dict[str, Any]:
        """Analyze which topics have been covered and how deeply."""
        user_text = " ".join(
            m.get("content", "") for m in messages if m.get("role") == "user"
        )
        total_chars = len(user_text)

        result: dict[str, Any] = {"topics": [], "total_rounds": 0, "total_chars": total_chars}
        user_rounds = sum(1 for m in messages if m.get("role") == "user")
        result["total_rounds"] = user_rounds

        for topic in interview_topics:
            kws = AgentMemory.topic_anchors(topic)
            matched = sum(1 for kw in kws if kw in user_text)
            coverage = min(1.0, matched / max(1, min(5, len(kws))))
            result["topics"].append({
                "topic": topic,
                "coverage": round(coverage, 2),
                "status": "covered" if coverage >= 0.5 else "shallow" if coverage >= 0.2 else "untouched",
            })

        return result

    # ── Interview Quality ─────────────────────────

    @staticmethod
    def answer_quality(answer: str) -> dict[str, Any]:
        """Score whether a user answer has enough concrete material to write from."""
        text = answer.strip()
        if not text:
            return {
                "is_substantive": False,
                "score": 0,
                "char_count": 0,
                "missing_dimensions": ["时间", "地点", "人物", "动作/事件", "感受/影响"],
                "reason": "回答为空",
            }

        dimensions = {
            "时间": AgentMemory._has_time_signal(text),
            "地点": AgentMemory._has_place_signal(text),
            "人物": AgentMemory._has_person_signal(text),
            "动作/事件": AgentMemory._has_event_signal(text),
            "感受/影响": AgentMemory._has_feeling_signal(text),
        }
        score = sum(1 for value in dimensions.values() if value)
        char_count = len(text)
        missing = [name for name, present in dimensions.items() if not present]

        return {
            "is_substantive": char_count >= 45 and score >= 2,
            "score": score,
            "char_count": char_count,
            "missing_dimensions": missing,
            "reason": "素材具体" if char_count >= 45 and score >= 2 else "回答偏短或缺少可写细节",
        }

    @staticmethod
    def detail_followup_question(answer: str, chapter_title: str, topics: list[str]) -> str:
        """Ask for one natural, low-pressure follow-up after a shallow answer."""
        quality = AgentMemory.answer_quality(answer)
        missing = quality.get("missing_dimensions", [])
        topic_hint = topics[0] if topics else chapter_title
        text = answer.strip()

        if _contains_any(
            text,
            (
                "你好",
                "测试",
                "试一下",
                "试试",
                "麦克风",
                "语音模型",
                "千问",
                "ASR",
                "TTS",
                "录音",
            ),
        ):
            return (
                "这段先不算正式采访。"
                "如果您准备好了，我们可以直接从一个具体画面开始，比如一个人、一件事或一个地方，"
                "您最先想到哪一个？"
            )

        if _contains_any(text, ("不想说", "不方便说", "不太方便", "跳过", "换一个", "不聊这个")):
            return f"没关系，这段我们先放下。换个轻松一点的角度，关于「{topic_hint}」，您更愿意从哪件小事说起？"

        if _contains_any(text, ("不记得", "想不起来", "记不清", "忘了")):
            return f"没关系，具体时间记不清也很正常。关于「{topic_hint}」，您最先想起的是一个人、一个地方，还是一句话？"

        anchor = AgentMemory._answer_anchor(text)
        prefix = f"您刚才提到“{anchor}”。" if anchor else "听起来这段记忆很有画面。"
        focus = missing[0] if missing else ""
        prompts = {
            "动作/事件": "如果把镜头拉近一点，最清楚的那一幕是什么？",
            "感受/影响": "那一刻，您心里最强烈的感受是什么？",
            "人物": "这段记忆里，谁的身影最清楚？",
            "地点": "那件事发生的地方，您还记得什么样子吗？",
            "时间": "这大概是您人生的哪个阶段？不用记得很准确。",
        }
        question = prompts.get(focus, "当时还有哪个小细节，是您现在想起来还会有感觉的？")
        return f"{prefix}{question}"

    @staticmethod
    def _answer_anchor(text: str, max_length: int = 22) -> str:
        compact = re.sub(r"\s+", "", text).strip("，。！？；：,。!?;:")
        if len(compact) <= max_length:
            return compact
        return f"{compact[:max_length]}……"

    # ── User Preference Memory ─────────────────────

    @staticmethod
    def preference_context(
        style_notes: str | None = None,
        preference_notes: str | None = None,
        memory_notes: str | None = None,
    ) -> str:
        """Build a compact, prompt-ready profile for personalized agents."""
        parts: list[str] = []
        if style_notes:
            parts.append(f"写作风格：{style_notes.strip()}")
        if preference_notes:
            parts.append(f"用户明确偏好：{preference_notes.strip()}")
        if memory_notes:
            parts.append(f"Agent 已学习到的偏好和长期记忆：{memory_notes.strip()}")
        return "\n".join(parts)

    @staticmethod
    def learn_preference_from_answer(answer: str, existing_notes: str | None = None) -> str | None:
        """Extract durable user preferences from an answer without calling the LLM.

        This intentionally stays conservative: it only records sentences that
        look like explicit preferences, boundaries, or writing instructions.
        """
        text = answer.strip()
        if not text:
            return existing_notes

        cues = (
            "我喜欢",
            "我不喜欢",
            "我希望",
            "我想",
            "我更",
            "最好",
            "不要",
            "别",
            "希望你",
            "写得",
            "语气",
            "风格",
            "称呼",
            "隐私",
            "保密",
            "不要写",
            "可以写",
        )
        sentences = [
            s.strip()
            for s in re.split(r"[。！？\n]+", text)
            if s.strip()
        ]
        learned: list[str] = []
        for sentence in sentences:
            if any(cue in sentence for cue in cues):
                learned.append(sentence[:120])

        if not learned:
            return existing_notes

        existing_items = [
            line[2:].strip() if line.startswith("- ") else line.strip()
            for line in (existing_notes or "").splitlines()
            if line.strip()
        ]
        seen = set(existing_items)
        for item in learned:
            if item not in seen:
                existing_items.append(item)
                seen.add(item)

        return "\n".join(f"- {item}" for item in existing_items[-24:])

    @staticmethod
    def forbidden_terms(
        style_notes: str | None = None,
        preference_notes: str | None = None,
        memory_notes: str | None = None,
    ) -> list[str]:
        """Extract literal terms the user has asked us not to reveal."""
        text = "\n".join(
            item for item in (style_notes, preference_notes, memory_notes) if item
        )
        if not text:
            return []

        patterns = (
            r"(?:不要|别|不准|避免)(?:提到|写出|提出|透露|公开|出现|写|提)(?:出|及)?[：:，,\s]*(.+)",
            r"(?:把|将)(.+?)(?:保密|隐藏|隐去)",
            r"(.+?)(?:要保密|请保密|不要公开|别公开)",
        )
        terms: list[str] = []
        for line in re.split(r"[\n。！？；;，,]+", text):
            line = line.strip().lstrip("-").strip()
            if not line:
                continue
            for pattern in patterns:
                match = re.search(pattern, line)
                if not match:
                    continue
                candidate = match.group(1).strip(" ：:,，。\"'“”‘’")
                candidate = re.sub(r"^(我的|我|真实|具体|那个|这段)", "", candidate).strip()
                candidate = re.sub(r"(名字|姓名|内容|信息)$", "", candidate).strip()
                if 2 <= len(candidate) <= 40 and not AgentMemory._is_generic_privacy_term(candidate):
                    terms.append(candidate)

        deduped: list[str] = []
        seen: set[str] = set()
        for term in terms:
            if term not in seen:
                deduped.append(term)
                seen.add(term)
        return deduped[:20]

    @staticmethod
    def redact_forbidden_content(
        content: str,
        style_notes: str | None = None,
        preference_notes: str | None = None,
        memory_notes: str | None = None,
    ) -> str:
        """Remove literal forbidden terms from generated AI content."""
        redacted = content
        for term in AgentMemory.forbidden_terms(style_notes, preference_notes, memory_notes):
            redacted = redacted.replace(term, "[已按隐私偏好省略]")
        return redacted

    @staticmethod
    def _is_generic_privacy_term(term: str) -> bool:
        generic_terms = {
            "真实",
            "具体",
            "姓名",
            "名字",
            "真实姓名",
            "隐私",
            "个人隐私",
            "这段",
            "内容",
            "信息",
            "太煽情",
        }
        return term in generic_terms

    @staticmethod
    def _has_time_signal(text: str) -> bool:
        patterns = (
            r"\d{2,4}\s*年",
            r"\d+\s*岁",
            r"(小时候|童年|小学|中学|高中|大学|毕业|年轻|后来|那年|当时|以前|退休|工作后|结婚后)",
        )
        return any(re.search(pattern, text) for pattern in patterns)

    @staticmethod
    def _has_place_signal(text: str) -> bool:
        patterns = (
            r"(家里|学校|教室|村里|城里|单位|工厂|矿区|医院|车站|宿舍|办公室|操场|路上|上海|北京|东北|故乡|老家)",
            r"在.{1,12}(里|上|边|旁|附近)",
        )
        return any(re.search(pattern, text) for pattern in patterns)

    @staticmethod
    def _has_person_signal(text: str) -> bool:
        patterns = (
            r"(父亲|母亲|爸爸|妈妈|老师|同学|朋友|孩子|爱人|丈夫|妻子|领导|师傅|邻居|家人)",
            r"[\u4e00-\u9fa5]{1,3}(老师|师傅|主任|校长|医生|同学)",
        )
        return any(re.search(pattern, text) for pattern in patterns)

    @staticmethod
    def _has_event_signal(text: str) -> bool:
        verbs = (
            "发生", "记得", "遇到", "去了", "看见", "听到", "说", "写", "读", "背", "借",
            "走", "跑", "哭", "笑", "教", "帮", "决定", "选择", "考试", "工作", "搬",
        )
        return any(verb in text for verb in verbs)

    @staticmethod
    def _has_feeling_signal(text: str) -> bool:
        cues = (
            "觉得", "感到", "害怕", "高兴", "难过", "委屈", "骄傲", "遗憾", "温暖",
            "影响", "改变", "明白", "懂得", "喜欢", "不喜欢", "触动", "难忘",
        )
        return any(cue in text for cue in cues)


# Singleton
memory = AgentMemory()
