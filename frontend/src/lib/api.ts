import type {
  ChapterDetail,
  ChapterCoverage,
  ChapterQuality,
  EditPreview,
  InterviewMessage,
  InterviewResult,
  ProjectDetail,
  PublishedProject,
  PublishReadiness,
  PublishResponse,
  Revision,
  AuthProviders,
  AuthUser,
  WriteReadiness,
} from "./types";

const TOKEN_KEY = "auth_token";
const REQUEST_TIMEOUT_MS = 10_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function resolveApiBase(
  configuredUrl: string | undefined,
  pageUrl?: string,
): string {
  const page = pageUrl ? new URL(pageUrl) : null;
  const fallback = page
    ? `${page.protocol}//${page.hostname}:6986/api`
    : "http://127.0.0.1:6986/api";
  const rawBase = configuredUrl || fallback;

  try {
    const apiUrl = new URL(rawBase);
    if (page && LOOPBACK_HOSTS.has(apiUrl.hostname)) {
      apiUrl.hostname = page.hostname;
    }
    return apiUrl.toString().replace(/\/$/, "");
  } catch {
    return rawBase.replace(/\/$/, "");
  }
}

function getApiBase(): string {
  return resolveApiBase(
    process.env.NEXT_PUBLIC_API_URL,
    typeof window !== "undefined" ? window.location.href : undefined,
  );
}

export function requestFailureMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  ) {
    return "连接服务超时，请检查访问地址后重试";
  }
  if (error instanceof TypeError) {
    return "无法连接服务，请检查访问地址后重试";
  }
  return error instanceof Error ? error.message : "请求失败，请稍后重试";
}

// ── Debug logging ───────────────────────────────────
const DEBUG = typeof window !== "undefined"
  && (
    LOOPBACK_HOSTS.has(window.location.hostname)
    || new URLSearchParams(window.location.search).has("debug")
  );

function apiLog(method: string, path: string, detail: string) {
  if (DEBUG) {
    console.debug(`[API] ${method} ${path} — ${detail}`);
  }
}

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
  const method = options?.method || "GET";
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  apiLog(method, path, "→");
  const start = performance.now();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}${path}`, {
      ...options,
      headers,
      credentials: "include",
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(requestFailureMessage(error));
  } finally {
    window.clearTimeout(timeout);
  }
  const elapsed = Math.round(performance.now() - start);

  if (res.status === 204) {
    apiLog(method, path, `204 (${elapsed}ms)`);
    return undefined as unknown as T;
  }

  if (res.status === 401) {
    apiLog(method, path, `401 (${elapsed}ms)`);
    clearToken();
    throw new Error("请先登录");
  }

  if (!res.ok) {
    const detail = await parseError(res);
    apiLog(method, path, `${res.status} (${elapsed}ms) — ${detail}`);
    throw new Error(detail);
  }
  apiLog(method, path, `${res.status} (${elapsed}ms)`);
  return res.json();
}

// ── API ─────────────────────────────────────────────

export const api = {
  // Auth
  getAuthProviders: () => request<AuthProviders>("/auth/providers"),
  login: (password: string) =>
    request<{ user: AuthUser; message: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  getMe: () => request<AuthUser>("/auth/me"),
  logout: () => request<void>("/auth/logout", { method: "POST" }),

  // Projects
  listProjects: () => request<ProjectDetail[]>("/projects"),

  createProject: (
    title: string,
    options?: {
      style_notes?: string;
      preference_notes?: string;
    },
  ) =>
    request<ProjectDetail>("/projects", {
      method: "POST",
      body: JSON.stringify({ title, ...options }),
    }),

  getProject: (id: string) => request<ProjectDetail>(`/projects/${id}`),

  updateProject: (
    id: string,
    data: {
      title?: string;
      style_notes?: string;
      preference_notes?: string;
      memory_notes?: string;
    },
  ) =>
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
  getWriteReadiness: (chapterId: string) =>
    request<WriteReadiness>(`/chapters/${chapterId}/write/readiness`),

  getChapterCoverage: (chapterId: string) =>
    request<ChapterCoverage>(`/chapters/${chapterId}/coverage`),

  getChapterQuality: (chapterId: string) =>
    request<ChapterQuality>(`/chapters/${chapterId}/quality`),

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

  getPublishReadiness: (projectId: string) =>
    request<PublishReadiness>(`/projects/${projectId}/publish/readiness`),

  unpublishProject: (projectId: string) =>
    request<ProjectDetail>(`/projects/${projectId}/unpublish`, { method: "POST" }),

  getPublicShare: (shareToken: string) =>
    request<PublishedProject>(`/public/share/${shareToken}`),
};

export function getWeChatLoginUrl(nextPath = "/"): string {
  return `${getApiBase()}/auth/wechat/start?next=${encodeURIComponent(nextPath)}`;
}

// ── SSE streaming ───────────────────────────────────

export function streamWriteChapter(
  chapterId: string,
  onToken: (text: string) => void,
  onDone: (content: string) => void,
  onError: (message: string) => void,
): () => void {
  let url = `${getApiBase()}/chapters/${chapterId}/write/stream`;
  const token = getToken();
  if (token) {
    url += `?token=${encodeURIComponent(token)}`;
  }
  const source = new EventSource(url, { withCredentials: true });
  let errorCount = 0;
  const MAX_ERRORS = 5;

  source.addEventListener("token", (event) => {
    errorCount = 0; // reset on successful data
    try {
      const data = JSON.parse((event as MessageEvent).data);
      onToken(data.text);
    } catch {
      /* ignore malformed token */
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

  source.addEventListener("error", (event) => {
    errorCount++;

    // Check if the server sent an explicit error event
    if (event instanceof MessageEvent) {
      try {
        const data = JSON.parse(event.data);
        onError(data.message || "写作服务出错");
      } catch {
        onError("写作服务连接中断");
      }
      source.close();
      return;
    }

    // readyState 2 = CLOSED — connection was permanently closed
    if (source.readyState === EventSource.CLOSED) {
      if (errorCount >= MAX_ERRORS) {
        onError("写作流多次重连失败，请检查网络或重试");
        source.close();
      }
      // If under MAX_ERRORS, let EventSource auto-reconnect (built-in behavior)
      return;
    }

    // readyState 0 = CONNECTING — browser is retrying, let it continue
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
