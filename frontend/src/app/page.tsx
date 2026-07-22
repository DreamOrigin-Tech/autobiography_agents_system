"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, statusLabels } from "@/lib/api";
import type { ProjectDetail } from "@/lib/types";
import { CardSkeleton } from "@/components/LoadingSpinner";
import { useToast } from "@/components/Toast";

type ProjectFilter = "all" | "active" | "completed" | "published";

const INITIAL_VISIBLE_COUNT = 12;

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [styleNotes, setStyleNotes] = useState("真实、温情、第一人称，适合家人朋友阅读");
  const [preferenceNotes, setPreferenceNotes] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const { toast } = useToast();

  const loadProjects = useCallback(async () => {
    setLoadError("");
    try {
      setProjects(await api.listProjects());
    } catch (e) {
      const message = e instanceof Error ? e.message : "加载项目失败";
      setLoadError(message);
      toast(message, "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadProjects(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProjects]);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return projects.filter((project) => {
      const matchesQuery = !normalizedQuery || project.title.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
      if (!matchesQuery) return false;
      if (filter === "published") return Boolean(project.is_published);
      if (filter === "completed") return project.status === "completed" || isProjectDone(project);
      if (filter === "active") return project.status !== "completed" && !isProjectDone(project);
      return true;
    });
  }, [filter, projects, query]);

  const totalDoneChapters = projects.reduce(
    (sum, project) => sum + project.chapters.filter((chapter) => chapter.status === "done").length,
    0,
  );
  const totalChapters = projects.reduce((sum, project) => sum + project.chapters.length, 0);
  const activeProjects = projects.filter((project) => project.status !== "completed" && !isProjectDone(project)).length;
  const publishedProjects = projects.filter((project) => project.is_published).length;
  const visibleProjects = filteredProjects.slice(0, visibleCount);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setError("");
    try {
      const project = await api.createProject(title.trim(), {
        style_notes: styleNotes.trim(),
        preference_notes: preferenceNotes.trim(),
      });
      router.push(`/project/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
      setCreating(false);
    }
  }

  function closeCreateForm() {
    if (creating) return;
    setShowForm(false);
    setTitle("");
    setPreferenceNotes("");
    setError("");
  }

  function retryLoadingProjects() {
    setLoading(true);
    setLoadError("");
    void loadProjects();
  }

  return (
    <main className="page-enter min-h-screen">
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-8 sm:px-8 sm:pt-10">
        <header className="flex flex-col gap-6 border-b border-[#dfe5eb] pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-[#0f766e]">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0f766e] text-sm font-bold text-white">自</span>
              自传 Agent
            </div>
            <h1 className="mt-5 text-3xl font-bold text-[#1f2937] sm:text-4xl">我的自传</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#667085] sm:text-base">
              从采访开始，把回忆整理成可阅读、可修订、可分享的人生故事。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="btn-primary inline-flex min-h-11 items-center justify-center gap-2 px-5 py-3 text-sm sm:self-auto"
          >
            <PlusIcon />
            新建自传
          </button>
        </header>

        {loading ? (
          <div className="mt-8"><CardSkeleton count={4} /></div>
        ) : loadError && projects.length === 0 ? (
          <section className="mx-auto mt-14 max-w-md border-y border-[#dfe5eb] py-12 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#fef2f2] text-[#b42318]">
              <RetryIcon />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-[#1f2937]">暂时无法打开自传</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#667085]">{loadError}</p>
            <button type="button" onClick={retryLoadingProjects} className="btn-primary mt-5 px-5 py-2.5 text-sm">
              重新加载
            </button>
          </section>
        ) : (
          <>
            <section aria-label="创作概况" className="grid grid-cols-3 gap-3 border-b border-[#dfe5eb] py-6">
              <Metric label="项目" value={projects.length} />
              <Metric label="进行中" value={activeProjects} />
              <Metric label="已完成章节" value={totalChapters > 0 ? `${totalDoneChapters}/${totalChapters}` : "0"} />
            </section>

            {projects.length > 0 && (
              <section className="py-7">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-[#1f2937]">全部项目</h2>
                    <p className="mt-1 text-sm text-[#667085]">
                      {publishedProjects > 0 ? `${publishedProjects} 本已发布，` : ""}
                      按最近更新时间排列
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <label className="relative min-w-0 sm:w-64">
                      <span className="sr-only">搜索项目</span>
                      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#98a2b3]"><SearchIcon /></span>
                      <input
                        type="search"
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setVisibleCount(INITIAL_VISIBLE_COUNT); }}
                        placeholder="搜索自传标题"
                        className="input h-11 w-full pl-10 text-sm"
                      />
                    </label>
                    <label>
                      <span className="sr-only">筛选项目状态</span>
                      <select
                        value={filter}
                        onChange={(e) => { setFilter(e.target.value as ProjectFilter); setVisibleCount(INITIAL_VISIBLE_COUNT); }}
                        className="input h-11 w-full min-w-32 appearance-none pr-9 text-sm sm:w-auto"
                      >
                        <option value="all">全部状态</option>
                        <option value="active">进行中</option>
                        <option value="completed">已完成</option>
                        <option value="published">已发布</option>
                      </select>
                    </label>
                  </div>
                </div>

                {filteredProjects.length > 0 ? (
                  <>
                    <div className="mt-5 grid gap-3 lg:grid-cols-2">
                      {visibleProjects.map((project, index) => (
                        <ProjectCard key={project.id} project={project} index={index} />
                      ))}
                    </div>
                    {visibleCount < filteredProjects.length && (
                      <button
                        type="button"
                        onClick={() => setVisibleCount((count) => count + INITIAL_VISIBLE_COUNT)}
                        className="btn-outline mx-auto mt-6 block px-6 py-2.5 text-sm"
                      >
                        再显示 {Math.min(INITIAL_VISIBLE_COUNT, filteredProjects.length - visibleCount)} 个
                      </button>
                    )}
                  </>
                ) : (
                  <div className="mt-10 border-y border-[#dfe5eb] py-14 text-center">
                    <p className="font-medium text-[#344054]">没有找到匹配的项目</p>
                    <button
                      type="button"
                      onClick={() => { setQuery(""); setFilter("all"); }}
                      className="mt-3 text-sm font-medium text-[#0f766e] hover:text-[#115e59]"
                    >
                      清除筛选
                    </button>
                  </div>
                )}
              </section>
            )}

            {projects.length === 0 && (
              <section className="mx-auto max-w-xl py-20 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#dfe5eb] bg-white text-[#0f766e] shadow-sm">
                  <BookIcon />
                </div>
                <h2 className="mt-5 text-xl font-semibold text-[#1f2937]">开始第一本自传</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[#667085]">
                  先确定标题和写作偏好，接着由 AI 记者陪您逐章回忆。
                </p>
                <button type="button" onClick={() => setShowForm(true)} className="btn-primary mt-6 px-6 py-3">
                  新建自传
                </button>
              </section>
            )}
          </>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#101828]/35 p-0 backdrop-blur-sm sm:items-center sm:p-6">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-project-title"
            className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-[#dfe5eb] bg-white p-5 shadow-2xl sm:max-w-xl sm:rounded-2xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-[#0f766e]">新项目</p>
                <h2 id="create-project-title" className="mt-1 text-xl font-semibold text-[#1f2937]">开始一本自传</h2>
                <p className="mt-2 text-sm leading-relaxed text-[#667085]">这些偏好之后都可以在设置中修改。</p>
              </div>
              <button
                type="button"
                onClick={closeCreateForm}
                disabled={creating}
                aria-label="关闭新建表单"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#667085] transition hover:bg-[#f2f4f7] hover:text-[#1f2937] disabled:opacity-40"
              >
                <CloseIcon />
              </button>
            </div>

            {error && <ErrorBanner message={error} className="mt-5" />}
            <form onSubmit={handleCreate} className="mt-6 space-y-5">
              <div>
                <label htmlFor="project-title" className="block text-sm font-medium text-[#344054]">自传标题</label>
                <input
                  id="project-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：我的人生回忆录"
                  className="input mt-2 w-full text-base"
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="project-style" className="block text-sm font-medium text-[#344054]">写作语气</label>
                <textarea
                  id="project-style"
                  value={styleNotes}
                  onChange={(e) => setStyleNotes(e.target.value)}
                  rows={3}
                  placeholder="例如：朴素真实、第一人称、少用华丽词"
                  className="input mt-2 min-h-24 w-full resize-y text-base leading-relaxed"
                />
              </div>
              <div>
                <label htmlFor="project-preferences" className="block text-sm font-medium text-[#344054]">采访与隐私偏好</label>
                <textarea
                  id="project-preferences"
                  value={preferenceNotes}
                  onChange={(e) => setPreferenceNotes(e.target.value)}
                  rows={3}
                  placeholder="例如：多追问家庭细节；不要写真实姓名；不要太煽情"
                  className="input mt-2 min-h-24 w-full resize-y text-base leading-relaxed"
                />
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-[#eaecf0] pt-5 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeCreateForm} disabled={creating} className="btn-outline px-5 py-3">
                  取消
                </button>
                <button type="submit" disabled={creating || !title.trim()} className="btn-primary px-6 py-3">
                  {creating ? "正在创建..." : "创建并继续"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

function ProjectCard({ project, index }: { project: ProjectDetail; index: number }) {
  const doneCount = project.chapters.filter((chapter) => chapter.status === "done").length;
  const totalCount = project.chapters.length;
  const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const nextChapter = project.chapters.find((chapter) => chapter.status !== "done");
  const nextLabel = totalCount === 0
    ? "填写背景并生成章节"
    : nextChapter
      ? `继续 ${nextChapter.title}`
      : project.is_published
        ? "已完成并发布"
        : "检查并发布";

  return (
    <Link
      href={`/project/${project.id}`}
      className="card card-hover group block min-w-0 p-5"
      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
    >
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#f0fdfa] text-[#0f766e]">
          <BookIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 truncate font-semibold text-[#1f2937] transition-colors group-hover:text-[#0f766e]">{project.title}</h3>
            {project.is_published && (
              <span className="shrink-0 rounded-full bg-[#ecfdf5] px-2.5 py-1 text-[11px] font-medium text-[#047857]">已发布</span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#667085]">
            <span className="font-medium text-[#0f766e]">{statusLabels[project.status]}</span>
            <span aria-hidden="true">·</span>
            <span>{totalCount > 0 ? `${doneCount}/${totalCount} 章完成` : "尚未生成章节"}</span>
            <span aria-hidden="true">·</span>
            <span>{formatUpdatedAt(project.updated_at)}</span>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#eaecf0]" aria-label={`完成进度 ${progress}%`}>
            <div className="h-full rounded-full bg-[#0f766e] transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="truncate text-sm text-[#667085]">{nextLabel}</p>
            <span className="shrink-0 text-[#98a2b3] transition-transform group-hover:translate-x-0.5 group-hover:text-[#0f766e]">
              <ChevronRightIcon />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0 text-center sm:text-left">
      <p className="text-xl font-semibold text-[#1f2937] sm:text-2xl">{value}</p>
      <p className="mt-1 truncate text-xs text-[#667085] sm:text-sm">{label}</p>
    </div>
  );
}

function ErrorBanner({ message, className = "" }: { message: string; className?: string }) {
  return <div className={`rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b42318] ${className}`}>{message}</div>;
}

function isProjectDone(project: ProjectDetail): boolean {
  return project.chapters.length > 0 && project.chapters.every((chapter) => chapter.status === "done");
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "最近更新";
  return `${date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}更新`;
}

function PlusIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
}

function SearchIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}

function RetryIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" /></svg>;
}

function BookIcon() {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>;
}

function CloseIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>;
}

function ChevronRightIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg>;
}
