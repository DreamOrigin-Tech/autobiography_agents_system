"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import type { InterviewMessage, ProjectDetail } from "@/lib/types";
import { ChatBubble } from "@/components/ChatBubble";
import { BottomNav } from "@/components/BottomNav";
import { ChapterSidebar } from "@/components/ChapterSidebar";
import { ChatSkeleton } from "@/components/LoadingSpinner";

export default function InterviewChatPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const chapterId = params.chapterId as string;
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [writing, setWriting] = useState(false);
  const [suggestedAction, setSuggestedAction] = useState<string>("continue");
  const [error, setError] = useState("");
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => bottomRef.current?.scrollIntoView({ behavior: "smooth" });

  const loadMessages = useCallback(async () => {
    try {
      const [data, proj] = await Promise.all([api.getInterviewMessages(chapterId), api.getProject(projectId)]);
      setProject(proj); setMessages(data);
      if (data.length === 0) {
        const result = await api.startInterview(chapterId);
        setSuggestedAction(result.suggested_action || "continue");
        const refreshed = await api.getInterviewMessages(chapterId);
        setMessages(refreshed);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "加载失败"); }
    finally { setLoading(false); }
  }, [chapterId, projectId]);

  useEffect(() => { loadMessages(); }, [loadMessages]);
  useEffect(() => { scrollToBottom(); }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    const content = input.trim(); setInput(""); setSending(true); setError("");
    setMessages((prev) => [...prev, { id: `temp-${Date.now()}`, role: "user", content, created_at: new Date().toISOString() }]);
    try {
      const result = await api.submitAnswer(chapterId, content);
      setSuggestedAction(result.suggested_action || "continue");
      const refreshed = await api.getInterviewMessages(chapterId);
      setMessages(refreshed);
    } catch (e) { setError(e instanceof Error ? e.message : "发送失败"); }
    finally { setSending(false); }
  }

  function handleWrite() { setWriting(true); setError(""); router.push(`/project/${projectId}/chapter/${chapterId}?writing=1`); }

  if (loading) return (<div className="mx-auto max-w-lg pt-4"><ChatSkeleton /></div>);

  const currentChapter = project?.chapters.find((c) => c.id === chapterId);

  return (
    <main className="page-enter mx-auto flex min-h-screen max-w-5xl">
      {project && <ChapterSidebar projectId={projectId} chapters={project.chapters} activeChapterId={chapterId} />}
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col md:max-w-none md:flex-1">
        <header className="sticky top-0 z-10 border-b border-[#e2e0f0] bg-white/80 px-5 py-3.5 backdrop-blur-xl">
          <Link href={`/project/${projectId}`} className="inline-flex items-center gap-1 text-sm text-[#6366f1] hover:underline">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>章节列表
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-lg font-semibold text-[#1e1b4b]">AI 记者采访</h1>
            {currentChapter && <span className="rounded-full bg-[#eef2ff] px-2.5 py-0.5 text-xs font-medium text-[#6366f1]">第{currentChapter.order}章</span>}
          </div>
          {currentChapter && <p className="mt-0.5 text-sm text-[#a5a0c8] line-clamp-1">{currentChapter.title}</p>}
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 pb-60">
          {error && <div className="mb-4 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#ef4444]">{error}</div>}
          {messages.map((msg) => <ChatBubble key={msg.id} role={msg.role} content={msg.content} />)}
          {sending && (
            <div className="mb-4 flex items-end gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#6366f1] to-[#06b6d4] text-xs font-bold text-white shadow-[0_2px_8px_rgba(99,102,241,0.3)]">AI</div>
              <div className="flex gap-1.5 rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-sm">
                <span className="h-2 w-2 animate-bounce rounded-full bg-[#a5b4fc]" style={{ animationDelay: "0ms" }} />
                <span className="h-2 w-2 animate-bounce rounded-full bg-[#818cf8]" style={{ animationDelay: "150ms" }} />
                <span className="h-2 w-2 animate-bounce rounded-full bg-[#6366f1]" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
          {suggestedAction === "write_chapter" && (
            <div className="animate-fade-up my-4 rounded-2xl border-2 border-[#a7f3d0] bg-gradient-to-b from-[#ecfdf5] to-[#d1fae5] p-5 text-center">
              <span className="text-3xl">✍️</span>
              <p className="mt-2 text-sm font-medium text-[#065f46]">采访素材已充足，可以开始写作了</p>
              <button onClick={handleWrite} disabled={writing} className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#10b981] px-6 py-2.5 text-sm font-medium text-white transition hover:bg-[#059669] active:scale-95">
                {writing ? "跳转中..." : "✦ AI 写作"}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </button>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={handleSend} className="fixed bottom-16 inset-x-0 z-20 mx-auto max-w-lg border-t border-[#e2e0f0] bg-white/80 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl">
          <div className="flex items-end gap-2">
            <textarea value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
              placeholder="分享您的故事...（Enter 发送，Shift+Enter 换行）" rows={3} disabled={sending}
              className="max-h-44 min-h-[72px] flex-1 resize-y rounded-2xl border border-[#e2e0f0] bg-[#f8f7ff] px-5 py-3 text-base leading-relaxed outline-none transition focus:border-[#6366f1] focus:bg-white focus:ring-2 focus:ring-[#6366f1]/10" />
            <button type="submit" disabled={sending || !input.trim()} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#6366f1] text-white transition hover:bg-[#4f46e5] disabled:opacity-40 active:scale-90 shadow-[0_2px_8px_rgba(99,102,241,0.3)]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          </div>
        </form>
        <BottomNav projectId={projectId} activeChapterId={chapterId} />
      </div>
    </main>
  );
}
