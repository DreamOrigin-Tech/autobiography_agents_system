"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import type { DirectMessage, FollowStatus } from "@/lib/types";
import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function MessageThreadPage() {
  const params = useParams();
  const userId = params.userId as string;
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [profile, setProfile] = useState<FollowStatus | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [thread, status] = await Promise.all([
        api.getMessageThread(userId),
        api.getCommunityUser(userId),
      ]);
      setMessages(thread);
      setProfile(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "私信加载失败");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError("");
    try {
      const sent = await api.sendMessage(userId, trimmed);
      setMessages((prev) => [...prev, sent]);
      setContent("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  if (loading) return <div className="mx-auto max-w-lg px-5 pt-16"><LoadingSpinner label="正在打开私信..." /></div>;

  return (
    <main className="page-enter min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-5 pt-8 sm:px-8 sm:pt-10">
        <header className="border-b border-[#dfe5eb] pb-5">
          <Link href="/community/messages" className="text-sm font-medium text-[#667085] transition hover:text-[#1f2937]">
            返回私信
          </Link>
          <h1 className="mt-4 text-2xl font-bold text-[#1f2937]">{profile?.user.name || "私信"}</h1>
          {profile && (
            <p className="mt-1 text-sm text-[#667085]">
              {profile.follower_count} 位关注者 · 关注了 {profile.following_count} 人
            </p>
          )}
        </header>

        {error && <div className="mt-5 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}

        <section className="min-h-0 flex-1 space-y-3 overflow-y-auto py-5">
          {messages.length === 0 ? (
            <p className="rounded-xl border border-[#dfe5eb] bg-[#f7f8fa] px-4 py-8 text-center text-sm text-[#667085]">
              还没有消息，发出第一句问候吧。
            </p>
          ) : messages.map((message) => {
            const mine = message.sender.id !== userId;
            return (
              <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm ${mine ? "rounded-br-md bg-[#0f766e] text-white" : "rounded-bl-md bg-white text-[#344054]"}`}>
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  <p className={`mt-1 text-[11px] ${mine ? "text-white/65" : "text-[#98a2b3]"}`}>
                    {new Date(message.created_at).toLocaleString("zh-CN")}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </section>

        <form onSubmit={handleSend} className="sticky bottom-0 border-t border-[#dfe5eb] bg-[#f7f8fa]/95 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
          <div className="flex items-end gap-2">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={2}
              placeholder="写一条私信..."
              className="input max-h-36 min-h-14 flex-1 resize-y text-base leading-relaxed"
            />
            <button type="submit" disabled={!content.trim() || sending} className="btn-primary h-12 px-4 text-sm disabled:opacity-50">
              {sending ? "发送中" : "发送"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
