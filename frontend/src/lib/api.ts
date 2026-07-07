import type {
  ChapterDetail,
  EditPreview,
  InterviewMessage,
  InterviewResult,
  ProjectDetail,
  PublishedProject,
  PublishResponse,
  Revision,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:6986/api";
const TOKEN_KEY = "auth_token";

// ── Auth helpers ────────────────────────────────────

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = JSON.parse(await res.text());
    return body.detail || body.message || `请求失败 (${res.status})`;
  } catch {
    return `请求失败 (${res.status})`;
  }
}

// ── Request helper ──────────────────────────────────

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 204) return undefined as unknown as T; // no content

  if (res.status === 401) {
    clearToken();
    throw new Error("请先登录");
  }

  if (!res.ok) {
    const detail = await parseError(res);
    throw new Error(detail);
  }
  return res.json();
}

// ── API ─────────────────────────────────────────────

export const api = {
  // Auth
  login: (password: string) =>
    request<{ token: string; message: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  // Projects
  listProjects: () => request<ProjectDetail[]>("/projects"),

  createProject: (title: string, styleNotes?: string) =>
    request<ProjectDetail>("/projects", {
      method: "POST",
      body: JSON.stringify({ title, style_notes: styleNotes }),
    }),

  getProject: (id: string) => request<ProjectDetail>(`/projects/${id}`),

  updateProject: (id: string, data: { title?: string; style_notes?: string }) =>
    request<ProjectDetail>(`/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteProject: (id: string) =>
    request<void>(`/projects/${id}`, { method: "DELETE" }),

  planProject: (id: string, authorBackground: string) =>
    request<ProjectDetail>(`/projects/${id}/plan`, {
      method: "POST",
      body: JSON.stringify({ author_background: authorBackground }),
    }),

  // Chapters
  getChapter: (id: string) => request<ChapterDetail>(`/chapters/${id}`),

  updateChapter: (chapterId: string, contentMd: string) =>
    request<ChapterDetail>(`/chapters/${chapterId}`, {
      method: "PATCH",
      body: JSON.stringify({ content_md: contentMd }),
    }),

  // Interview
  startInterview: (chapterId: string) =>
    request<InterviewResult>(`/chapters/${chapterId}/interview/start`, {
      method: "POST",
    }),

  getInterviewMessages: (chapterId: string) =>
    request<InterviewMessage[]>(`/chapters/${chapterId}/interview/messages`),

  submitAnswer: (chapterId: string, content: string) =>
    request<InterviewResult>(`/chapters/${chapterId}/interview/answer`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),

  // Writing
  writeChapter: (chapterId: string) =>
    request<ChapterDetail>(`/chapters/${chapterId}/write`, { method: "POST" }),

  // Editing
  previewEdit: (chapterId: string, instruction: string) =>
    request<EditPreview>(`/chapters/${chapterId}/edit`, {
      method: "POST",
      body: JSON.stringify({ instruction }),
    }),

  applyEdit: (chapterId: string, revisionId: string) =>
    request<ChapterDetail>(`/chapters/${chapterId}/edit/apply`, {
      method: "POST",
      body: JSON.stringify({ revision_id: revisionId }),
    }),

  listRevisions: (chapterId: string) =>
    request<Revision[]>(`/chapters/${chapterId}/revisions`),

  rollbackRevision: (chapterId: string, revisionId: string) =>
    request<ChapterDetail>(`/chapters/${chapterId}/revisions/${revisionId}/rollback`, {
      method: "POST",
    }),

  // Publish
  publishProject: (projectId: string) =>
    request<PublishResponse>(`/projects/${projectId}/publish`, { method: "POST" }),

  unpublishProject: (projectId: string) =>
    request<ProjectDetail>(`/projects/${projectId}/unpublish`, { method: "POST" }),

  getPublicShare: (shareToken: string) =>
    request<PublishedProject>(`/public/share/${shareToken}`),
};

// ── SSE streaming ───────────────────────────────────

export function streamWriteChapter(
  chapterId: string,
  onToken: (text: string) => void,
  onDone: (content: string) => void,
  onError: (message: string) => void,
): () => void {
  let url = `${API_BASE}/chapters/${chapterId}/write/stream`;
  const token = getToken();
  if (token) {
    url += `?token=${encodeURIComponent(token)}`;
  }
  const source = new EventSource(url);

  source.addEventListener("token", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data);
      onToken(data.text);
    } catch {
      /* ignore */
    }
  });

  source.addEventListener("done", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data);
      onDone(data.content_md || "");
    } finally {
      source.close();
    }
  });

  source.addEventListener("error", () => {
    onError("写作流连接失败");
    source.close();
  });

  return () => source.close();
}

// ── Status labels ───────────────────────────────────

export const statusLabels: Record<string, string> = {
  planning: "规划中",
  interviewing: "采访中",
  writing: "写作中",
  reviewing: "审阅中",
  completed: "已完成",
  pending: "待开始",
  drafting: "撰写中",
  done: "已完成",
};
