"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import type { PublishedProject } from "@/lib/types";
import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function ShareReadPage() {
  const params = useParams();
  const token = params.token as string;
  const [book, setBook] = useState<PublishedProject | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const chapterTopRef = useRef<HTMLElement>(null);
  const skipScrollRef = useRef(true);

  const goToChapter = (index: number) => { setActiveIndex(index); };

  useEffect(() => {
    if (skipScrollRef.current) { skipScrollRef.current = false; return; }
    chapterTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeIndex]);

  const load = useCallback(async () => {
    try {
      const data = await api.getPublicShare(token);
      setBook(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法加载分享内容");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-lg px-5 pt-16">
        <LoadingSpinner label="正在翻开..." />
      </div>
    );
  }

  if (error || !book) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-5">
        <span className="text-5xl">📭</span>
        <p className="mt-4 text-center text-[#7a7265]">{error || "内容不存在"}</p>
        <Link href="/" className="mt-4 text-sm font-medium text-[#8b5e3c] hover:underline">返回首页</Link>
      </main>
    );
  }

  const chapter = book.chapters[activeIndex];

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-[#fbf7f2]">
      <header className="sticky top-0 z-10 border-b border-[#e7dfd4] bg-[#fbf7f2]/95 px-5 py-5 backdrop-blur">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#b8a892]">自传分享</p>
        <h1 className="mt-2 font-serif text-2xl font-bold tracking-tight text-[#2c2416]">{book.title}</h1>
        {book.published_at && (
          <p className="mt-2 text-sm text-[#b8a892]">
            发布于 {new Date(book.published_at).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        )}
      </header>

      {book.chapters.length > 1 && (
        <nav className="flex gap-1.5 overflow-x-auto border-b border-[#e7dfd4] px-5 py-3">
          {book.chapters.map((ch, idx) => (
            <button key={ch.order} onClick={() => goToChapter(idx)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                idx === activeIndex
                  ? "bg-[#2c2416] text-white shadow-sm"
                  : "bg-white text-[#7a7265] ring-1 ring-[#e7dfd4] hover:text-[#2c2416] hover:ring-[#b8a892]"
              }`}>
              第 {ch.order} 章
            </button>
          ))}
        </nav>
      )}

      <article
        ref={chapterTopRef}
        className={`scroll-mt-40 px-5 py-8 sm:px-8 ${book.chapters.length > 1 ? "pb-28" : "pb-16"}`}
      >
        <div className="mb-8 text-center">
          <span className="inline-block rounded-full bg-[#f5f0e9] px-4 py-1.5 text-sm font-medium text-[#8b5e3c]">
            第 {chapter.order} 章
          </span>
          <h2 className="mt-4 font-serif text-xl font-semibold text-[#2c2416]">{chapter.title}</h2>
        </div>
        <div className="prose-chapter whitespace-pre-wrap mx-auto max-w-prose">
          {chapter.content_md}
        </div>
      </article>

      {book.chapters.length > 1 && (
        <footer className="fixed bottom-0 inset-x-0 border-t border-[#e7dfd4] bg-white/90 px-5 py-3.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <button onClick={() => goToChapter(Math.max(0, activeIndex - 1))} disabled={activeIndex === 0}
              className="flex items-center gap-1.5 rounded-xl border border-[#e7dfd4] bg-white px-4 py-2.5 text-sm text-[#2c2416] transition hover:bg-[#f5f0e9] disabled:opacity-30">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
              上一章
            </button>
            <div className="flex-1 text-center text-xs text-[#b8a892]">{activeIndex + 1} / {book.chapters.length}</div>
            <button onClick={() => goToChapter(Math.min(book.chapters.length - 1, activeIndex + 1))} disabled={activeIndex === book.chapters.length - 1}
              className="flex items-center gap-1.5 rounded-xl bg-[#8b5e3c] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#6d4a30] disabled:opacity-30">
              下一章
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
            </button>
          </div>
        </footer>
      )}
    </main>
  );
}
