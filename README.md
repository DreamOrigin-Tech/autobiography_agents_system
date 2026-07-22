# 自传 Agent 系统

一个移动端优先的自传写作产品：AI 记者主动采访作者，按章节沉淀素材，生成第一人称正文，并支持质量检查、偏好记忆、隐私保护、精准修改和公开分享。

## 当前能力

- **偏好与记忆**：创建项目时可填写写作语气、采访方式和隐私边界；采访中可继续补充偏好；Agent 会从回答里学习长期偏好，并可在设置页编辑。
- **章节规划**：根据作者背景生成章节大纲和采访话题。
- **主动采访**：逐章提问，针对浅回答追问细节，并显示素材进度和章节覆盖度。
- **素材门槛**：采访素材不足时阻止 AI 直接写作，降低空泛和编造风险。
- **章节写作**：基于采访记录、偏好和前后章节摘要生成正文，自动按隐私偏好过滤禁忌内容。
- **质量检查**：章节页显示草稿质量报告；发布前会检查高风险章节，风险过高时禁止发布。
- **精准修改**：输入修改要求生成 diff 预览，确认后应用；支持修改历史和回滚。
- **防丢稿体验**：采访回答、手动正文编辑、AI 修改指令都会本地自动保存草稿。
- **发布分享**：完成章节后生成公开阅读页，带章节目录、阅读进度、阅读时长和复制链接。
- **继续创作**：首页项目卡展示完成进度、已发布状态、最近更新时间和下一步。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 16 + React 19 + Tailwind CSS |
| 后端 | FastAPI + SQLAlchemy + Alembic |
| Agent | LiteLLM + 自定义 Planner / Interviewer / Writer / Editor / Memory |
| 数据库 | SQLite（开发）/ PostgreSQL（生产配置预留） |

## 快速开始

### 1. 配置后端环境变量

```bash
cp backend/.env.example backend/.env
```

默认示例使用 DeepSeek：

```env
LITELLM_MODEL=deepseek-v4-pro
DEEPSEEK_API_KEY=sk-your-deepseek-key
DATABASE_URL=sqlite+aiosqlite:///./autobiography.db
CORS_ORIGINS=http://localhost:6985
```

也可以改用 OpenAI：

```env
LITELLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-your-openai-key
```

系统现在要求登录后才能使用私有工作台。微信登录使用微信开放平台的「网站应用」扫码授权；本地管理员密码是没有微信资质时的开发/迁移回退方式：

```env
ACCESS_PASSWORD=your-password
```

微信登录配置：

```env
FRONTEND_URL=http://localhost:6985
PUBLIC_API_URL=http://localhost:6986
WECHAT_APP_ID=wx-your-app-id
WECHAT_APP_SECRET=your-app-secret
WECHAT_REDIRECT_URI=http://localhost:6986/api/auth/wechat/callback
```

在微信开放平台的网站应用中，将 `WECHAT_REDIRECT_URI` 的域名加入授权回调域名。`WECHAT_APP_SECRET` 只放在后端环境变量中，浏览器不会收到。

### 2. 启动后端

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn app.main:app --reload --host 127.0.0.1 --port 6986
```

后端健康检查：

```bash
curl http://127.0.0.1:6986/health
```

本地开发可以直接使用一键启动：

```bash
./start.sh dev
```

该命令会使用 Docker 启动开发环境并临时开启免登录，方便本地调试；`./start.sh prod` 会强制关闭免登录，生产环境仍要求用户登录。

脚本会自动发现 Homebrew 或 nvm 安装的 Node.js。若本机没有 Node.js/npm 但已安装 Docker，开发启动会自动切换到 Docker 模式。

如果希望使用本机 Python venv 和 npm，而不是 Docker，可执行：

```bash
./start.sh local
```

API 文档：

```text
http://127.0.0.1:6986/docs
```

### 3. 启动前端

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev -- --hostname 127.0.0.1 --port 6985
```

打开：

