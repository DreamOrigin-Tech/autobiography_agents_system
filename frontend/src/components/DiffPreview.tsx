interface DiffPreviewProps { before: string; after: string; }

export function DiffPreview({ before, after }: DiffPreviewProps) {
  const bl = before.split("\n"); const al = after.split("\n");
  const maxLen = Math.max(bl.length, al.length);
  const removed = bl.filter((l, i) => l !== al[i]).length;
  const added = al.filter((l, i) => l !== bl[i]).length;

  return (
    <div className="overflow-hidden rounded-xl border border-[#e2e0f0] bg-white">
      <div className="flex items-center gap-2 border-b border-[#e2e0f0] bg-[#f8f7ff] px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-[#6b6889]"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>修改预览</span>
        <span className="ml-auto text-[11px]"><span className="text-[#ef4444]">-{removed}</span> <span className="text-[#10b981]">+{added}</span></span>
      </div>
      <div className="max-h-72 overflow-y-auto font-mono text-[13px] leading-6">
        {Array.from({ length: maxLen }).map((_, i) => {
          const b = bl[i] ?? undefined; const a = al[i] ?? undefined;
          if (b === a) return (<div key={i} className="flex border-b border-[#f0edff] px-4 last:border-0"><span className="w-8 shrink-0 select-none text-right text-[#d4d0e8]">{i + 1}</span><span className="ml-4 text-[#1e1b4b]">{a || " "}</span></div>);
          return (<div key={i}>
            {b !== undefined && b !== a && (<div className="flex border-b border-[#f0edff] bg-[#fef2f2] px-4"><span className="w-8 shrink-0 select-none text-right text-[#d4d0e8]">{i + 1}</span><span className="ml-4 text-[#ef4444] line-through">{b}</span></div>)}
            {a !== undefined && a !== b && (<div className="flex border-b border-[#f0edff] bg-[#ecfdf5] px-4"><span className="w-8 shrink-0 select-none text-right text-[#d4d0e8]">{i + 1}</span><span className="ml-4 text-[#10b981]">{a}</span></div>)}
          </div>);
        })}
      </div>
    </div>
  );
}
