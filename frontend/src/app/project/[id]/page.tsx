"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, statusLabels } from "@/lib/api";
import type { OutlineInterviewState, ProjectDetail } from "@/lib/types";
import { ChapterCard } from "@/components/ChapterCard";
import { BottomNav } from "@/components/BottomNav";
import { CardSkeleton } from "@/components/LoadingSpinner";
import { ChatBubble } from "@/components/ChatBubble";
import { useToast } from "@/components/Toast";

export default function ProjectDashboard() {
  const params = useParams();
  const projectId = params.id as string;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState(false);
  const [outlineInterview, setOutlineInterview] = useState<OutlineInterviewState | null>(null);
  const [outlineAnswer, setOutlineAnswer] = useState("");
  const [answeringOutline, setAnsweringOutline] = useState(false);
  const [nextDirection, setNextDirection] = useState("");
  const [creatingNext, setCreatingNext] = useState(false);
  const [styleDraft, setStyleDraft] = useState("真实、温情、第一人称，适合家人朋友阅读");
  const [error, setError] = useState("");
  const outlineBottomRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const data = await api.getProject(projectId);
      setProject(data);
      if (data.style_notes) setStyleDraft(data.style_notes);
      if (data.chapters.length === 0) {
        setOutlineInterview(await api.startOutlineInterview(projectId));
      }
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

  useEffect(() => {
    outlineBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [outlineInterview?.messages.length, answeringOutline]);

  async function handlePlan() {
    setPlanning(true);
    setError("");
    try {
      if (styleDraft.trim()) await api.updateProject(projectId, { style_notes: styleDraft.trim() });
      const data = await api.startFirstChapter(projectId);
      setProject(data);
      toast("第一章已经确定，可以开始采访了", "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "规划失败");
    } finally {
      setPlanning(false);
    }
  }

  async function handleCreateNextChapter(e: React.FormEvent) {
    e.preventDefault();
    const direction = nextDirection.trim();
    if (!direction || creatingNext) return;
    setCreatingNext(true);
    setError("");
    try {
      const data = await api.createNextChapter(projectId, direction);
      setProject(data);
      setNextDirection("");
      toast("下一章已经确定", "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "确定下一章失败");
    } finally {
      setCreatingNext(false);
    }
  }

  async function handleOutlineAnswer(e: React.FormEvent) {
    e.preventDefault();
    const content = outlineAnswer.trim();
    if (!content || answeringOutline) return;
    setAnsweringOutline(true);
    setError("");
    try {
      const state = await api.answerOutlineInterview(projectId, content);
      setOutlineInterview(state);
      setOutlineAnswer("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送失败");
    } finally {
      setAnsweringOutline(false);
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
              <p className="text-xs font-semibold text-[#0f766e]">第一步 · 找到故事的起点</p>
              <h2 className="mt-3 text-2xl font-semibold leading-tight text-[#1f2937]">先聊一会儿，只确定最适合开始的第一章。</h2>
              <p className="mt-4 text-sm leading-7 text-[#667085]">
                不必现在就决定整本书的目录。AI 会先听您聊人生阶段和重要转折，找到一个最容易讲起的开头；这一章完成后，再一起决定下一章。
              </p>
              <div className="mt-7 space-y-3 text-sm text-[#667085]">
                <InfoItem number="01" text="先聊人生阶段、人物和转折" />
                <InfoItem number="02" text="只确定当前最想讲的一章" />
                <InfoItem number="03" text="写完一章，再决定下一章" />
              </div>
              <div className="mt-7 border-t border-[#dfe5eb] pt-5">
                <label htmlFor="project-style" className="block text-sm font-medium text-[#344054]">写作语气（可选）</label>
                <textarea
                  id="project-style"
                  value={styleDraft}
                  onChange={(e) => setStyleDraft(e.target.value)}
                  placeholder="例如：第一人称、温情真实、适合家人阅读"
                  rows={3}
                  className="input mt-2 w-full resize-y text-sm leading-relaxed"
                />
              </div>
            </div>
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-[#e4e7ec] px-5 py-4 sm:px-6">
                <div>
                  <h2 className="font-semibold text-[#1f2937]">AI 策划访谈</h2>
                  <p className="mt-0.5 text-xs text-[#667085]">通常聊 3-5 个问题</p>
                </div>
                {outlineInterview && (
                  <span className="text-xs font-medium text-[#0f766e]">
                    已回答 {outlineInterview.answer_count} 题
                  </span>
                )}
              </div>
              <div className="max-h-[30rem] min-h-64 overflow-y-auto bg-[#f7f8fa] px-4 py-5 sm:px-6">
                {outlineInterview?.messages.map((message, index) => (
                  <ChatBubble
                    key={`${message.role}-${index}`}
                    role={message.role}
                    content={message.content}
                    agentLabel="AI 策划编辑"
                  />
                ))}
                {answeringOutline && (
                  <div className="mb-4 flex items-end gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0f766e] text-xs font-bold text-white">AI</div>
                    <div className="flex gap-1.5 rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-sm">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[#98a2b3]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[#98a2b3] [animation-delay:120ms]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-[#98a2b3] [animation-delay:240ms]" />
                    </div>
                  </div>
                )}
                <div ref={outlineBottomRef} />
              </div>
              <form onSubmit={handleOutlineAnswer} className="border-t border-[#e4e7ec] p-4 sm:p-5">
                {!outlineInterview?.ready ? (
                  <div className="flex items-end gap-2">
                    <textarea
                      value={outlineAnswer}
                      onChange={(e) => setOutlineAnswer(e.target.value)}
                      placeholder="像聊天一样回答就好..."
                      rows={3}
                      className="input min-h-24 flex-1 resize-none text-base leading-relaxed"
                    />
                    <button type="submit" disabled={!outlineAnswer.trim() || answeringOutline} className="btn-primary flex h-11 shrink-0 items-center gap-1.5 px-4">
                      {answeringOutline ? <SpinnerIcon /> : <MessageIcon />} 发送
                    </button>
                  </div>
                ) : (
                  <p className="rounded-lg bg-[#f0fdfa] px-4 py-3 text-sm leading-relaxed text-[#115e59]">
                    已经了解了足够的人生线索，可以先确定第一章。从这一章开始，后面边聊边决定。
                  </p>
                )}
                {outlineInterview?.can_generate && (
                  <button type="button" onClick={handlePlan} disabled={planning || answeringOutline} className="btn-primary mt-4 flex w-full items-center justify-center gap-2 py-3.5">
                    {planning ? <><SpinnerIcon /> 正在确定第一章...</> : <><SparkIcon /> {outlineInterview.ready ? "根据采访开始第一章" : "先从目前最清楚的一章开始"}</>}
                  </button>
                )}
                {outlineInterview && !outlineInterview.can_generate && (
                  <p className="mt-3 text-center text-xs text-[#98a2b3]">再回答 {Math.max(0, 2 - outlineInterview.answer_count)} 个问题后，就可以确定第一章。</p>
                )}
              </form>
            </div>
          </section>
        ) : (
          <section className="mt-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold text-[#0f766e]">按章节推进</p>
                <h2 className="mt-1 text-xl font-semibold text-[#1f2937]">已经展开的章节</h2>
              </div>
              <p className="text-sm text-[#667085]">每完成一章，再决定下一章</p>
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
          <section className="mt-9 grid gap-7 border-t border-[#dfe5eb] pt-8 lg:grid-cols-[1fr_18rem]">
            <div>
              <p className="text-xs font-semibold text-[#0f766e]">这一章先告一段落</p>
              <h2 className="mt-2 text-xl font-semibold text-[#1f2937]">接下来，您最想聊哪一段？</h2>
              <p className="mt-2 text-sm leading-7 text-[#667085]">
                可以是另一个时期、一个重要的人，或者刚才聊天时新想起的故事。这里只会创建下一章，不会提前安排后面的目录。
              </p>
              <form onSubmit={handleCreateNextChapter} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1 text-sm font-medium text-[#344054]">
                  下一章方向
                  <textarea
                    value={nextDirection}
                    onChange={(e) => setNextDirection(e.target.value)}
                    placeholder="例如：我想接着讲刚参加工作时遇到的那位老师傅..."
                    rows={3}
                    className="input mt-2 min-h-24 w-full resize-y text-base leading-relaxed"
                  />
                </label>
                <button type="submit" disabled={!nextDirection.trim() || creatingNext} className="btn-primary flex h-11 shrink-0 items-center justify-center gap-2 px-5">
                  {creatingNext ? <><SpinnerIcon /> 正在确定...</> : <><SparkIcon /> 确定下一章</>}
                </button>
              </form>
            </div>
            <div className="border-l-0 border-[#dfe5eb] lg:border-l lg:pl-7">
              <p className="text-sm font-medium text-[#344054]">也可以先写到这里</p>
              <p className="mt-2 text-xs leading-6 text-[#667085]">已经完成的内容可以先检查、修订或发布，以后仍能继续添加章节。</p>
              <Link href={`/project/${projectId}/settings`} className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-[#0f766e] transition hover:text-[#115e59]">
                <CheckIcon /> 查看发布检查 <ArrowRightIcon />
              </Link>
            </div>
          </section>
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

function SettingsIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 01-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5v.1a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 01-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 012.8-2.8l.1.1a1.7 1.7 0 001.8.3 1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 012.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8 1.7 1.7 0 001.5 1h.1a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>;
}

function SparkIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m12 3-1.4 5.6L5 10l5.6 1.4L12 17l1.4-5.6L19 10l-5.6-1.4L12 3z" /><path d="m19 16-.7 2.3L16 19l2.3.7L19 22l.7-2.3L22 19l-2.3-.7L19 16z" /></svg>;
}

function SpinnerIcon() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />;
}
