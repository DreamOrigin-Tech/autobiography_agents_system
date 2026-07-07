# 自传 Agent 系统 — 后端架构文档

## 系统总览

```
┌──────────────────────────────────────────────────────────────────┐
│                          API Layer                               │
│   FastAPI + CORS + Auth + RateLimit + SSE                        │
│                                                                  │
│   /api/auth/login    /api/projects/*    /api/chapters/*          │
│   /api/public/*      /api/timeline      /api/reflection          │
│   /api/review                                                     │
├──────────────────────────────────────────────────────────────────┤
│                       ORCHESTRATOR                               │
│                     (orchestra.py)                                │
│                                                                  │
│   中央协调器 — 单例，调度 Memory / Planning / Tools / Reflection   │
│                                                                  │
│   prepare_for_writing()    写前管线：coverage → reflection        │
│   review_after_writing()   写后管线：reflection → consistency     │
│   guide_interview()        采访引导：memory → unanswered topics   │
│   full_review()            全书审查：cross_chapter_review         │
│                                                                  │
├──────────┬──────────────────┬──────────────────┬────────────────┤
│  MEMORY  │    PLANNING      │    TOOL USE      │   REFLECTION   │
│ memory.py│   planning.py    │    tools.py      │  reflection.py │
├──────────┼──────────────────┼──────────────────┼────────────────┤
│ShortTerm │ create_plan()    │ extract_         │ reflect_before │
│ 最近20条 │ 根据作者背景      │  timeline()      │ _write()       │
│ 对话窗口 │ 生成5-8章大纲     │  从Q&A提取       │  评估采访素材   │
│          │                  │  关键事件+时间    │  是否充分       │
│ LongTerm │ suggest_next()   │                  │                │
│ 已完成章 │ 基于项目状态      │ check_           │ reflect_after  │
│ 摘要上下文│ 建议下一步行动    │  consistency()   │ _write()       │
│          │                  │  跨章查事实矛盾   │  自评章节质量   │
│ Semantic │ topics_to_text() │                  │  打分+找缺失    │
│ 关键词匹配│ 话题序列化        │ check_topic_     │                │
│ 找未覆盖  │                  │  coverage()      │ cross_chapter  │
│ 话题     │                  │  LLM评估采访     │ _review()      │
│          │                  │  覆盖度          │  全书叙事审查   │
│ topic_   │                  │                  │  查矛盾/重复    │
│ coverage │                  │                  │                │
│ _summary │                  │                  │                │
├──────────┴──────────────────┴──────────────────┴────────────────┤
│                        AGENT LAYER                               │
│                                                                  │
│  interviewer.py          writer.py             editor.py         │
│  ─────────────           ─────────             ─────────         │
│  生成采访问题             流式/非流式写作        段落级精准修改     │
│  接入 Memory 引导         接入 Reflection       patch 操作        │
│  优先追问未覆盖话题        写前检查+写后自评     diff 预览         │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                        DATA LAYER                                │
│                                                                  │
│  users ─→ projects ─→ chapters ─→ revisions                     │
│              │            │                                      │
│              │            ├─ reflection_notes (JSON)              │
│              │            ├─ topic_coverage   (JSON)              │
│              │            └─ interview_sessions ─→ messages       │
│              │                                                   │
│              ├─ timeline_json (JSON)                              │
│              └─ agent_runs                                       │
│                                                                  │
│  SQLite (dev) / PostgreSQL (prod) + Alembic migrations           │
└──────────────────────────────────────────────────────────────────┘
```

## Agent 核心模块

### 1. Memory 模块 (`agents/memory.py`)

三级记忆系统，为 Agent 提供上下文感知能力。

| 层级 | 实现 | 用途 |
|---|---|---|
| **短时记忆** | 最近 20 条对话窗口 | Interviewer 生成下一个问题时避免遗忘上下文 |
| **长时记忆** | 已完成章节摘要 + 前后章上下文 | Writer 写作时保持叙事连贯 |
| **语义记忆** | 关键词提取 + 匹配（`extract_keywords` / `find_unanswered_topics`） | 检测话题覆盖度，避免重复提问 |

**关键函数：**

```
recent_messages(messages, n=20)        → 滑动窗口
chapter_context(summaries)             → 跨章上下文拼接
extract_keywords(text)                 → 中文关键词提取
find_unanswered_topics(topics, msgs)   → 未覆盖话题列表
topic_coverage_summary(topics, msgs)   → 覆盖度分析 {topic, coverage, status}
```

