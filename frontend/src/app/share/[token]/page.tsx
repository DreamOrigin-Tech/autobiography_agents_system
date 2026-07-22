"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import type { PublishedProject } from "@/lib/types";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { MarkdownContent } from "@/components/MarkdownContent";

export default function ShareReadPage() {
  const params = useParams(); const token = params.token as string;
  const [book, setBook] = useState<PublishedProject | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const chapterTopRef = useRef<HTMLElement>(null); const skipScrollRef = useRef(true);

  const goToChapter = (index: number) => { setActiveIndex(index); };

  useEffect(() => {
    if (skipScrollRef.current) { skipScrollRef.current = false; return; }
    chapterTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeIndex]);

  const load = useCallback(async () => { try { const data = await api.getPublicShare(token); setBook(data); } catch (e) { setError(e instanceof Error ? e.message : "无法加载分享内容"); } finally { setLoading(false); } }, [token]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading) return (<div className="mx-auto max-w-lg px-5 pt-16"><LoadingSpinner label="正在翻开..." /></div>);
  if (error || !book) return (<main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-5"><span className="text-5xl">📭</span><p className="mt-4 text-center text-[#667085]">{error || "内容不存在"}</p><Link href="/" className="mt-4 text-sm font-medium text-[#0f766e] hover:underline">返回首页</Link></main>);
  if (book.chapters.length === 0) return (<main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-5"><span className="text-5xl">📖</span><p className="mt-4 text-center text-[#667085]">这本自传还没有公开章节</p></main>);

  const chapter = book.chapters[activeIndex];
  const totalChars = book.chapters.reduce((sum, item) => sum + item.content_md.length, 0);
  const readMinutes = Math.max(1, Math.ceil(totalChars / 450));
  const progress = book.chapters.length > 1 ? Math.round(((activeIndex + 1) / book.chapters.length) * 100) : 100;

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setCopyError("");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError("复制失败，请手动复制浏览器地址");
    }
  }

  function handleDownloadMarkdown(currentBook: PublishedProject) {
    const markdown = buildBookMarkdown(currentBook);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFilename(currentBook.title)}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  return (
    <main className="page-enter mx-auto min-h-screen max-w-2xl bg-[#f7f8fa]">
      <header className="sticky top-0 z-10 border-b border-[#dfe5eb] bg-[#f7f8fa]/95 px-5 py-5 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#98a2b3]">自传分享</p>
            <h1 className="mt-2 font-serif text-2xl font-bold tracking-tight text-[#1f2937]">{book.title}</h1>
            <p className="mt-2 text-sm text-[#98a2b3]">
              共 {book.chapters.length} 章 · 约 {readMinutes} 分钟
              {book.published_at && <> · 发布于 {new Date(book.published_at).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })}</>}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <button onClick={() => handleDownloadMarkdown(book)} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#dfe5eb] bg-white px-3 py-2 text-xs font-medium text-[#1f2937] transition hover:border-[#5eead4] hover:bg-[#f0fdfa]">
              <DownloadIcon /> 下载全文
            </button>
            <button onClick={handleCopyLink} className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#dfe5eb] bg-white px-3 py-2 text-xs font-medium text-[#0f766e] transition hover:border-[#5eead4] hover:bg-[#f0fdfa]">
              <LinkIcon />
              {copied ? "已复制" : "复制链接"}
            </button>
          </div>
        </div>
        {copyError && <p className="mt-2 text-xs text-[#ef4444]">{copyError}</p>}
      </header>
      {book.chapters.length > 1 && (
        <section className="border-b border-[#dfe5eb] bg-white/55">
          <div className="px-5 pb-2 pt-3">
            <div className="flex items-center justify-between text-xs text-[#98a2b3]">
              <span>阅读进度</span>
              <span>{progress}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#dfe5eb]">
              <div className="h-full rounded-full bg-[#0f766e] transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <nav className="flex gap-2 overflow-x-auto px-5 pb-3">
            {book.chapters.map((ch, idx) => (
              <button key={ch.order} onClick={() => goToChapter(idx)} className={`max-w-[220px] shrink-0 rounded-xl px-3.5 py-2 text-left text-sm transition-all ${idx === activeIndex ? "bg-[#0f766e] text-white shadow-[0_2px_8px_rgba(99,102,241,0.3)]" : "bg-white text-[#667085] ring-1 ring-[#dfe5eb] hover:text-[#1f2937] hover:ring-[#98a2b3]"}`}>
                <span className="block text-[11px] opacity-75">第 {ch.order} 章</span>
                <span className="mt-0.5 block truncate font-medium">{ch.title}</span>
              </button>
            ))}
          </nav>
        </section>
      )}
      <article ref={chapterTopRef} className={`scroll-mt-40 px-5 py-8 sm:px-8 ${book.chapters.length > 1 ? "pb-28" : "pb-16"}`}>
        <div className="mb-8 text-center">
          <span className="inline-block rounded-full bg-[#f0fdfa] px-4 py-1.5 text-sm font-medium text-[#0f766e]">第 {chapter.order} 章</span>
          <h2 className="mt-4 font-serif text-xl font-semibold text-[#1f2937]">{chapter.title}</h2>
        </div>
        <MarkdownContent content={chapter.content_md} stripLeadingHeading />
      </article>
      {book.chapters.length > 1 && (
        <footer className="fixed bottom-0 inset-x-0 border-t border-[#dfe5eb] bg-white/80 px-5 py-3.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <button onClick={() => goToChapter(Math.max(0, activeIndex - 1))} disabled={activeIndex === 0} className="flex items-center gap-1.5 rounded-xl border border-[#dfe5eb] bg-white px-4 py-2.5 text-sm text-[#1f2937] transition hover:bg-[#f7f8fa] disabled:opacity-30"><ArrowLeftIcon />上一章</button>
            <div className="flex-1 text-center text-xs text-[#98a2b3]">{activeIndex + 1} / {book.chapters.length}</div>
            <button onClick={() => goToChapter(Math.min(book.chapters.length - 1, activeIndex + 1))} disabled={activeIndex === book.chapters.length - 1} className="flex items-center gap-1.5 rounded-xl bg-[#0f766e] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#115e59] disabled:opacity-30">下一章<ArrowRightIcon /></button>
          </div>
        </footer>
      )}
    </main>
  );
}

function buildBookMarkdown(book: PublishedProject): string {
  const lines = [`# ${book.title}`, ""];
  if (book.published_at) {
    lines.push(`发布于 ${new Date(book.published_at).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })}`, "");
  }
  for (const chapter of book.chapters) {
    lines.push(`## 第 ${chapter.order} 章 ${chapter.title}`, "", chapter.content_md.trim(), "");
  }
  return `${lines.join("\n").trim()}\n`;
}

function safeFilename(value: string): string {
  const normalized = value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
  return normalized || "自传";
}

function DownloadIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>;
}

function LinkIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 13a5 5 0 007.5.5l2-2a5 5 0 00-7-7l-1.1 1.1" /><path d="M14 11a5 5 0 00-7.5-.5l-2 2a5 5 0 007 7l1.1-1.1" /></svg>;
}

function ArrowLeftIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>;
}

function ArrowRightIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>;
}
