"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { CommunityPostDetail } from "@/lib/types";
import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function CommunityPostPage() {
  const params = useParams();
  const router = useRouter();
  const postId = params.id as string;
  const [post, setPost] = useState<CommunityPostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [following, setFollowing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await api.getCommunityPost(postId);
      setPost(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "社区自传加载失败");
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function handleToggleFollow() {
    if (!post || following) return;
    setFollowing(true);
    setError("");
    try {
      const status = post.is_following_author
        ? await api.unfollowUser(post.author.id)
        : await api.followUser(post.author.id);
      setPost({
        ...post,
        is_following_author: status.is_following,
        follower_count: status.follower_count,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "关注操作失败");
    } finally {
      setFollowing(false);
    }
  }

  async function handleComment(e: React.FormEvent) {
    e.preventDefault();
    const content = comment.trim();
    if (!post || !content || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const created = await api.addCommunityComment(post.id, content);
      setPost({
        ...post,
        comment_count: post.comment_count + 1,
        comments: [...post.comments, created],
      });
      setComment("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "评论失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="mx-auto max-w-lg px-5 pt-16"><LoadingSpinner label="正在打开社区自传..." /></div>;

  if (!post) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-5 text-center">
        <p className="text-[#667085]">{error || "社区自传不存在"}</p>
        <Link href="/community" className="mt-4 text-sm font-medium text-[#0f766e] hover:underline">返回社区</Link>
      </main>
    );
  }

  return (
    <main className="page-enter min-h-screen">
      <div className="mx-auto max-w-4xl px-5 pb-20 pt-8 sm:px-8 sm:pt-10">
        <Link href="/community" className="text-sm font-medium text-[#667085] transition hover:text-[#1f2937]">
          返回社区
        </Link>
        <header className="mt-5 border-b border-[#dfe5eb] pb-7">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[#0f766e]">{post.author.name}</p>
              <h1 className="mt-2 text-3xl font-bold text-[#1f2937] sm:text-4xl">{post.title}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[#667085]">{post.excerpt}</p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-[#98a2b3]">
                <span>{post.chapter_count} 章</span>
                <span>{post.comment_count} 条评论</span>
                <span>{post.follower_count} 人关注作者</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button type="button" onClick={handleToggleFollow} disabled={following} className="btn-outline px-4 py-2.5 text-sm">
                {post.is_following_author ? "已关注" : "关注作者"}
              </button>
              <button type="button" onClick={() => router.push(`/community/messages/${post.author.id}`)} className="btn-outline px-4 py-2.5 text-sm">
                私信作者
              </button>
              <Link href={`/share/${post.share_token}`} className="btn-primary px-4 py-2.5 text-sm">
                阅读全文
              </Link>
            </div>
          </div>
        </header>

        {error && <div className="mt-5 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}

        <section className="mt-8 grid gap-8 lg:grid-cols-[1fr_18rem]">
          <div>
            <h2 className="text-lg font-semibold text-[#1f2937]">评论</h2>
            <form onSubmit={handleComment} className="mt-4 rounded-xl border border-[#dfe5eb] bg-white p-4">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder="写下你的阅读感受..."
                className="input min-h-24 w-full resize-y text-sm leading-relaxed"
              />
              <div className="mt-3 flex justify-end">
                <button type="submit" disabled={!comment.trim() || submitting} className="btn-primary px-4 py-2.5 text-sm disabled:opacity-50">
                  {submitting ? "发送中" : "发表评论"}
                </button>
              </div>
            </form>

            <div className="mt-5 space-y-3">
              {post.comments.length === 0 ? (
                <p className="rounded-xl border border-[#dfe5eb] bg-[#f7f8fa] px-4 py-6 text-center text-sm text-[#667085]">
                  还没有评论，成为第一个读者。
                </p>
              ) : post.comments.map((item) => (
                <article key={item.id} className="rounded-xl border border-[#dfe5eb] bg-white px-4 py-3">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-[#344054]">{item.author.name}</span>
                    <span className="text-[#98a2b3]">{new Date(item.created_at).toLocaleString("zh-CN")}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-[#475467]">{item.content}</p>
                </article>
              ))}
            </div>
          </div>

          <aside className="rounded-xl border border-[#dfe5eb] bg-[#f7f8fa] p-4 lg:self-start">
            <p className="text-sm font-semibold text-[#1f2937]">作者</p>
            <p className="mt-2 text-lg font-semibold text-[#0f766e]">{post.author.name}</p>
            <p className="mt-2 text-xs leading-6 text-[#667085]">
              关注后可以更容易在社区里找到这位作者，也可以通过私信继续交流阅读感受。
            </p>
          </aside>
        </section>
      </div>
    </main>
  );
}