```text
http://127.0.0.1:6985
```

### Docker 开发启动

```bash
cp backend/.env.example backend/.env
docker compose up --build
```

默认端口：

- 前端：http://localhost:6985
- 后端：http://localhost:6986

## 典型使用流程

1. 首页点击「新建自传」，填写标题、写作语气、采访与隐私偏好。
2. 在项目页填写作者背景，生成章节大纲。
3. 进入某章采访页，与 AI 记者对话。系统会提示素材进度、缺失维度和是否可以写作。
4. 素材达到门槛后进入章节页，让 AI 生成正文，或手动撰写。
5. 查看「草稿质量检查」，按建议继续采访、修改或删改风险内容。
6. 输入 AI 修改要求，预览 diff 后确认应用；必要时回滚。
7. 全部章节完成后进入设置页，查看发布前检查，通过后发布分享链接。

## 关键 API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/auth/providers` | 查看当前可用登录方式 |
| `POST` | `/api/auth/login` | 本地管理员回退登录 |
| `GET` | `/api/auth/wechat/start` | 开始微信扫码授权 |
| `GET` | `/api/auth/wechat/callback` | 微信授权回调 |
| `GET` | `/api/auth/me` | 获取当前登录用户 |
| `POST` | `/api/auth/logout` | 退出当前会话 |
| `POST` | `/api/projects` | 创建项目，支持写作风格和用户偏好 |
| `PATCH` | `/api/projects/{id}` | 更新标题、风格、偏好、Agent 记忆 |
| `POST` | `/api/projects/{id}/plan` | 生成章节大纲 |
| `POST` | `/api/chapters/{id}/interview/start` | 开始采访 |
| `POST` | `/api/chapters/{id}/interview/answer` | 提交回答，并可能更新 Agent 记忆 |
| `GET` | `/api/chapters/{id}/coverage` | 查看章节素材覆盖度 |
| `GET` | `/api/chapters/{id}/write/readiness` | 查看是否达到 AI 写作门槛 |
| `GET` | `/api/chapters/{id}/write/stream` | SSE 流式写作 |
| `GET` | `/api/chapters/{id}/quality` | 查看草稿质量检查 |
| `POST` | `/api/chapters/{id}/edit` | 生成修改预览 |
| `POST` | `/api/chapters/{id}/edit/apply` | 应用修改 |
| `POST` | `/api/projects/{id}/publish` | 发布自传 |
| `GET` | `/api/projects/{id}/publish/readiness` | 发布前检查 |
| `GET` | `/api/public/share/{token}` | 公开分享阅读 |

## 验证

后端测试：

```bash
cd backend
.venv/bin/python -m pytest
```

前端静态检查：

```bash
cd frontend
npm run lint
npx tsc --noEmit
```

生产构建：

```bash
cd frontend
npm run build
```

## 项目结构

```text
autobiography_agents_system/
├── backend/
│   ├── app/
│   │   ├── agents/      # 规划、采访、记忆、写作、编辑、质量检查
│   │   ├── api/         # REST + SSE 路由
│   │   ├── models/      # SQLAlchemy 模型
│   │   └── services/    # 业务逻辑
│   ├── alembic/         # 数据库迁移
│   └── tests/           # 后端测试
├── frontend/
│   └── src/
│       ├── app/         # 页面路由
│       ├── components/  # UI 组件
│       └── lib/         # API 客户端与类型
├── docs/
├── docker-compose.yml
└── docker-compose.prod.yml
```

## 产品边界

- 这是自传写作辅助系统，不应替代作者本人确认事实。
- 发布前检查会拦截明显高风险内容，但仍建议人工审阅后再分享给家人或公开传播。
- 本地草稿保存在浏览器本地存储中，换浏览器或清理浏览器数据后不会保留。
- 私有接口按登录用户隔离；公开分享接口仍可匿名访问。
- 登录会话使用 HttpOnly Cookie，数据库只保存会话令牌哈希；OAuth `state` 为一次性、限时值。
