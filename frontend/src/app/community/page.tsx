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

  const commentCount = posts.reduce((sum, post) => sum + post.comment_count, 0);
  const followerCount = posts.reduce((sum, post) => sum + post.follower_count, 0);
  const featuredPost = posts[0];
  const otherPosts = posts.slice(1);

  return (
    <main className="page-enter min-h-screen bg-[#f7f8fa]">
      <div className="mx-auto max-w-6xl px-5 pb-20 pt-7 sm:px-8 sm:pt-10">
        <header className="relative border-b border-[#dfe5eb] pb-6">
          <Link href="/community/messages" className="group absolute right-0 top-0 inline-flex min-h-12 items-center gap-2.5 rounded-full border border-[#d7e7e4] bg-white px-3.5 py-2 text-sm font-semibold text-[#115e59] shadow-[0_8px_20px_-16px_rgba(15,118,110,0.55)] transition hover:border-[#9ccfc8] hover:bg-[#f8fffd] hover:shadow-[0_14px_26px_-18px_rgba(15,118,110,0.65)] sm:min-h-14 sm:px-5">
            <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-[#e6fffb] text-[#0f766e] transition group-hover:bg-[#ccfbf1] sm:h-9 sm:w-9">
              <MessageIcon />
              <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-[#d97706] ring-2 ring-white" />
            </span>
            <span className="hidden leading-tight sm:block">
              <span className="block text-[15px]">私信</span>
              <span className="block text-xs font-medium text-[#667085]">消息中心</span>
            </span>
          </Link>
          <div className="pr-16 sm:pr-44">
            <div>
              <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-[#667085] transition hover:text-[#1f2937]">
                <ArrowLeftIcon /> 我的自传
              </Link>
              <h1 className="mt-4 text-3xl font-bold text-[#1f2937] sm:text-4xl">自传社区</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#667085]">
                像逛书架一样阅读公开自传。打开一本书，读完章节，也可以留下评论或私信作者。
              </p>
            </div>
          </div>
          {!loading && posts.length > 0 && (
            <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
              <StatTile label="社区自传" value={`${posts.length}`} />
              <StatTile label="评论" value={`${commentCount}`} />
              <StatTile label="作者关注" value={`${followerCount}`} />
            </div>
          )}
        </header>

        {error && <div className="mt-5 rounded-lg border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}

        {loading ? (
          <div className="mt-8"><CardSkeleton count={4} /></div>
        ) : posts.length === 0 ? (
          <section className="mx-auto mt-16 max-w-md border-y border-[#dfe5eb] py-14 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-[#f0fdfa] text-[#0f766e]">
              <BookOpenIcon />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-[#1f2937]">社区还没有自传</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#667085]">
              回到已发布项目的设置页，把自传发布到社区后，读者就能在这里阅读、评论和关注作者。
            </p>
            <Link href="/" className="btn-primary mt-5 inline-flex items-center justify-center px-5 py-2.5 text-sm">
              去我的自传
            </Link>
          </section>
        ) : (
          <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <section>
              <Link href={`/community/post/${featuredPost.id}`} className="group block overflow-hidden rounded-lg border border-[#dfe5eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:border-[#9ccfc8] hover:shadow-[0_16px_32px_-22px_rgba(15,118,110,0.55)]">
                <div className="grid gap-5 p-5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:p-6">
                  <BookCover post={featuredPost} size="large" />
                  <div className="min-w-0 self-center">
                    <p className="text-xs font-semibold text-[#0f766e]">最新发布 · {featuredPost.author.name}</p>
                    <h2 className="mt-2 line-clamp-2 text-2xl font-semibold leading-snug text-[#1f2937] transition group-hover:text-[#0f766e]">
                      {featuredPost.title}
                    </h2>
                    <p className="mt-4 line-clamp-4 text-sm leading-7 text-[#667085] sm:text-[15px]">
                      {featuredPost.excerpt || "这本自传暂时没有摘要。"}
                    </p>
                    <PostMeta post={featuredPost} />
                  </div>
                </div>
              </Link>

              {otherPosts.length > 0 && (
                <>
                  <div className="mt-7 flex items-center justify-between gap-4">
                    <h2 className="text-lg font-semibold text-[#1f2937]">社区书架</h2>
                    <span className="text-xs text-[#98a2b3]">{otherPosts.length} 篇</span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-7">
                    {otherPosts.map((post) => (
                      <Link key={post.id} href={`/community/post/${post.id}`} className="group block">
                        <BookCover post={post} />
                        <div className="mt-3 min-w-0">
                          <h3 className="line-clamp-2 text-base font-semibold leading-snug text-[#1f2937] transition group-hover:text-[#0f766e]">
                            {post.title}
                          </h3>
                          <p className="mt-1 text-sm text-[#667085]">{post.author.name}</p>
                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#98a2b3]">
                            {post.excerpt || "这本自传暂时没有摘要。"}
                          </p>
                          <PostMeta post={post} compact />
                        </div>
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </section>

            <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
              <section className="rounded-lg border border-[#dfe5eb] bg-white p-5">
                <p className="text-sm font-semibold text-[#1f2937]">阅读说明</p>
                <p className="mt-2 text-xs leading-6 text-[#667085]">
                  这里只展示已经公开发布、并主动放上社区书架的自传。取消公开后，书籍会自动从书架隐藏。
                </p>
              </section>
              <section className="rounded-lg border border-[#dfe5eb] bg-[#f0fdfa] p-5">
                <p className="text-sm font-semibold text-[#115e59]">发布自己的自传</p>
                <p className="mt-2 text-xs leading-6 text-[#0f766e]">
                  在项目设置页完成发布后，可以同步到社区，接受评论与私信。
                </p>
                <Link href="/" className="mt-4 inline-flex text-sm font-semibold text-[#115e59] hover:underline">
                  回到我的自传
                </Link>
              </section>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#dfe5eb] bg-white px-3 py-3 sm:px-4">
      <p className="text-xs text-[#667085]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[#1f2937]">{value}</p>
    </div>
  );
}

function BookCover({ post, size = "normal" }: { post: CommunityPost; size?: "normal" | "large" }) {
  const palette = coverPalette(post.title);
  const large = size === "large";
  return (
    <div className={`relative ${large ? "mx-auto h-56 w-36 sm:mx-0" : "h-48 w-32"} shrink-0 rounded-r-lg border border-black/10 shadow-[10px_14px_24px_-18px_rgba(16,24,40,0.75)] transition group-hover:-translate-y-1 group-hover:shadow-[14px_20px_30px_-18px_rgba(15,118,110,0.55)]`}>
      <div className={`absolute inset-0 rounded-r-lg ${palette.bg}`} />
      <div className="absolute inset-y-0 left-0 w-4 rounded-l-sm bg-black/15" />
      <div className="absolute inset-y-0 left-4 w-px bg-white/25" />
      <div className="relative flex h-full flex-col justify-between p-4 text-white">
        <div>
          <p className="text-[10px] font-semibold opacity-80">自传</p>
          <h3 className={`${large ? "mt-4 text-lg" : "mt-3 text-base"} line-clamp-4 font-semibold leading-snug`}>
            {post.title}
          </h3>
        </div>
        <div>
          <p className="line-clamp-1 text-xs opacity-85">{post.author.name}</p>
          <p className="mt-2 inline-flex rounded-full bg-white/18 px-2 py-1 text-[10px] font-semibold backdrop-blur">
            {post.chapter_count} 章
          </p>
        </div>
      </div>
    </div>
  );
}

function PostMeta({ post, compact = false }: { post: CommunityPost; compact?: boolean }) {
  return (
    <div className={`${compact ? "mt-3 border-0 pt-0" : "mt-5 border-t border-[#eef2f5] pt-4"} flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#667085]`}>
      <span>{post.comment_count} 条评论</span>
      <span>{post.follower_count} 人关注作者</span>
      {post.published_at && <span>{new Date(post.published_at).toLocaleDateString("zh-CN")} 发布</span>}
      {post.is_author_current_user && <span className="font-medium text-[#0f766e]">你的作品</span>}
    </div>
  );
}

function coverPalette(title: string) {
  const palettes = [
    { bg: "bg-[#0f766e]" },
    { bg: "bg-[#334155]" },
    { bg: "bg-[#92400e]" },
    { bg: "bg-[#7c3aed]" },
    { bg: "bg-[#be123c]" },
    { bg: "bg-[#1d4ed8]" },
  ];
  const index = Array.from(title).reduce((sum, char) => sum + char.charCodeAt(0), 0) % palettes.length;
  return palettes[index];
}

function ArrowLeftIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>;
}

function MessageIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>;
}

function BookOpenIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" /></svg>;
}
