"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import type { ProjectDetail } from "@/lib/types";
import { BottomNav } from "@/components/BottomNav";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { useToast } from "@/components/Toast";

export default function ProjectSettingsPage() {
  const params = useParams(); const router = useRouter();
  const projectId = params.id as string;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [title, setTitle] = useState(""); const [styleNotes, setStyleNotes] = useState("");
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false); const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const { toast } = useToast();

  const load = useCallback(async () => {
    try { const data = await api.getProject(projectId); setProject(data); setTitle(data.title); setStyleNotes(data.style_notes || ""); }
    catch (e) { setError(e instanceof Error ? e.message : "加载失败"); } finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const doneCount = project?.chapters.filter((c) => c.status === "done").length ?? 0;

  function buildShareUrl(token: string) { if (typeof window === "undefined") return ""; return `${window.location.origin}/share/${token}`; }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError("");
    try { const u = await api.updateProject(projectId, { title: title.trim(), style_notes: styleNotes.trim() }); setProject(u); toast("已保存", "success"); }
    catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } finally { setSaving(false); }
  }
  async function handlePublish() { setPublishing(true); setError("");
    try { const r = await api.publishProject(projectId); await load(); toast(`已发布，共 ${r.published_chapter_count} 章`, "success"); }
    catch (e) { setError(e instanceof Error ? e.message : "发布失败"); } finally { setPublishing(false); }
  }
  async function handleUnpublish() { setPublishing(true); setError("");
    try { await api.unpublishProject(projectId); await load(); toast("已取消发布", "info"); }
    catch (e) { setError(e instanceof Error ? e.message : "操作失败"); } finally { setPublishing(false); }
  }
  async function handleCopyLink() {
    if (!project?.share_token) return;
    try { await navigator.clipboard.writeText(buildShareUrl(project.share_token)); setCopied(true); setTimeout(() => setCopied(false), 2000); toast("链接已复制", "success"); }
    catch { setError("复制失败，请手动复制链接"); }
  }
  async function handleDelete() { setDeleting(true);
    try { await api.deleteProject(projectId); router.push("/"); }
    catch (e) { setError(e instanceof Error ? e.message : "删除失败"); setShowDeleteConfirm(false); } finally { setDeleting(false); }
  }

  const activeChapter = project?.chapters[0];
  const shareUrl = project?.share_token ? buildShareUrl(project.share_token) : "";

  if (loading) return (<div className="mx-auto max-w-lg px-5 pt-10"><LoadingSpinner /></div>);

  return (
    <main className="page-enter mx-auto min-h-screen max-w-lg px-5 pb-28 pt-6">
      <header className="mb-6">
        <Link href={`/project/${projectId}`} className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-[#6b6889] shadow-sm transition-all hover:text-[#1e1b4b] hover:shadow-md active:scale-95"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>项目</Link>
        <h1 className="mt-2 text-2xl font-bold text-[#1e1b4b]">项目设置</h1>
      </header>

      {error && <div className="mb-4 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#ef4444]">{error}</div>}
      {message && <div className="mb-4 rounded-xl border border-[#a7f3d0] bg-[#ecfdf5] px-4 py-3 text-sm text-[#065f46]">{message}</div>}

      <section className="card mb-6 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eef2ff]"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" /></svg></div>
          <div><h2 className="font-semibold text-[#1e1b4b]">发布与分享</h2><p className="text-sm text-[#a5a0c8]">已完成 {doneCount}/{project?.chapters.length ?? 0} 章</p></div>
        </div>
        {project?.is_published && project.share_token ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl bg-[#f8f7ff] p-3.5"><p className="text-[11px] font-medium uppercase tracking-wide text-[#a5a0c8]">分享链接</p><p className="mt-1 break-all text-sm text-[#6366f1]">{shareUrl}</p></div>
            <div className="flex gap-2">
              <button onClick={handleCopyLink} className="btn-primary flex-1 py-3 text-sm">{copied ? "✓ 已复制" : "复制链接"}</button>
              <Link href={`/share/${project.share_token}`} target="_blank" className="btn-outline flex-1 py-3 text-center text-sm">预览</Link>
            </div>
            <div className="flex gap-2">
              <button onClick={handlePublish} disabled={publishing || doneCount === 0} className="flex-1 rounded-xl border border-[#a7f3d0] py-2.5 text-sm font-medium text-[#10b981] transition hover:bg-[#ecfdf5] disabled:opacity-40">更新发布</button>
              <button onClick={handleUnpublish} disabled={publishing} className="btn-outline rounded-xl px-4 py-2.5 text-sm">取消发布</button>
            </div>
          </div>
        ) : (
          <button onClick={handlePublish} disabled={publishing || doneCount === 0} className="btn-primary mt-4 w-full py-3.5">{publishing ? "发布中..." : "✦ 发布自传"}</button>
        )}
      </section>

      <form onSubmit={handleSave} className="card space-y-4 p-5">
        <div><label className="block text-sm font-medium text-[#1e1b4b]">自传标题</label><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="input mt-1.5" /></div>
        <div><label className="block text-sm font-medium text-[#1e1b4b]">写作风格</label><textarea value={styleNotes} onChange={(e) => setStyleNotes(e.target.value)} rows={6} placeholder="如：第一人称、温情真实、适合家人阅读" className="mt-1.5 min-h-[140px] w-full rounded-xl border border-[#e2e0f0] bg-[#f8f7ff] px-5 py-4 text-base leading-relaxed outline-none transition focus:border-[#6366f1] focus:bg-white focus:ring-2 focus:ring-[#6366f1]/10 resize-y" /></div>
        <button type="submit" disabled={saving} className="w-full rounded-xl bg-[#1e1b4b] py-3.5 font-medium text-white transition hover:bg-black disabled:opacity-50">{saving ? "保存中..." : "保存设置"}</button>
      </form>

      <section className="card mt-6 p-5">
        {showDeleteConfirm ? (
          <div className="space-y-3 text-center">
            <p className="text-sm font-medium text-[#ef4444]">确定要删除「{project?.title}」吗？</p>
            <p className="text-xs text-[#a5a0c8]">此操作不可撤销，所有章节和采访记录将被永久删除。</p>
            <div className="flex gap-2">
              <button onClick={handleDelete} disabled={deleting} className="flex-1 rounded-xl bg-[#ef4444] py-3 text-sm font-medium text-white transition hover:bg-[#dc2626] disabled:opacity-50">{deleting ? "删除中..." : "确认删除"}</button>
              <button onClick={() => setShowDeleteConfirm(false)} disabled={deleting} className="btn-outline flex-1 py-3 text-sm">取消</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowDeleteConfirm(true)} className="w-full rounded-xl border border-[#fecaca] py-3 text-sm font-medium text-[#ef4444] transition hover:bg-[#fef2f2]">删除项目</button>
        )}
      </section>
      <BottomNav projectId={projectId} activeChapterId={activeChapter?.id} />
    </main>
  );
}
