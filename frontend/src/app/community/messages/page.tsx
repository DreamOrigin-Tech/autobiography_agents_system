"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { ConversationSummary } from "@/lib/types";
import { LoadingSpinner } from "@/components/LoadingSpinner";

export default function CommunityMessagesPage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setConversations(await api.listConversations());
    } catch (e) {
      setError(e instanceof Error ? e.message : "私信加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <main className="page-enter min-h-screen bg-[#f7f8fa]">
      <div className="mx-auto max-w-3xl px-5 pb-20 pt-7 sm:px-8 sm:pt-10">
        <Link href="/community" className="inline-flex items-center gap-2 text-sm font-medium text-[#667085] transition hover:text-[#1f2937]">
          <ArrowLeftIcon /> 返回社区
        </Link>
        <header className="mt-5 border-b border-[#dfe5eb] pb-6">
          <h1 className="text-3xl font-bold text-[#1f2937]">站内私信</h1>
          <p className="mt-2 text-sm leading-relaxed text-[#667085]">和社区里的作者、读者继续交流。</p>
        </header>

        {error && <div className="mt-5 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}

        {loading ? (
          <div className="pt-10"><LoadingSpinner label="正在加载私信..." /></div>
        ) : conversations.length === 0 ? (
          <section className="mt-12 rounded-lg border border-[#dfe5eb] bg-white px-5 py-12 text-center">
            <p className="font-medium text-[#344054]">还没有私信</p>
            <p className="mt-2 text-sm text-[#667085]">在社区自传详情页，可以给作者发送私信。</p>
          </section>
        ) : (
          <section className="mt-6 space-y-3">
            {conversations.map((item) => (
              <Link key={item.user.id} href={`/community/messages/${item.user.id}`} className="group block rounded-lg border border-[#dfe5eb] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:border-[#9ccfc8]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#1f2937] transition group-hover:text-[#0f766e]">{item.user.name}</p>
                    <p className="mt-1 truncate text-sm text-[#667085]">{item.last_message.content}</p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-[#98a2b3]">
                    <p>{new Date(item.last_message.created_at).toLocaleDateString("zh-CN")}</p>
                    {item.unread_count > 0 && (
                      <span className="mt-2 inline-flex rounded-full bg-[#0f766e] px-2 py-0.5 font-medium text-white">
                        {item.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function ArrowLeftIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>;
}
