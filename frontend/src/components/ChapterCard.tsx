import Link from "next/link";
import type { ChapterBrief } from "@/lib/types";
import { statusLabels } from "@/lib/api";

interface ChapterCardProps {
  projectId: string;
  chapter: ChapterBrief;
}

const statusConfig: Record<string, { bar: string; badge: string; icon: string }> = {
  pending:       { bar: "bg-[#d4c8b8]", badge: "bg-[#f5f0e9] text-[#7a7265]", icon: "○" },
  interviewing:  { bar: "bg-[#c4946c]", badge: "bg-[#fdf0e6] text-[#8b5e3c]", icon: "◉" },
  drafting:      { bar: "bg-[#7a9e9f]", badge: "bg-[#e8f0ef] text-[#52796f]", icon: "✎" },
  done:          { bar: "bg-[#52796f]", badge: "bg-[#e5efec] text-[#3d6158]", icon: "✓" },
};

export function ChapterCard({ projectId, chapter }: ChapterCardProps) {
  const action =
    chapter.status === "done"
      ? `/project/${projectId}/chapter/${chapter.id}`
      : `/project/${projectId}/interview/${chapter.id}`;

  const isDone = chapter.status === "done";
  const cfg = statusConfig[chapter.status] || statusConfig.pending;

  return (
    <Link
      href={action}
      className="group relative flex gap-4 overflow-hidden rounded-2xl bg-white p-5 shadow-[0_1px_3px_0_rgba(0,0,0,0.04),0_1px_2px_-1px_rgba(0,0,0,0.03)] transition-all duration-200 hover:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 active:scale-[0.98]"
    >
      {/* Left color bar */}
      <div className={`absolute left-0 top-0 h-full w-1 ${cfg.bar}`} />

      {/* Chapter number badge */}
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-semibold ${
        isDone ? "bg-[#e5efec] text-[#52796f]" : "bg-[#f5f0e9] text-[#8b5e3c]"
      }`}>
        {chapter.order}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-[#b8a892] uppercase tracking-wider">第 {chapter.order} 章</p>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg.badge}`}>
            <span className="text-[10px]">{cfg.icon}</span>
            {statusLabels[chapter.status] || chapter.status}
          </span>
        </div>
        <h3 className="mt-1.5 text-base font-semibold text-[#2c2416] group-hover:text-[#8b5e3c] transition-colors">
          {chapter.title}
        </h3>
        {chapter.summary && (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[#7a7265]">{chapter.summary}</p>
        )}
        {!isDone && chapter.status !== "pending" && (
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[#f0eae2]">
            <div className={`h-full rounded-full transition-all ${
              chapter.status === "interviewing" ? "w-1/3 bg-[#c4946c]" : "w-2/3 bg-[#7a9e9f]"
            }`} />
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center text-[#d4c8b8] group-hover:text-[#8b5e3c] transition-colors">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </div>
    </Link>
  );
}
