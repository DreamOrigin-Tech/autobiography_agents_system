import Link from "next/link";
import type { ChapterBrief } from "@/lib/types";
import { statusLabels } from "@/lib/api";

interface ChapterCardProps { projectId: string; chapter: ChapterBrief; }

const cfg: Record<string, { bar: string; badge: string; icon: string }> = {
  pending:       { bar: "bg-[#d4d0e8]", badge: "bg-[#f0edff] text-[#6b6889]", icon: "○" },
  interviewing:  { bar: "bg-[#a5b4fc]", badge: "bg-[#ede9fe] text-[#6366f1]", icon: "◉" },
  drafting:      { bar: "bg-[#818cf8]", badge: "bg-[#eef2ff] text-[#4f46e5]", icon: "✎" },
  done:          { bar: "bg-[#10b981]", badge: "bg-[#d1fae5] text-[#065f46]", icon: "✓" },
};

export function ChapterCard({ projectId, chapter }: ChapterCardProps) {
  const action = chapter.status === "done" ? `/project/${projectId}/chapter/${chapter.id}` : `/project/${projectId}/interview/${chapter.id}`;
  const isDone = chapter.status === "done";
  const c = cfg[chapter.status] || cfg.pending;

  return (
    <Link href={action} className="card card-hover group relative flex gap-4 overflow-hidden p-5 active:scale-[0.98]">
      <div className={`absolute left-0 top-0 h-full w-1 ${c.bar}`} />
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-semibold ${isDone ? "bg-[#d1fae5] text-[#10b981]" : "bg-[#eef2ff] text-[#6366f1]"}`}>{chapter.order}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-[#a5a0c8] uppercase tracking-wider">第 {chapter.order} 章</p>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${c.badge}`}><span className="text-[10px]">{c.icon}</span>{statusLabels[chapter.status] || chapter.status}</span>
        </div>
        <h3 className="mt-1.5 text-base font-semibold text-[#1e1b4b] group-hover:text-[#6366f1] transition-colors">{chapter.title}</h3>
        {chapter.summary && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[#6b6889]">{chapter.summary}</p>}
        {!isDone && chapter.status !== "pending" && (
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[#f0edff]">
            <div className={`h-full rounded-full transition-all ${chapter.status === "interviewing" ? "w-1/3 bg-[#a5b4fc]" : "w-2/3 bg-[#818cf8]"}`} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center text-[#d4d0e8] group-hover:text-[#6366f1] transition-colors">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
      </div>
    </Link>
  );
}
