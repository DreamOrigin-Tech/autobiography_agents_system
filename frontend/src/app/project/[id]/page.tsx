"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, statusLabels } from "@/lib/api";
import type { ProjectDetail } from "@/lib/types";
import { ChapterCard } from "@/components/ChapterCard";
import { BottomNav } from "@/components/BottomNav";
import { CardSkeleton } from "@/components/LoadingSpinner";

export default function ProjectDashboard() {
  const params = useParams();
  const projectId = params.id as string;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [background, setBackground] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api.getProject(projectId);
      setProject(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function handlePlan() {
    setPlanning(true);
    setError("");
    try {
      const data = await api.planProject(projectId, background);
      setProject(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "规划失败");
    } finally {
      setPlanning(false);
    }
  }

  const activeChapter = project?.chapters.find((c) => c.status !== "done") || project?.chapters[0];

  if (loading) {
    return (
      <div className="mx-auto max-w-lg px-5 pt-10">
        <CardSkeleton count={4} />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="mx-auto max-w-lg px-5 pt-16 text-center">
        <p className="text-5xl">📭</p>
        <p className="mt-4 text-[#7a7265]">项目不存在</p>
        <Link href="/" className="mt-3 inline-block text-sm font-medium text-[#8b5e3c]">← 返回首页</Link>
      </div>
    );
  }

  const needsPlan = project.chapters.length === 0;
  const doneCount = project.chapters.filter((c) => c.status === "done").length;

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 pb-28 pt-6">
      <header className="mb-6">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-[#8b5e3c] hover:underline">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          返回
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-[#2c2416]">{project.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f5f0e9] px-3 py-1 text-xs font-medium text-[#8b5e3c]">
            {statusLabels[project.status]}
          </span>
          {project.chapters.length > 0 && (
            <span className="text-sm text-[#b8a892]">{doneCount}/{project.chapters.length} 章已完成</span>
          )}
          {project.is_published && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#e5efec] px-2.5 py-0.5 text-xs font-medium text-[#52796f]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#52796f]" />已发布
            </span>
          )}
        </div>
        {project.chapters.length > 0 && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#e7dfd4]">
            <div className="h-full rounded-full bg-gradient-to-r from-[#c4946c] to-[#8b5e3c] transition-all duration-700"
              style={{ width: `${(doneCount / project.chapters.length) * 100}%` }} />
          </div>
        )}
      </header>

      {error && (
        <div className="mb-4 rounded-xl border border-[#f0d0d0] bg-[#fef5f5] px-4 py-3 text-sm text-[#c25b56]">{error}</div>
      )}

      {needsPlan ? (
        <section className="animate-fade-up rounded-2xl bg-white p-6 shadow-sm">
          <div className="mb-4 text-center">
            <span className="text-4xl">📋</span>
            <h2 className="mt-2 text-lg font-semibold text-[#2c2416]">规划章节大纲</h2>
            <p className="mt-1 text-sm text-[#7a7265]">简单介绍您的背景，AI 将为您规划专属章节结构。</p>
          </div>
          <textarea
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            placeholder="例如：我今年 65 岁，退休教师，想为孙辈留下人生回忆..."
            rows={5}
            className="w-full rounded-xl border border-[#e7dfd4] bg-[#fbf7f2] px-4 py-3 text-sm outline-none transition focus:border-[#8b5e3c] focus:bg-white focus:ring-2 focus:ring-[#8b5e3c]/10 resize-none"
          />
          <button
            onClick={handlePlan}
            disabled={planning}
            className="mt-3 w-full rounded-xl bg-[#8b5e3c] py-3.5 font-medium text-white transition hover:bg-[#6d4a30] disabled:opacity-50"
          >
            {planning ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                生成大纲中...
              </span>
            ) : "生成章节大纲"}
          </button>
        </section>
      ) : (
        <div className="space-y-3">
          {project.chapters.map((chapter, i) => (
            <div key={chapter.id} className="animate-fade-up" style={{ animationDelay: `${i * 50}ms` }}>
              <ChapterCard projectId={projectId} chapter={chapter} />
            </div>
          ))}
        </div>
      )}

      {activeChapter && !needsPlan && (
        <Link
          href={`/project/${projectId}/interview/${activeChapter.id}`}
          className="mt-6 flex items-center justify-center gap-2 rounded-2xl bg-[#8b5e3c] py-4 font-medium text-white shadow-sm transition-all hover:bg-[#6d4a30] hover:shadow-md active:scale-[0.98]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
          继续采访：{activeChapter.title}
        </Link>
      )}

      <BottomNav projectId={projectId} activeChapterId={activeChapter?.id} />
    </main>
  );
}
