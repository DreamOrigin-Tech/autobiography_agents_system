"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, streamWriteChapter } from "@/lib/api";
import type { ChapterDetail, ChapterQuality, EditPreview, ProjectDetail, Revision, WriteReadiness } from "@/lib/types";
import { BottomNav } from "@/components/BottomNav";
import { ChapterSidebar } from "@/components/ChapterSidebar";
import { DiffPreview } from "@/components/DiffPreview";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { MarkdownContent } from "@/components/MarkdownContent";

type ViewMode = "read" | "manual";
const MANUAL_DRAFT_PREFIX = "chapter_manual_draft:";
const EDIT_INSTRUCTION_PREFIX = "chapter_edit_instruction:";

function ChapterEditorContent() {
  const params = useParams(); const searchParams = useSearchParams();
  const projectId = params.id as string; const chapterId = params.chapterId as string;
  const shouldWrite = searchParams.get("writing") === "1";
  const manualDraftKey = `${MANUAL_DRAFT_PREFIX}${chapterId}`;
  const instructionDraftKey = `${EDIT_INSTRUCTION_PREFIX}${chapterId}`;

  const [chapter, setChapter] = useState<ChapterDetail | null>(null);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true); const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState(""); const [instruction, setInstruction] = useState("");
  const [preview, setPreview] = useState<EditPreview | null>(null); const [revisions, setRevisions] = useState<Revision[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("read"); const [manualDraft, setManualDraft] = useState("");
  const [manualDraftRestored, setManualDraftRestored] = useState(false);
  const [instructionDraftRestored, setInstructionDraftRestored] = useState(false);
  const [readiness, setReadiness] = useState<WriteReadiness | null>(null);
  const [quality, setQuality] = useState<ChapterQuality | null>(null);

  const load = useCallback(async () => {
    try {
      const [ch, revs, proj, ready] = await Promise.all([
        api.getChapter(chapterId),
        api.listRevisions(chapterId),
        api.getProject(projectId),
        api.getWriteReadiness(chapterId),
      ]);
      setChapter(ch); setRevisions(revs); setProject(proj); setReadiness(ready);
      if (ch.content_md) {
        setQuality(await api.getChapterQuality(chapterId));
      } else {
        setQuality(null);
      }
    }
    catch (e) { setError(e instanceof Error ? e.message : "加载失败"); } finally { setLoading(false); }
  }, [chapterId, projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedInstruction = window.localStorage.getItem(instructionDraftKey);
      if (savedInstruction) {
        setInstruction(savedInstruction);
        setInstructionDraftRestored(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [instructionDraftKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft = instruction.trim();
      if (draft) {
        window.localStorage.setItem(instructionDraftKey, instruction);
      } else {
        window.localStorage.removeItem(instructionDraftKey);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [instruction, instructionDraftKey]);

  useEffect(() => {
    if (viewMode !== "manual") return;
    const timer = window.setTimeout(() => {
      const baseline = chapter?.content_md || "";
      if (manualDraft && manualDraft !== baseline) {
        window.localStorage.setItem(manualDraftKey, manualDraft);
      } else {
        window.localStorage.removeItem(manualDraftKey);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [chapter?.content_md, manualDraft, manualDraftKey, viewMode]);

  useEffect(() => {
    if (!shouldWrite || !chapter || chapter.content_md) return;
    if (!readiness) return;
    let close: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      if (!readiness.ready) {
        setError(readiness.message);
        return;
      }
      setStreaming(true); setStreamContent("");
      close = streamWriteChapter(chapterId, (t) => setStreamContent((p) => p + t), () => { setStreaming(false); load(); }, (m) => { setError(m); setStreaming(false); });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      close?.();
    };
  }, [shouldWrite, chapter, chapterId, load, readiness]);

  function enterManualEdit() {
    const savedDraft = window.localStorage.getItem(manualDraftKey);
    setManualDraft(savedDraft || chapter?.content_md || streamContent || "");
    setManualDraftRestored(Boolean(savedDraft));
    setViewMode("manual"); setPreview(null); setInstruction(""); setInstructionDraftRestored(false); setError("");
  }
  function cancelManualEdit() {
    window.localStorage.removeItem(manualDraftKey);
    setViewMode("read"); setManualDraft(""); setManualDraftRestored(false); setError("");
  }

  async function saveManualEdit() { setBusy(true); setError("");
    try { const u = await api.updateChapter(chapterId, manualDraft); window.localStorage.removeItem(manualDraftKey); setChapter(u); setQuality(u.content_md ? await api.getChapterQuality(chapterId) : null); setViewMode("read"); setManualDraft(""); setManualDraftRestored(false); setRevisions(await api.listRevisions(chapterId)); }
    catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } finally { setBusy(false); }
  }
  async function handlePreviewEdit() { if (!instruction.trim()) return; setBusy(true); setError("");
    try { setPreview(await api.previewEdit(chapterId, instruction.trim())); }
    catch (e) { setError(e instanceof Error ? e.message : "生成修改预览失败"); } finally { setBusy(false); }
  }
  async function handleApplyEdit() { if (!preview) return; setBusy(true);
    try { const u = await api.applyEdit(chapterId, preview.revision_id); window.localStorage.removeItem(instructionDraftKey); setChapter(u); setQuality(u.content_md ? await api.getChapterQuality(chapterId) : null); setPreview(null); setInstruction(""); setInstructionDraftRestored(false); setRevisions(await api.listRevisions(chapterId)); }
    catch (e) { setError(e instanceof Error ? e.message : "应用修改失败"); } finally { setBusy(false); }
  }
  async function handleRollback(rid: string) { setBusy(true);
    try { const u = await api.rollbackRevision(chapterId, rid); setChapter(u); setQuality(u.content_md ? await api.getChapterQuality(chapterId) : null); setRevisions(await api.listRevisions(chapterId)); }
    catch (e) { setError(e instanceof Error ? e.message : "回滚失败"); } finally { setBusy(false); }
  }
  async function handleWrite() {
    if (readiness && !readiness.ready) {
      setError(readiness.message);
      return;
    }
    setStreaming(true); setStreamContent("");
    streamWriteChapter(chapterId, (t) => setStreamContent((p) => p + t), () => { setStreaming(false); load(); }, (m) => { setError(m); setStreaming(false); });
  }

  const displayContent = streaming ? streamContent : chapter?.content_md || "";
  const hasContent = Boolean(displayContent);
  const manualDirty = manualDraft !== (chapter?.content_md || "");

  if (loading) return <LoadingSpinner label="加载章节..." />;
  if (!chapter) return (<div className="mx-auto max-w-lg px-5 py-20 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#dfe5eb] bg-white text-[#0f766e]">▤</div><p className="mt-4 text-[#667085]">章节不存在</p></div>);

  return (
    <main className="page-enter mx-auto flex min-h-screen max-w-6xl">
      {project && viewMode === "read" && <ChapterSidebar projectId={projectId} chapters={project.chapters} activeChapterId={chapterId} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-[#dfe5eb] bg-white/95 px-5 py-4 backdrop-blur-xl sm:px-7">
          <Link href={`/project/${projectId}`} className="inline-flex items-center gap-1 text-xs font-medium text-[#667085] transition hover:text-[#0f766e]">
            <ArrowLeftIcon /> 章节列表
          </Link>
          <div className="mt-1 flex items-center justify-between gap-3">
            <h1 className="min-w-0 truncate text-lg font-semibold text-[#1f2937]"><span className="text-[#98a2b3]">第 {chapter.order} 章</span> · {chapter.title}</h1>
            {!streaming && (
              <div className="flex shrink-0 rounded-lg border border-[#dfe5eb] bg-[#f7f8fa] p-0.5">
                <button onClick={() => setViewMode("read")} className={`flex items-center gap-1 rounded-md px-3.5 py-1.5 text-xs font-medium transition-all ${viewMode === "read" ? "bg-white text-[#1f2937] shadow-sm" : "text-[#98a2b3] hover:text-[#667085]"}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>阅读
                </button>
                <button onClick={enterManualEdit} className={`flex items-center gap-1 rounded-md px-3.5 py-1.5 text-xs font-medium transition-all ${viewMode === "manual" ? "bg-white text-[#1f2937] shadow-sm" : "text-[#98a2b3] hover:text-[#667085]"}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>编辑
                </button>
              </div>
            )}
          </div>
        </header>

        <div className={`mx-auto w-full max-w-3xl px-5 py-6 sm:px-7 ${viewMode === "manual" ? "pb-36" : "pb-52"}`}>
          {error && <div className="mb-5 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}

          {viewMode === "manual" ? (
            <div className="animate-fade-up space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-[#98a2b3]">直接编辑正文，段落之间空一行，支持 Markdown。</p>
                <span className="shrink-0 text-xs text-[#98a2b3]">{manualDraftRestored ? "已恢复未保存草稿" : manualDirty ? "草稿已自动保存" : ""}</span>
              </div>
              <textarea value={manualDraft} onChange={(e) => { setManualDraft(e.target.value); setManualDraftRestored(false); }} placeholder="在此撰写或修改章节内容..." autoFocus
                className="min-h-[70vh] w-full resize-y rounded-2xl border border-[#dfe5eb] bg-white px-6 py-5 text-base leading-relaxed text-[#1f2937] outline-none transition focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/10 font-serif" />
              <p className="text-right text-xs text-[#98a2b3]">{manualDraft.length} 字</p>
            </div>
          ) : (
            <>
              {!hasContent && !streaming && (
                <div className="animate-fade-up rounded-2xl border border-dashed border-[#b8dcd7] bg-[#f7f8fa] p-8 text-center sm:p-12">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white text-[#0f766e] shadow-sm">✎</div>
                  <p className="mt-4 font-medium text-[#344054]">本章尚未撰写</p>
                  <p className="mt-1 text-sm text-[#98a2b3]">{readiness?.ready ? "采访素材已较充分，可以让 AI 动笔" : "先采访收集素材，正文会更真实可靠"}</p>
                  {readiness && (
                    <div className="mt-5 rounded-xl border border-[#dfe5eb] bg-white p-4 text-left">
                      <div className="flex items-center justify-between text-xs font-medium text-[#667085]">
                        <span>素材进度</span>
                        <span>{readiness.user_answers}/{readiness.min_user_answers} 轮 · {readiness.user_chars}/{readiness.min_user_chars} 字</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#dfe5eb]">
                        <div className={`h-full rounded-full transition-all ${readiness.ready ? "bg-[#0f9d73]" : "bg-[#0f766e]"}`} style={{ width: `${Math.min(100, Math.min(readiness.user_answers / readiness.min_user_answers, readiness.user_chars / readiness.min_user_chars) * 100)}%` }} />
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-[#667085]">{readiness.message}</p>
                    </div>
                  )}
                  <div className="mt-6 space-y-2.5">
                    <Link href={`/project/${projectId}/interview/${chapterId}`} className={`flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition ${readiness?.ready ? "border border-[#dfe5eb] bg-white text-[#1f2937] hover:bg-[#f7f8fa]" : "bg-[#0f766e] text-white shadow-[0_4px_12px_-2px_rgba(15,118,110,0.25)]"}`}><MessageIcon /> 继续采访</Link>
                    <button onClick={handleWrite} disabled={!readiness?.ready} className="btn-primary flex w-full items-center justify-center gap-2 py-3 text-sm"><SparkIcon /> AI 开始写作</button>
                    <button onClick={enterManualEdit} className="btn-outline flex w-full items-center justify-center gap-2 py-3 text-sm"><PenIcon /> 手动撰写</button>
                  </div>
                </div>
              )}
              {(hasContent || streaming) && (
                <MarkdownContent content={displayContent} streaming={streaming} />
              )}
              {quality && !streaming && (
                <section className="mt-8 rounded-2xl border border-[#dfe5eb] bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-[#1f2937]">草稿质量检查</h2>
                      <p className="mt-1 text-xs leading-relaxed text-[#667085]">{quality.message}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${quality.status === "good" ? "bg-[#ecfdf5] text-[#047857]" : quality.status === "needs_review" ? "bg-[#fffbeb] text-[#b45309]" : "bg-[#fef2f2] text-[#dc2626]"}`}>
                      {quality.score}/{quality.max_score}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {quality.checks.map((check) => (
                      <div key={check.name} className="rounded-xl bg-[#f7f8fa] px-3 py-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-[#1f2937]">
                          <span className={check.passed ? "text-[#0f9d73]" : "text-[#ef4444]"}>{check.passed ? "✓" : "!"}</span>
                          <span>{check.name}</span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-[#667085]">{check.detail}</p>
                      </div>
                    ))}
                  </div>
                  {quality.suggestions.length > 0 && (
                    <div className="mt-3 rounded-xl bg-[#fefce8] px-3 py-2">
                      <p className="text-xs font-medium text-[#854d0e]">建议下一步</p>
                      <ul className="mt-1 space-y-1 text-xs leading-relaxed text-[#713f12]">
                        {quality.suggestions.slice(0, 3).map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                  )}
                </section>
              )}
              {preview && (
                <div className="animate-fade-up mt-6 space-y-3">
                  <DiffPreview before={preview.content_before} after={preview.content_after} />
                  <div className="flex gap-2">
                    <button onClick={handleApplyEdit} disabled={busy} className="flex-1 rounded-xl bg-[#0f9d73] py-3 font-medium text-white transition hover:bg-[#087f5b] disabled:opacity-50">✓ 确认修改</button>
                    <button onClick={() => setPreview(null)} className="btn-outline rounded-xl px-5 py-3">取消</button>
                  </div>
                </div>
              )}
              {revisions.length > 0 && (
                <section className="mt-10">
                  <h2 className="flex items-center gap-2 text-sm font-medium text-[#98a2b3]"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>修改历史</h2>
                  <ul className="mt-3 space-y-1.5">
                    {revisions.map((rev) => (
                      <li key={rev.id} className="flex items-center justify-between rounded-xl bg-white px-4 py-2.5 text-sm shadow-sm">
                        <span className="line-clamp-1 flex-1 text-[#1f2937]">{rev.instruction}</span>
                        <span className="ml-2 shrink-0 text-[11px] text-[#98a2b3]">{new Date(rev.created_at).toLocaleDateString("zh-CN")}</span>
                        {rev.applied && <button onClick={() => handleRollback(rev.id)} disabled={busy} className="ml-2 shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-[#ef4444] transition hover:bg-[#fef2f2]">回滚</button>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        {viewMode === "manual" && (
          <div className="fixed bottom-16 inset-x-0 z-20 border-t border-[#dfe5eb] bg-white/95 px-5 py-3 backdrop-blur-xl md:bottom-0 md:left-0">
            <div className="flex gap-2">
              <button onClick={cancelManualEdit} disabled={busy} className="btn-outline flex-1 py-3">取消</button>
              <button onClick={saveManualEdit} disabled={busy || !manualDirty} className="btn-primary flex-1 py-3">{busy ? "保存中..." : "保存修改"}</button>
            </div>
          </div>
        )}
        {viewMode === "read" && hasContent && !streaming && (
          <div className="fixed bottom-16 inset-x-0 z-20 border-t border-[#dfe5eb] bg-white/95 px-5 py-3 backdrop-blur-xl md:bottom-0 md:left-72">
            {(instructionDraftRestored || instruction.trim().length > 0) && (
              <p className="mb-2 text-xs text-[#98a2b3]">{instructionDraftRestored ? "已恢复上次未提交的修改要求" : "修改要求已自动保存"}</p>
            )}
            <div className="flex gap-2">
              <input type="text" value={instruction} onChange={(e) => { setInstruction(e.target.value); setInstructionDraftRestored(false); }} onKeyDown={(e) => e.key === "Enter" && handlePreviewEdit()} placeholder="让 AI 帮你修改，如：把第二段写得更温情..." className="input flex-1 rounded-full text-sm" />
              <button onClick={handlePreviewEdit} aria-label="生成修改预览" disabled={busy || !instruction.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1f2937] text-white transition hover:bg-black disabled:opacity-30 active:scale-90"><EditIcon /></button>
            </div>
          </div>
        )}
        <BottomNav projectId={projectId} activeChapterId={chapterId} />
      </div>
    </main>
  );
}

export default function ChapterEditorPage() { return (<Suspense fallback={<LoadingSpinner />}><ChapterEditorContent /></Suspense>); }

function ArrowLeftIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>;
}

function EditIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>;
}

function MessageIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>;
}

function PenIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m13 6 5 5M4 20l4-1 10-10a2.1 2.1 0 00-3-3L5 16l-1 4z" /></svg>;
}

function SparkIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m12 3-1.4 5.6L5 10l5.6 1.4L12 17l1.4-5.6L19 10l-5.6-1.4L12 3z" /><path d="m19 16-.7 2.3L16 19l2.3.7L19 22l.7-2.3L22 19l-2.3-.7L19 16z" /></svg>;
}
