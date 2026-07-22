import Link from "next/link";
import type { ChapterBrief } from "@/lib/types";
import { statusLabels } from "@/lib/api";

interface ChapterCardProps { projectId: string; chapter: ChapterBrief; }

const cfg: Record<string, { bar: string; badge: string; icon: string }> = {
  pending:       { bar: "bg-[#cbd5e1]", badge: "bg-[#f0fdfa] text-[#667085]", icon: "○" },
  interviewing:  { bar: "bg-[#5eead4]", badge: "bg-[#ccfbf1] text-[#0f766e]", icon: "◉" },
  drafting:      { bar: "bg-[#d97706]", badge: "bg-[#fffaeb] text-[#b54708]", icon: "✎" },
  done:          { bar: "bg-[#0f9d73]", badge: "bg-[#d1fae5] text-[#065f46]", icon: "✓" },
};

export function ChapterCard({ projectId, chapter }: ChapterCardProps) {
  const action = chapter.status === "done" ? `/project/${projectId}/chapter/${chapter.id}` : `/project/${projectId}/interview/${chapter.id}`;
  const isDone = chapter.status === "done";
  const c = cfg[chapter.status] || cfg.pending;

  return (
    <Link href={action} className="card card-hover group relative flex gap-4 overflow-hidden p-5 active:scale-[0.98]">
      <div className={`absolute left-0 top-0 h-full w-1 ${c.bar}`} />
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-semibold ${isDone ? "bg-[#d1fae5] text-[#0f9d73]" : "bg-[#f0fdfa] text-[#0f766e]"}`}>{chapter.order}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-[#98a2b3] uppercase tracking-wider">第 {chapter.order} 章</p>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${c.badge}`}><span className="text-[10px]">{c.icon}</span>{statusLabels[chapter.status] || chapter.status}</span>
        </div>
        <h3 className="mt-1.5 text-base font-semibold text-[#1f2937] group-hover:text-[#0f766e] transition-colors">{chapter.title}</h3>
        {chapter.summary && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[#667085]">{chapter.summary}</p>}
        {!isDone && chapter.status !== "pending" && (
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[#f0fdfa]">
            <div className={`h-full rounded-full transition-all ${chapter.status === "interviewing" ? "w-1/3 bg-[#5eead4]" : "w-2/3 bg-[#d97706]"}`} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center text-[#cbd5e1] group-hover:text-[#0f766e] transition-colors">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
      </div>
    </Link>
  );
}