### 2. Planning 模块 (`agents/planning.py`)

负责章节规划的创建和动态调整。

| 功能 | 说明 |
|---|---|
| `create_plan(title, background, style)` | 根据作者背景生成 5-8 章个性化大纲，严禁通用模板章节 |
| `suggest_next_action(status, chapters)` | 基于项目状态推荐下一步：开始采访 / 继续采访 / 审阅 / 发布 |

**关键约束：**
- System prompt 强调紧扣作者职业、年代、地域
- 温度 0.7（高创造力）
- LLM 失败时 fallback 到 6 章硬编码模板（服务器日志告警）

### 3. Tool Use 模块 (`agents/tools.py`)

Agent 可调用的工具函数，增强写作质量和一致性。

| 工具 | 触发时机 | 功能 |
|---|---|---|
| `extract_timeline(messages, order)` | 写作后 | 从采访记录提取关键事件 + 时间，构建人物年表 |
| `check_consistency(chapters)` | 写作后 / 全书审查 | 跨章检查事实矛盾（年龄、人名、事件时间线） |
| `check_topic_coverage(topics, messages)` | 写作前 | LLM 评估每个采访话题的覆盖深度 |

### 4. Reflection 模块 (`agents/reflection.py`)

自传质量的自我评估系统。

| 阶段 | 函数 | 评估内容 |
|---|---|---|
| **写前** | `reflect_before_write()` | 采访素材是否充足？5+ 轮有效问答 + 具体故事细节？置信度评分 |
| **写后** | `reflect_after_write()` | 章节质量评分、优点、弱点、遗漏项、改进建议 |
| **全书** | `cross_chapter_review()` | 叙事流畅度、章节间矛盾、内容重复、叙事空白 |

### 5. Orchestrator (`agents/orchestra.py`)

中央协调器，将四个模块串联为完整的 Agent 工作流。

**写前管线 (`prepare_for_writing`)**:
```
Memory.topic_coverage_summary  →  Reflection.reflect_before_write  →  Tools.check_topic_coverage
      话题覆盖率统计                    素材是否充足？                      LLM 深度评估
```

**写后管线 (`review_after_writing`)**:
```
Reflection.reflect_after_write  →  Tools.check_consistency  →  Tools.extract_timeline
      自评章节质量                    跨章查矛盾                  提取时间线事件
```

**采访引导 (`guide_interview`)**:
```
Memory.find_unanswered_topics  →  Memory.topic_coverage_summary  →  suggested_action
      优先追问未覆盖话题              覆盖度分析                      素材够了 → 建议写作
```

## API 端点

### 核心端点（23 个）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 密码登录，返回 Bearer token |
| POST | `/api/projects` | 创建自传项目 |
| GET | `/api/projects` | 列出所有项目 |
| GET | `/api/projects/{id}` | 获取项目详情 |
| DELETE | `/api/projects/{id}` | 删除项目（含所有章节、采访、修订） |
| PATCH | `/api/projects/{id}` | 更新标题/风格 |
| POST | `/api/projects/{id}/plan` | 生成章节大纲 |
| GET | `/api/projects/{id}/chapters` | 列出项目所有章节 |
| POST | `/api/projects/{id}/publish` | 发布自传 |
| POST | `/api/projects/{id}/unpublish` | 取消发布 |
| GET | `/api/chapters/{id}` | 获取章节详情 |
| PATCH | `/api/chapters/{id}` | 手动编辑章节内容 |
| POST | `/api/chapters/{id}/interview/start` | 开始采访 |
| POST | `/api/chapters/{id}/interview/answer` | 提交回答 |
| GET | `/api/chapters/{id}/interview/messages` | 获取 Q&A 历史 |
| GET | `/api/chapters/{id}/interview/stream` | SSE 流式采访 |
| POST | `/api/chapters/{id}/write` | 非流式写作 |
| GET | `/api/chapters/{id}/write/stream` | SSE 流式写作 |
| POST | `/api/chapters/{id}/edit` | 预览修改（diff） |
| POST | `/api/chapters/{id}/edit/apply` | 应用修改 |
| GET | `/api/chapters/{id}/revisions` | 修改历史 |
| POST | `/api/chapters/{id}/revisions/{id}/rollback` | 回滚修改 |
| GET | `/api/public/share/{token}` | 公开分享（无需登录） |

### Agent 分析端点（3 个，新增）

