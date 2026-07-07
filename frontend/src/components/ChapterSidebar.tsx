"use client";

import Link from "next/link";
import type { ChapterBrief } from "@/lib/types";
import { statusLabels } from "@/lib/api";

interface ChapterSidebarProps {
  projectId: string;
  chapters: ChapterBrief[];
  activeChapterId: string;
}

const dotColors: Record<string, string> = {
  pending: "bg-[#d4c8b8]",
  interviewing: "bg-[#c4946c]",
  drafting: "bg-[#7a9e9f]",
  done: "bg-[#52796f]",
};

export function ChapterSidebar({ projectId, chapters, activeChapterId }: ChapterSidebarProps) {
  const doneCount = chapters.filter((c) => c.status === "done").length;

  return (
    <aside className="hidden md:block md:w-72 md:shrink-0 md:border-r md:border-[#e7dfd4] md:bg-[#f5f0e9]">
      <div className="sticky top-0 max-h-screen overflow-y-auto p-5">
        <div className="mb-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#b8a892]">目录</p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e7dfd4]">
              <div
                className="h-full rounded-full bg-[#8b5e3c] transition-all duration-500"
                style={{ width: `${chapters.length > 0 ? (doneCount / chapters.length) * 100 : 0}%` }}
              />
            </div>
            <span className="text-xs text-[#b8a892]">{doneCount}/{chapters.length}</span>
          </div>
        </div>

        <nav className="space-y-0.5">
          {chapters.map((chapter) => {
            const href =
              chapter.status === "done"
                ? `/project/${projectId}/chapter/${chapter.id}`
                : `/project/${projectId}/interview/${chapter.id}`;
            const active = chapter.id === activeChapterId;

            return (
              <Link
                key={chapter.id}
                href={href}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-150 ${
                  active
                    ? "bg-white text-[#2c2416] shadow-sm"
                    : "text-[#7a7265] hover:bg-white/60 hover:text-[#2c2416]"
                }`}
              >
                <div className="relative flex h-8 w-8 shrink-0 items-center justify-center">
                  <span className={`absolute bottom-0.5 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full ${dotColors[chapter.status] || dotColors.pending}`} />
                  <span className={`text-xs font-bold ${active ? "text-[#8b5e3c]" : "text-[#b8a892] group-hover:text-[#8b5e3c]"}`}>
                    {chapter.order}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium line-clamp-1 ${active ? "text-[#2c2416]" : ""}`}>
                    {chapter.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#b8a892]">
                    {statusLabels[chapter.status] || chapter.status}
                  </p>
                </div>
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
