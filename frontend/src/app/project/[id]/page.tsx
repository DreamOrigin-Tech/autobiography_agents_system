"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, statusLabels } from "@/lib/api";
import type { ProjectDetail } from "@/lib/types";
import { ChapterCard } from "@/components/ChapterCard";
import { BottomNav } from "@/components/BottomNav";
import { CardSkeleton } from "@/components/LoadingSpinner";
import { useToast } from "@/components/Toast";

export default function ProjectDashboard() {
  const params = useParams();
  const projectId = params.id as string;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [background, setBackground] = useState("");
  const [styleDraft, setStyleDraft] = useState("真实、温情、第一人称，适合家人朋友阅读");
  const [error, setError] = useState("");
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const data = await api.getProject(projectId);
      setProject(data);
      if (data.style_notes) setStyleDraft(data.style_notes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function handlePlan() {
    setPlanning(true);
    setError("");
    try {
      if (styleDraft.trim()) await api.updateProject(projectId, { style_notes: styleDraft.trim() });
      const data = await api.planProject(projectId, background);
      setProject(data);
      toast("章节大纲已生成，可以开始采访了", "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "规划失败");
    } finally {
      setPlanning(false);
    }
  }

  const nextChapter = project?.chapters.find((c) => c.status !== "done");
  const navChapter = nextChapter || project?.chapters[0];

  if (loading) return <div className="mx-auto max-w-6xl px-5 pt-10 sm:px-8"><CardSkeleton count={4} /></div>;

  if (!project) {
    return (
      <div className="mx-auto max-w-lg px-5 pt-20 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#dfe5eb] bg-white text-[#0f766e]">
          <BookIcon />
        </div>
        <p className="mt-4 text-[#667085]">{error || "项目不存在"}</p>
        <Link href="/" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[#0f766e]">
          <ArrowLeftIcon /> 返回首页
        </Link>
      </div>
    );
  }

  const needsPlan = project.chapters.length === 0;
  const doneCount = project.chapters.filter((c) => c.status === "done").length;
  const allChaptersDone = project.chapters.length > 0 && doneCount === project.chapters.length;
  const progress = project.chapters.length > 0 ? Math.round((doneCount / project.chapters.length) * 100) : 0;

  return (
    <main className="page-enter min-h-screen pb-24 md:pb-10">
      <div className="mx-auto max-w-6xl px-5 pt-7 sm:px-8 sm:pt-10">
        <header className="border-b border-[#dfe5eb] pb-7">
          <div className="flex items-center justify-between gap-3">
            <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#667085] transition hover:text-[#1f2937]">
              <ArrowLeftIcon /> 首页
            </Link>
            <Link href={`/project/${projectId}/settings`} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-[#667085] transition hover:bg-white hover:text-[#1f2937]">
              <SettingsIcon /> 项目设置
            </Link>
          </div>
          <div className="mt-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#0f766e]">创作工作台</p>
              <h1 className="mt-2 break-words text-3xl font-bold text-[#1f2937] sm:text-4xl">{project.title}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded-full bg-[#f0fdfa] px-3 py-1 text-xs font-medium text-[#0f766e]">{statusLabels[project.status]}</span>
                {project.is_published && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ecfdf5] px-3 py-1 text-xs font-medium text-[#047857]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#0f9d73]" /> 已发布
                  </span>
                )}
              </div>
            </div>
            {!needsPlan && (
              <div className="w-full max-w-sm lg:w-80">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-[#344054]">整体进度</span>
                  <span className="text-[#667085]">{doneCount}/{project.chapters.length} 章 · {progress}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#eaecf0]">
                  <div className="h-full rounded-full bg-[#0f766e] transition-all duration-700" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}
          </div>
        </header>

        {error && <div className="mt-5 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}

        {needsPlan ? (
          <section className="mt-8 grid gap-5 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
            <div className="py-2 lg:pr-8">
              <p className="text-xs font-semibold text-[#0f766e]">第一步 · 建立章节地图</p>
              <h2 className="mt-3 text-2xl font-semibold leading-tight text-[#1f2937]">先从整体经历开始，后面再慢慢展开。</h2>
              <p className="mt-4 text-sm leading-7 text-[#667085]">
                AI 会根据您的背景安排章节顺序和采访重点。写得像和熟人聊天一样即可，不需要一次说得很完整。
              </p>
              <div className="mt-7 space-y-3 text-sm text-[#667085]">
                <InfoItem number="01" text="先写下人生中的重要阶段" />
                <InfoItem number="02" text="生成大纲后逐章采访" />
                <InfoItem number="03" text="确认素材，再开始写正文" />
              </div>
            </div>
            <div className="card p-5 sm:p-7">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f0fdfa] text-[#0f766e]"><PenIcon /></div>
                <div>
                  <h2 className="font-semibold text-[#1f2937]">写作风格</h2>
                  <p className="mt-1 text-sm leading-relaxed text-[#667085]">告诉 AI 您希望这本书读起来是什么感觉。</p>
                </div>
              </div>
              <label htmlFor="project-style" className="mt-6 block text-sm font-medium text-[#344054]">语气与表达</label>
              <textarea
                id="project-style"
                value={styleDraft}
                onChange={(e) => setStyleDraft(e.target.value)}
                placeholder="例如：第一人称、温情真实、适合家人阅读"
                rows={4}
                className="input mt-2 min-h-28 w-full resize-y text-base leading-relaxed"
              />
              <label htmlFor="author-background" className="mt-5 block text-sm font-medium text-[#344054]">作者背景</label>
              <p className="mt-1 text-xs text-[#98a2b3]">年龄、成长地、家庭、职业和重要转折都可以写。</p>
              <textarea
                id="author-background"
                value={background}
                onChange={(e) => setBackground(e.target.value)}
                placeholder="例如：我今年 65 岁，退休教师，从小在东北长大，后来在南方工作..."
                rows={8}
                className="input mt-2 min-h-48 w-full resize-y text-base leading-relaxed"
              />
              <button onClick={handlePlan} disabled={planning || !background.trim()} className="btn-primary mt-5 flex w-full items-center justify-center gap-2 py-3.5">
                {planning ? <><SpinnerIcon /> 正在生成大纲...</> : <><SparkIcon /> 保存并生成章节大纲</>}
              </button>
              {!background.trim() && <p className="mt-2 text-center text-xs text-[#98a2b3]">先写几句背景，AI 才能安排合适的章节。</p>}
            </div>
          </section>
        ) : (
          <section className="mt-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold text-[#0f766e]">按章节推进</p>
                <h2 className="mt-1 text-xl font-semibold text-[#1f2937]">章节目录</h2>
              </div>
              <p className="text-sm text-[#667085]">点击章节继续采访或阅读正文</p>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {project.chapters.map((chapter, index) => (
                <div key={chapter.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
                  <ChapterCard projectId={projectId} chapter={chapter} />
                </div>
              ))}
            </div>
          </section>
        )}

        {nextChapter && !needsPlan && (
          <Link href={`/project/${projectId}/interview/${nextChapter.id}`} className="ai-border mt-7 flex items-center justify-center gap-2 rounded-xl bg-[#0f766e] px-5 py-3.5 font-medium text-white shadow-[0_5px_18px_-8px_rgba(15,118,110,0.55)] transition hover:bg-[#115e59]">
            <MessageIcon /> 继续采访：{nextChapter.title} <ArrowRightIcon />
          </Link>
        )}
        {allChaptersDone && (
          <Link href={`/project/${projectId}/settings`} className="mt-7 flex items-center justify-center gap-2 rounded-xl bg-[#0f9d73] px-5 py-3.5 font-medium text-white shadow-[0_5px_18px_-8px_rgba(15,157,115,0.5)] transition hover:bg-[#087f5b]">
            <CheckIcon /> 查看发布检查 <ArrowRightIcon />
          </Link>
        )}
      </div>
      <BottomNav projectId={projectId} activeChapterId={navChapter?.id} />
    </main>
  );
}

function InfoItem({ number, text }: { number: string; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-xs font-medium text-[#d97706]">{number}</span>
      <span>{text}</span>
    </div>
  );
}

function ArrowLeftIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>;
}

function ArrowRightIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>;
}

function BookIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>;
}

function CheckIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>;
}

function MessageIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>;
}

function PenIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>;
}

function SettingsIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 01-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5v.1a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 01-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 012.8-2.8l.1.1a1.7 1.7 0 001.8.3 1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 012.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8 1.7 1.7 0 001.5 1h.1a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>;
}

function SparkIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m12 3-1.4 5.6L5 10l5.6 1.4L12 17l1.4-5.6L19 10l-5.6-1.4L12 3z" /><path d="m19 16-.7 2.3L16 19l2.3.7L19 22l.7-2.3L22 19l-2.3-.7L19 16z" /></svg>;
}

function SpinnerIcon() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />;
}
