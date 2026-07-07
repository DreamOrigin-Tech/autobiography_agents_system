"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, streamWriteChapter } from "@/lib/api";
import type { ChapterDetail, EditPreview, ProjectDetail, Revision } from "@/lib/types";
import { BottomNav } from "@/components/BottomNav";
import { ChapterSidebar } from "@/components/ChapterSidebar";
import { DiffPreview } from "@/components/DiffPreview";
import { LoadingSpinner } from "@/components/LoadingSpinner";

type ViewMode = "read" | "manual";

function ChapterEditorContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.id as string;
  const chapterId = params.chapterId as string;
  const shouldWrite = searchParams.get("writing") === "1";

  const [chapter, setChapter] = useState<ChapterDetail | null>(null);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [instruction, setInstruction] = useState("");
  const [preview, setPreview] = useState<EditPreview | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("read");
  const [manualDraft, setManualDraft] = useState("");

  const load = useCallback(async () => {
    try {
      const [ch, revs, proj] = await Promise.all([
        api.getChapter(chapterId),
        api.listRevisions(chapterId),
        api.getProject(projectId),
      ]);
      setChapter(ch);
      setRevisions(revs);
      setProject(proj);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [chapterId, projectId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!shouldWrite || !chapter || chapter.content_md) return;
    setStreaming(true);
    setStreamContent("");
    const close = streamWriteChapter(
      chapterId,
      (token) => setStreamContent((prev) => prev + token),
      () => { setStreaming(false); load(); },
      (msg) => { setError(msg); setStreaming(false); },
    );
    return close;
  }, [shouldWrite, chapter, chapterId, load]);

  function enterManualEdit() { setManualDraft(chapter?.content_md || streamContent || ""); setViewMode("manual"); setPreview(null); setInstruction(""); setError(""); }
  function cancelManualEdit() { setViewMode("read"); setManualDraft(""); setError(""); }

  async function saveManualEdit() {
    setBusy(true); setError("");
    try {
      const updated = await api.updateChapter(chapterId, manualDraft);
      setChapter(updated); setViewMode("read"); setManualDraft("");
      const revs = await api.listRevisions(chapterId);
      setRevisions(revs);
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function handlePreviewEdit() {
    if (!instruction.trim()) return;
    setBusy(true); setError("");
    try {
      const result = await api.previewEdit(chapterId, instruction.trim());
      setPreview(result);
    } catch (e) { setError(e instanceof Error ? e.message : "生成修改预览失败"); }
    finally { setBusy(false); }
  }

  async function handleApplyEdit() {
    if (!preview) return;
    setBusy(true);
    try {
      const updated = await api.applyEdit(chapterId, preview.revision_id);
      setChapter(updated); setPreview(null); setInstruction("");
      const revs = await api.listRevisions(chapterId);
      setRevisions(revs);
    } catch (e) { setError(e instanceof Error ? e.message : "应用修改失败"); }
    finally { setBusy(false); }
  }

  async function handleRollback(revisionId: string) {
    setBusy(true);
    try {
      const updated = await api.rollbackRevision(chapterId, revisionId);
      setChapter(updated);
      const revs = await api.listRevisions(chapterId);
      setRevisions(revs);
    } catch (e) { setError(e instanceof Error ? e.message : "回滚失败"); }
    finally { setBusy(false); }
  }

  async function handleWrite() {
    setStreaming(true); setStreamContent("");
    streamWriteChapter(chapterId,
      (token) => setStreamContent((prev) => prev + token),
      () => { setStreaming(false); load(); },
      (msg) => { setError(msg); setStreaming(false); },
    );
  }

  const displayContent = streaming ? streamContent : chapter?.content_md || "";
  const hasContent = Boolean(displayContent);
  const manualDirty = manualDraft !== (chapter?.content_md || "");

  if (loading) return <LoadingSpinner label="加载章节..." />;

  if (!chapter) {
    return (
      <div className="py-16 text-center">
        <p className="text-4xl">📄</p>
        <p className="mt-3 text-[#7a7265]">章节不存在</p>
      </div>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl">
      {project && viewMode === "read" && (
        <ChapterSidebar projectId={projectId} chapters={project.chapters} activeChapterId={chapterId} />
      )}
      <div className="mx-auto w-full max-w-lg md:max-w-none md:flex-1">
        <header className="sticky top-0 z-10 border-b border-[#e7dfd4] bg-white/90 px-5 py-3.5 backdrop-blur-xl">
          <Link href={`/project/${projectId}`} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium text-[#7a7265] transition-all hover:bg-white hover:text-[#2c2416] hover:shadow-sm active:scale-95">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
            章节列表
          </Link>
          <div className="mt-1 flex items-center justify-between gap-3">
            <h1 className="text-lg font-semibold text-[#2c2416]">
              <span className="text-[#b8a892]">第 {chapter.order} 章</span> · {chapter.title}
            </h1>
            {!streaming && (
              <div className="flex shrink-0 rounded-lg bg-[#f5f0e9] p-0.5">
                <button onClick={() => setViewMode("read")}
                  className={`flex items-center gap-1 rounded-md px-3.5 py-1.5 text-xs font-medium transition-all ${viewMode === "read" ? "bg-white text-[#2c2416] shadow-sm" : "text-[#b8a892] hover:text-[#7a7265]"}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></svg>
                  阅读
                </button>
                <button onClick={enterManualEdit}
                  className={`flex items-center gap-1 rounded-md px-3.5 py-1.5 text-xs font-medium transition-all ${viewMode === "manual" ? "bg-white text-[#2c2416] shadow-sm" : "text-[#b8a892] hover:text-[#7a7265]"}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                  编辑
                </button>
              </div>
            )}
          </div>
        </header>

        <div className={`px-5 py-5 ${viewMode === "manual" ? "pb-36" : "pb-52"}`}>
          {error && (
            <div className="mb-5 rounded-xl border border-[#f0d0d0] bg-[#fef5f5] px-4 py-3 text-sm text-[#c25b56]">{error}</div>
          )}

          {viewMode === "manual" ? (
            <div className="animate-fade-up space-y-3">
              <p className="text-sm text-[#b8a892]">直接编辑正文，段落之间空一行，支持 Markdown。</p>
              <textarea
                value={manualDraft}
                onChange={(e) => setManualDraft(e.target.value)}
                placeholder="在此撰写或修改章节内容..."
                className="min-h-[70vh] w-full resize-y rounded-2xl border border-[#e7dfd4] bg-white px-6 py-5 text-base leading-relaxed text-[#2c2416] outline-none transition focus:border-[#8b5e3c] focus:ring-2 focus:ring-[#8b5e3c]/10 font-serif"
                autoFocus
              />
              <p className="text-right text-xs text-[#b8a892]">{manualDraft.length} 字</p>
            </div>
          ) : (
            <>
              {!hasContent && !streaming && (
                <div className="animate-fade-up rounded-2xl border-2 border-dashed border-[#e7dfd4] p-10 text-center">
                  <span className="text-5xl">📝</span>
                  <p className="mt-3 text-[#7a7265]">本章尚未撰写</p>
                  <p className="mt-1 text-sm text-[#b8a892]">先采访收集素材，或直接让 AI 动笔</p>
                  <div className="mt-6 space-y-2.5">
                    <Link href={`/project/${projectId}/interview/${chapterId}`}
                      className="block rounded-xl border border-[#e7dfd4] bg-white py-3 text-sm font-medium text-[#2c2416] transition hover:bg-[#f5f0e9]">
                      💬 先去采访
                    </Link>
                    <button onClick={handleWrite}
                      className="block w-full rounded-xl bg-[#8b5e3c] py-3 text-sm font-medium text-white transition hover:bg-[#6d4a30]">
                      ✨ AI 开始写作
                    </button>
                    <button onClick={enterManualEdit}
                      className="block w-full rounded-xl border border-[#e7dfd4] py-3 text-sm font-medium text-[#7a7265] transition hover:bg-[#f5f0e9]">
                      ✍️ 手动撰写
                    </button>
                  </div>
                </div>
              )}

              {(hasContent || streaming) && (
                <article className="prose-chapter whitespace-pre-wrap">
                  {displayContent}
                  {streaming && <span className="ml-0.5 inline-block h-5 w-1.5 animate-pulse rounded-full bg-[#8b5e3c] align-middle" />}
                </article>
              )}

              {preview && (
                <div className="animate-fade-up mt-6 space-y-3">
                  <DiffPreview before={preview.content_before} after={preview.content_after} />
                  <div className="flex gap-2">
                    <button onClick={handleApplyEdit} disabled={busy}
                      className="flex-1 rounded-xl bg-[#52796f] py-3 font-medium text-white transition hover:bg-[#3d6158] disabled:opacity-50">
                      ✓ 确认修改
                    </button>
                    <button onClick={() => setPreview(null)}
                      className="rounded-xl border border-[#e7dfd4] bg-white px-5 py-3 font-medium text-[#7a7265] transition hover:bg-[#f5f0e9]">
                      取消
                    </button>
                  </div>
                </div>
              )}

              {revisions.length > 0 && (
                <section className="mt-10">
                  <h2 className="flex items-center gap-2 text-sm font-medium text-[#b8a892]">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                    修改历史
                  </h2>
                  <ul className="mt-3 space-y-1.5">
                    {revisions.map((rev) => (
                      <li key={rev.id} className="flex items-center justify-between rounded-xl bg-white px-4 py-2.5 text-sm shadow-sm">
                        <span className="line-clamp-1 flex-1 text-[#2c2416]">{rev.instruction}</span>
                        <span className="ml-2 shrink-0 text-[11px] text-[#b8a892]">
                          {new Date(rev.created_at).toLocaleDateString("zh-CN")}
                        </span>
                        {rev.applied && (
                          <button onClick={() => handleRollback(rev.id)} disabled={busy}
                            className="ml-2 shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-[#c25b56] transition hover:bg-[#fef5f5]">
                            回滚
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        {viewMode === "manual" && (
          <div className="fixed bottom-16 inset-x-0 z-20 mx-auto max-w-lg border-t border-[#e7dfd4] bg-white/90 px-5 py-3 backdrop-blur-xl">
            <div className="flex gap-2">
              <button onClick={cancelManualEdit} disabled={busy} className="flex-1 rounded-xl border border-[#e7dfd4] py-3 font-medium text-[#7a7265] transition hover:bg-[#f5f0e9]">取消</button>
              <button onClick={saveManualEdit} disabled={busy || !manualDirty} className="flex-1 rounded-xl bg-[#8b5e3c] py-3 font-medium text-white transition hover:bg-[#6d4a30] disabled:opacity-40">
                {busy ? "保存中..." : "保存修改"}
              </button>
            </div>
          </div>
        )}

        {viewMode === "read" && hasContent && !streaming && (
          <div className="fixed bottom-16 inset-x-0 z-20 mx-auto max-w-lg border-t border-[#e7dfd4] bg-white/90 px-5 py-3 backdrop-blur-xl">
            <div className="flex gap-2">
              <input
                type="text"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handlePreviewEdit()}
                placeholder="让 AI 帮你修改，如：把第二段改得更温情..."
                className="flex-1 rounded-full border border-[#e7dfd4] bg-[#fbf7f2] px-4 py-2.5 text-sm outline-none transition focus:border-[#8b5e3c] focus:bg-white focus:ring-2 focus:ring-[#8b5e3c]/10"
              />
              <button onClick={handlePreviewEdit} disabled={busy || !instruction.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2c2416] text-white transition hover:bg-black disabled:opacity-30 active:scale-90">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </button>
            </div>
          </div>
        )}

        <BottomNav projectId={projectId} activeChapterId={chapterId} />
      </div>
    </main>
  );
}

export default function ChapterEditorPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ChapterEditorContent />
    </Suspense>
  );
}
