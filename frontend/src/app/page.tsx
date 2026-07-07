"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken, isAuthenticated, setToken, statusLabels } from "@/lib/api";
import type { ProjectDetail } from "@/lib/types";
import { CardSkeleton } from "@/components/LoadingSpinner";

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [password, setPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isAuthenticated()) {
      loadProjects();
      setAuthChecked(true);
    } else {
      // Try a probe request to see if auth is required
      fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:6986/api"}/projects`)
        .then((res) => {
          if (res.status === 401) {
            setNeedsAuth(true);
          } else {
            loadProjects();
          }
        })
        .catch(() => loadProjects())
        .finally(() => setAuthChecked(true));
    }
  }, []);

  function loadProjects() {
    api
      .listProjects()
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setLoginBusy(true);
    setError("");
    try {
      const result = await api.login(password.trim());
      console.info("[App] Login success");
      setToken(result.token);
      setNeedsAuth(false);
      setLoading(true);
      loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setError("");
    try {
      const project = await api.createProject(title.trim());
      console.info("[App] Created project:", project.id, project.title);
      window.location.href = `/project/${project.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-5 pb-12 pt-12">
      <header className="mb-10">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#e7dfd4] bg-white px-4 py-1.5 text-xs font-medium text-[#8b5e3c]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#52796f]" />
          自传 Agent
        </div>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-[#2c2416] sm:text-4xl">
          写下您的
          <span className="bg-gradient-to-r from-[#8b5e3c] to-[#c4946c] bg-clip-text text-transparent">人生故事</span>
        </h1>
        <p className="mt-3 text-base leading-relaxed text-[#7a7265]">
          AI 记者主动采访，按章节书写，支持精准修改。让每个人都能拥有一本自传。
        </p>
      </header>

      {!authChecked || (loading && !getToken()) ? (
        <CardSkeleton count={3} />
      ) : needsAuth ? (
        <form onSubmit={handleLogin} className="animate-fade-up space-y-4 rounded-2xl bg-white p-6 shadow-sm">
          <div className="text-center">
            <span className="text-4xl">🔐</span>
            <h2 className="mt-2 text-lg font-semibold text-[#2c2416]">需要登录</h2>
            <p className="mt-1 text-sm text-[#7a7265]">请输入访问密码</p>
          </div>
          {error && (
            <div className="rounded-xl border border-[#f0d0d0] bg-[#fef5f5] px-4 py-3 text-sm text-[#c25b56]">
              {error}
            </div>
          )}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="访问密码"
            className="w-full rounded-xl border border-[#e7dfd4] bg-[#fbf7f2] px-4 py-3 text-base outline-none transition focus:border-[#8b5e3c] focus:bg-white focus:ring-2 focus:ring-[#8b5e3c]/10"
            autoFocus
          />
          <button
            type="submit"
            disabled={loginBusy || !password.trim()}
            className="w-full rounded-xl bg-[#8b5e3c] py-3.5 font-medium text-white transition hover:bg-[#6d4a30] disabled:opacity-50"
          >
            {loginBusy ? "验证中..." : "登录"}
          </button>
        </form>
      ) : (
        <>
          {error && (
            <div className="mb-5 rounded-xl border border-[#f0d0d0] bg-[#fef5f5] px-4 py-3 text-sm text-[#c25b56]">
              {error}
            </div>
          )}

          {projects.length > 0 && (
            <div className="mb-8 space-y-3">
              {projects.map((project, i) => (
                <Link
                  key={project.id}
                  href={`/project/${project.id}`}
                  className="animate-fade-up group relative flex items-center gap-4 overflow-hidden rounded-2xl bg-white p-5 shadow-[0_1px_3px_0_rgba(0,0,0,0.04)] transition-all hover:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 active:scale-[0.98]"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#f5f0e9] to-[#e7dfd4] text-xl">
                    📖
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold text-[#2c2416] group-hover:text-[#8b5e3c] transition-colors">
                      {project.title}
                    </h2>
                    <div className="mt-1 flex items-center gap-2 text-sm text-[#7a7265]">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#f5f0e9] px-2.5 py-0.5 text-xs font-medium text-[#8b5e3c]">
                        {statusLabels[project.status]}
                      </span>
                      <span>{project.chapters.length} 章</span>
                    </div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-[#d4c8b8] group-hover:text-[#8b5e3c] transition-colors">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </Link>
              ))}
            </div>
          )}

          {showForm ? (
            <form onSubmit={handleCreate} className="animate-fade-up space-y-3 rounded-2xl bg-white p-5 shadow-sm">
              <label className="block text-sm font-medium text-[#2c2416]">新自传标题</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="如：我的人生回忆录"
                className="w-full rounded-xl border border-[#e7dfd4] bg-[#fbf7f2] px-4 py-3 text-base outline-none transition focus:border-[#8b5e3c] focus:bg-white focus:ring-2 focus:ring-[#8b5e3c]/10"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 rounded-xl bg-[#8b5e3c] py-3 font-medium text-white transition hover:bg-[#6d4a30] disabled:opacity-50"
                >
                  {creating ? "创建中..." : "开始创作"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-xl border border-[#e7dfd4] px-5 py-3 font-medium text-[#7a7265] transition hover:bg-[#f5f0e9]"
                >
                  取消
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="w-full rounded-2xl bg-[#8b5e3c] py-4 font-medium text-white shadow-sm transition-all hover:bg-[#6d4a30] hover:shadow-md active:scale-[0.98]"
            >
              + 新建自传
            </button>
          )}
        </>
      )}
    </main>
  );
}
