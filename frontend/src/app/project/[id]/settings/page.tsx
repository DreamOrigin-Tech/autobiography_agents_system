"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import type { ProjectDetail, PublishReadiness } from "@/lib/types";
import { BottomNav } from "@/components/BottomNav";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useToast } from "@/components/Toast";

export default function ProjectSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [publishReadiness, setPublishReadiness] = useState<PublishReadiness | null>(null);
  const [title, setTitle] = useState("");
  const [styleNotes, setStyleNotes] = useState("");
  const [preferenceNotes, setPreferenceNotes] = useState("");
  const [memoryNotes, setMemoryNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const [data, readiness] = await Promise.all([
        api.getProject(projectId),
        api.getPublishReadiness(projectId),
      ]);
      setProject(data);
      setPublishReadiness(readiness);
      setTitle(data.title);
      setStyleNotes(data.style_notes || "");
      setPreferenceNotes(data.preference_notes || "");
      setMemoryNotes(data.memory_notes || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const doneCount = project?.chapters.filter((c) => c.status === "done").length ?? 0;
  const totalCount = project?.chapters.length ?? 0;
  const shareUrl = project?.share_token ? buildShareUrl(project.share_token) : "";
  const canPublish = Boolean(publishReadiness?.ready);
  const publishDisabled = publishing || doneCount === 0 || !canPublish;
  const publishLabel = publishing
    ? "正在发布..."
    : canPublish
      ? "发布自传"
      : doneCount === 0
        ? "先完成至少一章"
        : publishReadiness?.risky_chapter_count
          ? "需先处理高风险章节"
          : "暂未达到发布条件";

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const updated = await api.updateProject(projectId, {
        title: title.trim(),
        style_notes: styleNotes.trim(),
        preference_notes: preferenceNotes.trim(),
        memory_notes: memoryNotes.trim(),
      });
      setProject(updated);
      toast("设置已保存", "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    setError("");
    try {
      const result = await api.publishProject(projectId);
      await load();
      toast(`已发布，共 ${result.published_chapter_count} 章`, "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "发布失败");
    } finally {
      setPublishing(false);
    }
  }

  async function handleUnpublish() {
    setPublishing(true);
    setError("");
    try {
      await api.unpublishProject(projectId);
      await load();
      toast("已取消发布", "info");
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setPublishing(false);
    }
  }

  async function handleExportPdf() {
    if (!project) return;
    setExportingPdf(true);
    setError("");
    try {
      const blob = await api.exportProjectPdf(projectId);
      downloadBlob(blob, `${safeFilename(project.title)}.pdf`);
      toast("PDF 已生成", "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF 导出失败");
    } finally {
      setExportingPdf(false);
    }
  }

  async function handleCopyLink() {
    if (!project?.share_token) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast("分享链接已复制", "success");
    } catch {
      setError("复制失败，请手动复制链接");
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.deleteProject(projectId);
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <div className="mx-auto max-w-6xl px-5 pt-10 sm:px-8"><LoadingSpinner /></div>;
  if (!project) return <div className="mx-auto max-w-lg px-5 py-20 text-center text-[#667085]">{error || "项目不存在"}</div>;

  return (
    <main className="page-enter min-h-screen pb-24 md:pb-10">
      <div className="mx-auto max-w-6xl px-5 pt-7 sm:px-8 sm:pt-10">
        <header className="border-b border-[#dfe5eb] pb-7">
          <Link href={`/project/${projectId}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#667085] transition hover:text-[#1f2937]">
            <ArrowLeftIcon /> 返回章节
          </Link>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-[#0f766e]">项目管理</p>
              <h1 className="mt-2 text-3xl font-bold text-[#1f2937]">设置与发布</h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#667085]">调整这本自传的写作方式、采访边界，并在确认内容后分享给读者。</p>
            </div>
            <p className="text-sm text-[#667085]">{doneCount}/{totalCount} 章已完成</p>
          </div>
        </header>

        {error && <div className="mt-5 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.72fr)] lg:items-start">
          <form onSubmit={handleSave} className="order-2 space-y-5 lg:order-1">
            <section className="card p-5 sm:p-7">
              <SectionIntro icon={<TitleIcon />} title="基本信息" description="这本书如何被读者认识。" />
              <label htmlFor="project-title" className="mt-6 block text-sm font-medium text-[#344054]">自传标题</label>
              <input id="project-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="input mt-2 w-full text-base" />
            </section>

            <section className="card p-5 sm:p-7">
              <SectionIntro icon={<PenIcon />} title="写作风格" description="告诉 AI 正文希望呈现的语气。" />
              <textarea value={styleNotes} onChange={(e) => setStyleNotes(e.target.value)} rows={5} placeholder="例如：第一人称、温情真实、适合家人阅读" className="input mt-6 min-h-32 w-full resize-y text-base leading-relaxed" />
            </section>

            <section className="card p-5 sm:p-7">
              <SectionIntro icon={<MessageIcon />} title="采访与隐私偏好" description="控制追问重点、称呼方式和不希望出现的内容。" />
              <textarea value={preferenceNotes} onChange={(e) => setPreferenceNotes(e.target.value)} rows={5} placeholder="例如：多追问家庭细节；不要写真实姓名；语气朴素，不要太煽情" className="input mt-6 min-h-32 w-full resize-y text-base leading-relaxed" />
            </section>

            <section className="card p-5 sm:p-7">
              <SectionIntro icon={<MemoryIcon />} title="Agent 记忆" description="采访过程中自动提炼的长期偏好，您可以随时删改。" />
              <textarea value={memoryNotes} onChange={(e) => setMemoryNotes(e.target.value)} rows={6} placeholder="当 Agent 学到新的偏好时，会显示在这里。" className="input mt-6 min-h-40 w-full resize-y text-base leading-relaxed" />
            </section>

            <button type="submit" disabled={saving} className="btn-primary flex w-full items-center justify-center gap-2 py-3.5">
              {saving ? <SpinnerIcon /> : <SaveIcon />}
              {saving ? "正在保存..." : "保存所有设置"}
            </button>
          </form>

          <aside className="order-1 space-y-5 lg:order-2 lg:sticky lg:top-6">
            <section className="card p-5 sm:p-6">
              <SectionIntro icon={<PublishIcon />} title="发布与分享" description="发布前先检查每一章的质量。" />
              {publishReadiness && (
                <div className={`mt-6 rounded-xl border p-4 ${publishReadiness.ready ? "border-[#a7f3d0] bg-[#ecfdf5]" : "border-[#fedf89] bg-[#fffaeb]"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className={`text-sm font-semibold ${publishReadiness.ready ? "text-[#047857]" : "text-[#b54708]"}`}>{publishReadiness.ready ? "可以发布" : "还需要处理"}</p>
                      <p className={`mt-1 text-xs leading-relaxed ${publishReadiness.ready ? "text-[#047857]" : "text-[#b54708]"}`}>{publishReadiness.message}</p>
                    </div>
                    <span className={`shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold ${publishReadiness.ready ? "text-[#047857]" : "text-[#b54708]"}`}>{publishReadiness.publishable_chapter_count} 章</span>
                  </div>
                  {publishReadiness.chapters.length > 0 && (
                    <ul className="mt-4 space-y-2">
                      {publishReadiness.chapters.slice(0, 5).map((chapter) => (
                        <li key={chapter.chapter_id} className="rounded-lg border border-white/80 bg-white/75 px-3 py-2.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="line-clamp-1 font-medium text-[#344054]">第{chapter.order}章 · {chapter.title}</span>
                            <span className={qualityColor(chapter.quality_status)}>{chapter.quality_score}/5</span>
                          </div>
                          {chapter.risks[0] && <p className="mt-1 line-clamp-2 leading-relaxed text-[#667085]">{chapter.risks[0]}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {project.is_published && project.share_token ? (
                <div className="mt-5 space-y-3">
                  <div className="rounded-xl border border-[#dfe5eb] bg-[#f7f8fa] p-3.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#98a2b3]">分享链接</p>
                    <p className="mt-1 break-all text-sm leading-relaxed text-[#0f766e]">{shareUrl}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={handleCopyLink} className="btn-primary py-3 text-sm">{copied ? "已复制" : "复制链接"}</button>
                    <Link href={`/share/${project.share_token}`} target="_blank" className="btn-outline flex items-center justify-center py-3 text-sm">预览分享页</Link>
                  </div>
                  <div className="grid grid-cols-2 gap-2 border-t border-[#eaecf0] pt-3">
                    <button type="button" onClick={handlePublish} disabled={publishDisabled} className="rounded-xl border border-[#a7f3d0] py-2.5 text-sm font-medium text-[#0f9d73] transition hover:bg-[#ecfdf5] disabled:opacity-40">更新发布</button>
                    <button type="button" onClick={handleUnpublish} disabled={publishing} className="btn-outline py-2.5 text-sm">取消发布</button>
                  </div>
                  <button type="button" onClick={handleExportPdf} disabled={exportingPdf || !canPublish} className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-sm disabled:opacity-50">
                    {exportingPdf ? <SpinnerIcon /> : <PdfIcon />} {exportingPdf ? "AI 正在排版..." : "AI 排版并下载 PDF"}
                  </button>
                </div>
              ) : (
                <div className="mt-5 space-y-2">
                  <button type="button" onClick={handlePublish} disabled={publishDisabled} className="btn-primary flex w-full items-center justify-center gap-2 py-3.5">
                    <PublishIcon /> {publishLabel}
                  </button>
                  <button type="button" onClick={handleExportPdf} disabled={exportingPdf || !canPublish} className="btn-outline flex w-full items-center justify-center gap-2 py-3 text-sm disabled:opacity-50">
                    {exportingPdf ? <SpinnerIcon /> : <PdfIcon />} {exportingPdf ? "AI 正在排版..." : "AI 排版并下载 PDF"}
                  </button>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-[#fecaca] bg-[#fffafa] p-5 sm:p-6">
              <p className="text-sm font-semibold text-[#b42318]">危险操作</p>
              <p className="mt-1 text-xs leading-relaxed text-[#667085]">删除项目会永久移除所有章节、采访记录和修改历史。</p>
              {showDeleteConfirm ? (
                <div className="mt-4 space-y-3">
                  <p className="text-sm font-medium text-[#b42318]">确定删除「{project.title}」吗？</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={handleDelete} disabled={deleting} className="rounded-xl bg-[#dc5b5b] py-3 text-sm font-medium text-white transition hover:bg-[#b42318] disabled:opacity-50">{deleting ? "删除中..." : "确认删除"}</button>
                    <button type="button" onClick={() => setShowDeleteConfirm(false)} disabled={deleting} className="btn-outline py-3 text-sm">取消</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setShowDeleteConfirm(true)} className="mt-4 w-full rounded-xl border border-[#fecaca] py-3 text-sm font-medium text-[#b42318] transition hover:bg-[#fef2f2]">删除项目</button>
              )}
            </section>
          </aside>
        </div>
      </div>
      <BottomNav projectId={projectId} activeChapterId={project.chapters[0]?.id} />
    </main>
  );
}

function buildShareUrl(token: string): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/share/${token}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function safeFilename(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 48) || "autobiography";
}

function qualityColor(status: "good" | "needs_review" | "risky"): string {
  return status === "good" ? "font-semibold text-[#047857]" : status === "needs_review" ? "font-semibold text-[#b54708]" : "font-semibold text-[#b42318]";
}

function SectionIntro({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f0fdfa] text-[#0f766e]">{icon}</div>
      <div>
        <h2 className="font-semibold text-[#1f2937]">{title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-[#667085]">{description}</p>
      </div>
    </div>
  );
}

function ArrowLeftIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>;
}

function MemoryIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7a3 3 0 013-3h10a3 3 0 013 3v10a3 3 0 01-3 3H7a3 3 0 01-3-3z" /><path d="M8 8h8M8 12h5M8 16h8" /></svg>;
}

function MessageIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>;
}

function PenIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>;
}

function PublishIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 16V3M7 8l5-5 5 5M5 21h14" /></svg>;
}

function PdfIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V7z" /><path d="M14 2v5h5M8 13h8M8 17h5" /></svg>;
}

function SaveIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 4h12l2 2v14H5zM8 4v5h8V4M8 20v-6h8v6" /></svg>;
}

function SpinnerIcon() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />;
}

function TitleIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h10M4 18h7" /></svg>;
}
