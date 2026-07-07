"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import type { ProjectDetail } from "@/lib/types";
import { BottomNav } from "@/components/BottomNav";
import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function ProjectSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [title, setTitle] = useState("");
  const [styleNotes, setStyleNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getProject(projectId);
      setProject(data);
      setTitle(data.title);
      setStyleNotes(data.style_notes || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const doneChapterCount = project?.chapters.filter((c) => c.status === "done").length ?? 0;

  function buildShareUrl(token: string) {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/share/${token}`;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(""); setMessage("");
    try {
      const updated = await api.updateProject(projectId, { title: title.trim(), style_notes: styleNotes.trim() });
      setProject(updated);
      setMessage("已保存");
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setSaving(false); }
  }

  async function handlePublish() {
    setPublishing(true); setError(""); setMessage("");
    try {
      const result = await api.publishProject(projectId);
      await load();
      setMessage(`已发布，共 ${result.published_chapter_count} 章可阅读`);
    } catch (e) { setError(e instanceof Error ? e.message : "发布失败"); }
    finally { setPublishing(false); }
  }

  async function handleUnpublish() {
    setPublishing(true); setError(""); setMessage("");
    try {
      await api.unpublishProject(projectId);
      await load();
      setMessage("已取消发布");
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setPublishing(false); }
  }

  async function handleCopyLink() {
    if (!project?.share_token) return;
    const url = buildShareUrl(project.share_token);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setError("复制失败，请手动复制链接"); }
  }

  async function handleDelete() {
    setDeleting(true); setError("");
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

  const activeChapter = project?.chapters[0];
  const shareUrl = project?.share_token ? buildShareUrl(project.share_token) : "";

  if (loading) {
    return (
      <div className="mx-auto max-w-lg px-5 pt-10">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 pb-28 pt-6">
      <header className="mb-6">
        <Link href={`/project/${projectId}`} className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-[#7a7265] shadow-sm transition-all hover:text-[#2c2416] hover:shadow active:scale-95">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          项目
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-[#2c2416]">项目设置</h1>
      </header>

      {error && (
        <div className="mb-4 rounded-xl border border-[#f0d0d0] bg-[#fef5f5] px-4 py-3 text-sm text-[#c25b56]">{error}</div>
      )}
      {message && (
        <div className="mb-4 rounded-xl border border-[#c5ddd5] bg-[#eef7f4] px-4 py-3 text-sm text-[#3d6158]">{message}</div>
      )}

      <section className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f5f0e9]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#8b5e3c]"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" /></svg>
          </div>
          <div>
            <h2 className="font-semibold text-[#2c2416]">发布与分享</h2>
            <p className="text-sm text-[#b8a892]">已完成 {doneChapterCount}/{project?.chapters.length ?? 0} 章</p>
          </div>
        </div>

        {project?.is_published && project.share_token ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl bg-[#fbf7f2] p-3.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-[#b8a892]">分享链接</p>
              <p className="mt-1 break-all text-sm text-[#8b5e3c]">{shareUrl}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={handleCopyLink} className="flex-1 rounded-xl bg-[#8b5e3c] py-3 text-sm font-medium text-white transition hover:bg-[#6d4a30]">{copied ? "✓ 已复制" : "复制链接"}</button>
              <Link href={`/share/${project.share_token}`} target="_blank" className="flex-1 rounded-xl border border-[#e7dfd4] py-3 text-center text-sm font-medium text-[#2c2416] transition hover:bg-[#f5f0e9]">预览</Link>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={handlePublish} disabled={publishing || doneChapterCount === 0} className="flex-1 rounded-xl border border-[#c5ddd5] py-2.5 text-sm font-medium text-[#52796f] transition hover:bg-[#eef7f4] disabled:opacity-40">更新发布</button>
              <button type="button" onClick={handleUnpublish} disabled={publishing} className="rounded-xl border border-[#e7dfd4] px-4 py-2.5 text-sm text-[#7a7265] transition hover:bg-[#f5f0e9]">取消发布</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={handlePublish} disabled={publishing || doneChapterCount === 0} className="mt-4 w-full rounded-xl bg-[#8b5e3c] py-3.5 font-medium text-white transition hover:bg-[#6d4a30] disabled:opacity-40">
            {publishing ? "发布中..." : "发布自传"}
          </button>
        )}
      </section>

      <form onSubmit={handleSave} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
        <div>
          <label className="block text-sm font-medium text-[#2c2416]">自传标题</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-[#e7dfd4] bg-[#fbf7f2] px-4 py-3 outline-none transition focus:border-[#8b5e3c] focus:bg-white focus:ring-2 focus:ring-[#8b5e3c]/10" />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#2c2416]">写作风格</label>
          <textarea value={styleNotes} onChange={(e) => setStyleNotes(e.target.value)}
            rows={6}
            placeholder="如：第一人称、温情真实、适合家人阅读。请详细描述您期望的写作风格..."
            className="mt-1.5 min-h-[140px] w-full resize-y rounded-xl border border-[#e7dfd4] bg-[#fbf7f2] px-5 py-4 text-base leading-relaxed outline-none transition focus:border-[#8b5e3c] focus:bg-white focus:ring-2 focus:ring-[#8b5e3c]/10" />
        </div>
        <button type="submit" disabled={saving} className="w-full rounded-xl bg-[#2c2416] py-3.5 font-medium text-white transition hover:bg-black disabled:opacity-50">
          {saving ? "保存中..." : "保存设置"}
        </button>
      </form>

      {/* Delete section */}
      <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
        {showDeleteConfirm ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-[#c25b56] font-medium">确定要删除「{project?.title}」吗？</p>
            <p className="text-xs text-[#b8a892]">此操作不可撤销，所有章节和采访记录将被永久删除。</p>
            <div className="flex gap-2">
              <button onClick={handleDelete} disabled={deleting}
                className="flex-1 rounded-xl bg-[#c25b56] py-3 text-sm font-medium text-white transition hover:bg-[#a04440] disabled:opacity-50">
                {deleting ? "删除中..." : "确认删除"}
              </button>
              <button onClick={() => setShowDeleteConfirm(false)} disabled={deleting}
                className="flex-1 rounded-xl border border-[#e7dfd4] py-3 text-sm font-medium text-[#7a7265] transition hover:bg-[#f5f0e9]">
                取消
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowDeleteConfirm(true)}
            className="w-full rounded-xl border border-[#f0d0d0] py-3 text-sm font-medium text-[#c25b56] transition hover:bg-[#fef5f5]">
            删除项目
          </button>
        )}
      </section>

      <BottomNav projectId={projectId} activeChapterId={activeChapter?.id} />
    </main>
  );
}