| 方法 | 路径 | 说明 | Agent 模块 |
|---|---|---|---|
| GET | `/api/projects/{id}/timeline` | 时间线事件列表 | Tool Use |
| GET | `/api/chapters/{id}/reflection` | 章节反思记录 + 话题覆盖度 | Reflection + Memory |
| GET | `/api/projects/{id}/review` | 全书跨章审查报告 | Reflection + Tool Use |

## 数据模型

```
users
  id, name, created_at

projects
  id, user_id (FK), title, status, style_notes
  is_published, share_token, published_at
  timeline_json                          ← Agent: 时间线事件
  created_at, updated_at

chapters
  id, project_id (FK), order, title, status
  content_md, summary, interview_topics
  reflection_notes                       ← Agent: 质量反思 (JSON)
  topic_coverage                         ← Agent: 话题覆盖度 (JSON)
  created_at, updated_at

interview_sessions
  id, project_id (FK), chapter_id (FK), created_at

interview_messages
  id, session_id (FK), role, content, created_at

revisions
  id, chapter_id (FK), instruction, diff_json
  content_before, content_after, applied, created_at

agent_runs (预留)
  id, project_id (FK), agent_type
  input_snapshot, output_snapshot, created_at
```

## 状态机

### Project 状态
```
PLANNING → INTERVIEWING → WRITING → REVIEWING → COMPLETED
    ↑                                                    │
    └────────────────────────────────────────────────────┘
                      (可随时回到任一状态)
```

### Chapter 状态
```
PENDING → INTERVIEWING → DRAFTING → DONE
```

## 安全机制

| 层级 | 实现 |
|---|---|
| **认证** | Bearer Token（`ACCESS_PASSWORD` env，未配置则跳过） |
| **限流** | LLM 端点 20 次/分钟/IP（`rate_limit.py` 内存滑动窗口） |
| **容错** | LLM 调用 3 次重试 + 指数退避（1.5s → 3s → 6s） |
| **异常** | 全局 `exception_handler`，返回中文友好提示 |

## 技术栈

| 组件 | 技术 |
|---|---|
| Web 框架 | FastAPI (async) |
| LLM 抽象 | LiteLLM（支持 OpenAI / DeepSeek 切换） |
| 数据库 | SQLAlchemy 2.0 async + aiosqlite / asyncpg |
| 迁移 | Alembic |
| 流式 | SSE (sse-starlette) |
| 配置 | pydantic-settings + .env |

## 目录结构

```
backend/
├── app/
│   ├── main.py              # FastAPI 入口 + CORS + 异常处理
│   ├── config.py            # 配置（env / dotenv）
│   ├── auth.py              # 认证依赖
│   ├── rate_limit.py        # 限流器
│   ├── api/
│   │   └── routes.py        # 全部 API 路由（26 个端点）
│   ├── agents/
│   │   ├── orchestra.py     # ★ 中央协调器
│   │   ├── memory.py        # ★ 记忆模块
│   │   ├── planning.py      # ★ 规划模块
│   │   ├── tools.py         # ★ 工具模块
│   │   ├── reflection.py    # ★ 反思模块
│   │   ├── planner.py       # → re-export 兼容
│   │   ├── interviewer.py   # 采访 Agent
│   │   ├── writer.py        # 写作 Agent
│   │   ├── editor.py        # 编辑 Agent
│   │   └── graph.py         # 已清理（注释说明）
│   ├── models/
│   │   ├── user.py
│   │   ├── project.py
│   │   ├── chapter.py
│   │   ├── interview.py
│   │   ├── revision.py
│   │   └── agent_run.py
│   ├── services/
│   │   ├── project_service.py
│   │   ├── chapter_service.py
│   │   ├── interview_service.py
│   │   ├── publish_service.py
│   │   ├── llm.py           # LLM 调用 + 重试
│   │   └── patch.py         # 段落操作工具
│   ├── schemas/
│   │   └── __init__.py      # Pydantic 请求/响应模型
│   └── db/
│       └── session.py       # SQLAlchemy async engine
├── alembic/                 # 数据库迁移
├── pyproject.toml
└── Dockerfile
```

## 设计原则

1. **人机协作优先** — 不使用 LangGraph 全自动编排，每步由用户决策触发
2. **Agent 模块可组合** — Memory / Planning / Tools / Reflection 各自独立，由 Orchestra 按需组合
3. **LLM 失败优雅降级** — 所有 LLM 调用有 fallback，不会阻塞用户流程
4. **单用户设计** — 简化认证模型，用密码保护替代多用户系统
5. **移动端优先** — API 设计兼容手机端前端
