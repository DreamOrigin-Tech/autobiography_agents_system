"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { CommunityPost } from "@/lib/types";
import { CardSkeleton } from "@/components/LoadingSpinner";

export default function CommunityPage() {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setPosts(await api.listCommunityPosts());
    } catch (e) {
      setError(e instanceof Error ? e.message : "社区加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <main className="page-enter min-h-screen">
      <div className="mx-auto max-w-6xl px-5 pb-20 pt-8 sm:px-8 sm:pt-10">
        <header className="flex flex-col gap-4 border-b border-[#dfe5eb] pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/" className="text-sm font-medium text-[#667085] transition hover:text-[#1f2937]">
              返回我的自传
            </Link>
            <h1 className="mt-4 text-3xl font-bold text-[#1f2937] sm:text-4xl">自传社区</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#667085]">
              阅读别人公开发布的自传，留下评论，关注作者，也可以发起站内私信。
            </p>
          </div>
          <Link href="/community/messages" className="btn-outline inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm">
            <MessageIcon /> 私信
          </Link>
        </header>

        {error && <div className="mt-5 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}

        {loading ? (
          <div className="mt-8"><CardSkeleton count={4} /></div>
        ) : posts.length === 0 ? (
          <section className="mx-auto mt-16 max-w-md border-y border-[#dfe5eb] py-14 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#f0fdfa] text-[#0f766e]">
              <BookOpenIcon />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-[#1f2937]">社区还没有自传</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#667085]">
              在项目发布后，可以把自传发布到社区。
            </p>
          </section>
        ) : (
          <section className="mt-7 grid gap-4 lg:grid-cols-2">
            {posts.map((post) => (
              <Link key={post.id} href={`/community/post/${post.id}`} className="card card-hover block p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[#0f766e]">{post.author.name}</p>
                    <h2 className="mt-2 truncate text-lg font-semibold text-[#1f2937]">{post.title}</h2>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#f0fdfa] px-2.5 py-1 text-xs font-medium text-[#0f766e]">
                    {post.chapter_count} 章
                  </span>
                </div>
                <p className="mt-3 line-clamp-3 text-sm leading-7 text-[#667085]">
                  {post.excerpt || "这本自传暂时没有摘要。"}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#98a2b3]">
                  <span>{post.comment_count} 条评论</span>
                  <span>{post.follower_count} 人关注作者</span>
                  {post.published_at && <span>{new Date(post.published_at).toLocaleDateString("zh-CN")} 发布</span>}
                </div>
              </Link>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function MessageIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>;
}

function BookOpenIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" /></svg>;
}
