# 自传 Agent 前端

这是自传 Agent 系统的 Next.js 前端，默认连接本地后端：

```text
http://127.0.0.1:6986/api
```

## 开发启动

```bash
npm install
cp .env.local.example .env.local
npm run dev -- --hostname 127.0.0.1 --port 6985
```

打开：

```text
http://127.0.0.1:6985
```

## 检查

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## 主要页面

- `/`：项目列表、新建自传、偏好采集
- `/project/[id]`：章节列表、项目进度和下一步
- `/project/[id]/interview/[chapterId]`：采访、偏好补充、素材进度、草稿自动保存
- `/project/[id]/chapter/[chapterId]`：阅读、AI 写作、手动编辑、质量检查、修改历史
- `/project/[id]/settings`：项目设置、记忆编辑、发布检查、分享链接
- `/share/[token]`：公开阅读页

更多说明见仓库根目录 `README.md`。
