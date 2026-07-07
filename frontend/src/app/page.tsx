"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken, isAuthenticated, setToken, statusLabels } from "@/lib/api";
import type { ProjectDetail } from "@/lib/types";
import { CardSkeleton } from "@/components/LoadingSpinner";
import { useToast } from "@/components/Toast";

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
  const { toast } = useToast();

  useEffect(() => {
    if (isAuthenticated()) {
      loadProjects();
      setAuthChecked(true);
    } else {
      fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:6986/api"}/projects`)
        .then((res) => { if (res.status === 401) setNeedsAuth(true); else loadProjects(); })
        .catch(() => loadProjects())
        .finally(() => setAuthChecked(true));
    }
  }, []);

  function loadProjects() {
    api.listProjects().then(setProjects).catch((e) => toast(e.message, "error")).finally(() => setLoading(false));
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setLoginBusy(true); setError("");
    try {
      const result = await api.login(password.trim());
      console.info("[App] Login success");
      setToken(result.token); setNeedsAuth(false); setLoading(true);
      loadProjects();
    } catch (err) { setError(err instanceof Error ? err.message : "登录失败"); }
    finally { setLoginBusy(false); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true); setError("");
    try {
      const project = await api.createProject(title.trim());
      console.info("[App] Created project:", project.id, project.title);
      window.location.href = `/project/${project.id}`;
    } catch (err) { setError(err instanceof Error ? err.message : "创建失败"); setCreating(false); }
  }

  return (
    <main className="page-enter mx-auto min-h-screen max-w-2xl px-5 pb-12 pt-14">
      <header className="mb-10">
        <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#6366f1]/10 to-[#06b6d4]/10 px-4 py-1.5 text-xs font-medium text-[#6366f1] ai-border">
          <span className="h-1.5 w-1.5 rounded-full bg-[#06b6d4] animate-pulse" />
          自传 Agent
        </div>
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-[#1e1b4b] sm:text-4xl">
          写下您的
          <span className="ai-gradient">人生故事</span>
        </h1>
        <p className="mt-3 text-base leading-relaxed text-[#6b6889]">
          AI 记者主动采访，按章节书写，支持精准修改。让每个人都能拥有一本自传。
        </p>
      </header>

      {!authChecked || (loading && !getToken()) ? (
        <CardSkeleton count={3} />
      ) : needsAuth ? (
        <form onSubmit={handleLogin} className="card animate-fade-up space-y-4 p-6">
          <div className="text-center">
            <span className="text-4xl">🔐</span>
            <h2 className="mt-2 text-lg font-semibold text-[#1e1b4b]">需要登录</h2>
            <p className="mt-1 text-sm text-[#6b6889]">请输入访问密码</p>
          </div>
          {error && <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#ef4444]">{error}</div>}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="访问密码" className="input text-base" autoFocus />
          <button type="submit" disabled={loginBusy || !password.trim()} className="btn-primary w-full py-3.5">{loginBusy ? "验证中..." : "登录"}</button>
        </form>
      ) : (
        <>
          {projects.length > 0 && (
            <div className="mb-8 space-y-3">
              {projects.map((project, i) => (
                <Link key={project.id} href={`/project/${project.id}`}
                  className="card card-hover animate-fade-up group relative flex items-center gap-4 overflow-hidden p-5"
                  style={{ animationDelay: `${i * 60}ms` }}>
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#eef2ff] to-[#e0e7ff] text-xl">📖</div>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold text-[#1e1b4b] group-hover:text-[#6366f1] transition-colors">{project.title}</h2>
                    <div className="mt-1 flex items-center gap-2 text-sm text-[#6b6889]">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#eef2ff] px-2.5 py-0.5 text-xs font-medium text-[#6366f1]">{statusLabels[project.status]}</span>
                      <span>{project.chapters.length} 章</span>
                    </div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-[#d4d0e8] group-hover:text-[#6366f1] transition-colors"><path d="M9 18l6-6-6-6" /></svg>
                </Link>
              ))}
            </div>
          )}

          {showForm ? (
            <form onSubmit={handleCreate} className="card animate-fade-up space-y-3 p-5">
              <label className="block text-sm font-medium text-[#1e1b4b]">新自传标题</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：我的人生回忆录" className="input text-base" autoFocus />
              <div className="flex gap-2">
                <button type="submit" disabled={creating} className="btn-primary flex-1 py-3">{creating ? "创建中..." : "开始创作"}</button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-outline px-5 py-3">取消</button>
              </div>
            </form>
          ) : (
            <button onClick={() => setShowForm(true)} className="ai-border relative w-full overflow-hidden rounded-2xl bg-[#6366f1] py-4 font-medium text-white shadow-[0_4px_16px_-2px_rgba(99,102,241,0.3)] transition-all hover:bg-[#4f46e5] hover:shadow-[0_6px_20px_-2px_rgba(99,102,241,0.4)] active:scale-[0.98]">
              <span className="relative z-10">✦ 新建自传</span>
            </button>
          )}
        </>
      )}
    </main>
  );
}
