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
    } catch (e) { setError(e instanceof Error ? e.message : "加载失败"); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function handlePlan() {
    setPlanning(true); setError("");
    try {
      if (styleDraft.trim()) await api.updateProject(projectId, { style_notes: styleDraft.trim() });
      const data = await api.planProject(projectId, background);
      console.info("[App] Plan outline — chapters:", data.chapters.length);
      setProject(data);
      toast("大纲已生成，开始采访吧 ✦", "success");
    } catch (e) { setError(e instanceof Error ? e.message : "规划失败"); }
    finally { setPlanning(false); }
  }

  const activeChapter = project?.chapters.find((c) => c.status !== "done") || project?.chapters[0];

  if (loading) return (<div className="mx-auto max-w-lg px-5 pt-10"><CardSkeleton count={4} /></div>);

  if (!project) {
    return (
      <div className="mx-auto max-w-lg px-5 pt-16 text-center">
        <p className="text-5xl">📭</p><p className="mt-4 text-[#6b6889]">项目不存在</p>
        <Link href="/" className="mt-3 inline-block text-sm font-medium text-[#6366f1]">← 返回首页</Link>
      </div>
    );
  }

  const needsPlan = project.chapters.length === 0;
  const doneCount = project.chapters.filter((c) => c.status === "done").length;

  return (
    <main className="page-enter mx-auto min-h-screen max-w-lg px-5 pb-28 pt-6">
      <header className="mb-6">
        <Link href="/" className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-[#6b6889] shadow-[0_1px_3px_rgba(99,102,241,0.04)] transition-all hover:text-[#1e1b4b] hover:shadow-md active:scale-95">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>首页
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-[#1e1b4b]">{project.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eef2ff] px-3 py-1 text-xs font-medium text-[#6366f1]">{statusLabels[project.status]}</span>
          {project.chapters.length > 0 && <span className="text-sm text-[#a5a0c8]">{doneCount}/{project.chapters.length} 章已完成</span>}
          {project.is_published && <span className="inline-flex items-center gap-1 rounded-full bg-[#d1fae5] px-2.5 py-0.5 text-xs font-medium text-[#10b981]"><span className="h-1.5 w-1.5 rounded-full bg-[#10b981]" />已发布</span>}
        </div>
        {project.chapters.length > 0 && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#e2e0f0]">
            <div className="h-full rounded-full bg-gradient-to-r from-[#a5b4fc] to-[#6366f1] transition-all duration-700" style={{ width: `${(doneCount / project.chapters.length) * 100}%` }} />
          </div>
        )}
      </header>

      {error && <div className="mb-4 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#ef4444]">{error}</div>}

      {needsPlan ? (
        <section className="animate-fade-up space-y-5">
          <div className="card p-6">
            <div className="mb-3 text-center">
              <span className="text-3xl">✍️</span>
              <h2 className="mt-2 text-lg font-semibold text-[#1e1b4b]">写作风格</h2>
              <p className="mt-1 text-sm text-[#6b6889]">设定自传的语气和风格，AI 将以此撰写正文。</p>
            </div>
            <textarea value={styleDraft} onChange={(e) => setStyleDraft(e.target.value)} placeholder="如：第一人称、温情真实、适合家人阅读" rows={3} className="w-full rounded-xl border border-[#e2e0f0] bg-[#f8f7ff] px-5 py-4 text-base leading-relaxed outline-none transition focus:border-[#6366f1] focus:bg-white focus:ring-2 focus:ring-[#6366f1]/10 resize-y" />
          </div>
          <div className="card p-6">
            <div className="mb-3 text-center">
              <span className="text-3xl">📋</span>
              <h2 className="mt-2 text-lg font-semibold text-[#1e1b4b]">作者背景</h2>
              <p className="mt-1 text-sm text-[#6b6889]">详细描述您的经历，AI 将据此规划章节结构。</p>
            </div>
            <textarea value={background} onChange={(e) => setBackground(e.target.value)} placeholder="例如：我今年 65 岁，退休教师，从小在东北长大，经历过文革和改革开放..." rows={8} className="min-h-[180px] w-full rounded-xl border border-[#e2e0f0] bg-[#f8f7ff] px-5 py-4 text-base leading-relaxed outline-none transition focus:border-[#6366f1] focus:bg-white focus:ring-2 focus:ring-[#6366f1]/10 resize-y" />
            <button onClick={handlePlan} disabled={planning} className="btn-primary mt-3 w-full py-3.5">
              {planning ? <span className="inline-flex items-center gap-2"><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />生成大纲中...</span> : "✦ 保存并生成章节大纲"}
            </button>
          </div>
        </section>
      ) : (
        <div className="space-y-3">
          {project.chapters.map((chapter, i) => (
            <div key={chapter.id} className="animate-fade-up" style={{ animationDelay: `${i * 50}ms` }}><ChapterCard projectId={projectId} chapter={chapter} /></div>
          ))}
        </div>
      )}

      {activeChapter && !needsPlan && (
        <Link href={`/project/${projectId}/interview/${activeChapter.id}`} className="ai-border relative mt-6 flex items-center justify-center gap-2 overflow-hidden rounded-2xl bg-[#6366f1] py-4 font-medium text-white shadow-[0_4px_16px_-2px_rgba(99,102,241,0.3)] transition-all hover:bg-[#4f46e5] hover:shadow-[0_6px_20px_-2px_rgba(99,102,241,0.4)] active:scale-[0.98]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
          继续采访：{activeChapter.title}
        </Link>
      )}
      <BottomNav projectId={projectId} activeChapterId={activeChapter?.id} />
    </main>
  );
}
