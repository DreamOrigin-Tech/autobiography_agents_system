interface DiffPreviewProps {
  before: string;
  after: string;
}

export function DiffPreview({ before, after }: DiffPreviewProps) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const maxLen = Math.max(beforeLines.length, afterLines.length);

  const removed = beforeLines.filter((l, i) => l !== afterLines[i]).length;
  const added = afterLines.filter((l, i) => l !== beforeLines[i]).length;

  return (
    <div className="overflow-hidden rounded-xl border border-[#e7dfd4] bg-white">
      <div className="flex items-center gap-2 border-b border-[#e7dfd4] bg-[#fbf7f2] px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-[#7a7265]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          修改预览
        </span>
        <span className="ml-auto text-[11px]">
          <span className="text-[#c25b56]">-{removed}</span>{" "}
          <span className="text-[#52796f]">+{added}</span>
        </span>
      </div>

      <div className="max-h-72 overflow-y-auto font-mono text-[13px] leading-6">
        {Array.from({ length: maxLen }).map((_, i) => {
          const b = beforeLines[i] ?? undefined;
          const a = afterLines[i] ?? undefined;

          if (b === a) {
            return (
              <div key={i} className="flex border-b border-[#f5f0e9] px-4 last:border-0">
                <span className="w-8 shrink-0 select-none text-right text-[#d4c8b8]">{i + 1}</span>
                <span className="ml-4 text-[#2c2416]">{a || " "}</span>
              </div>
            );
          }

          return (
            <div key={i}>
              {b !== undefined && b !== a && (
                <div className="flex border-b border-[#f5f0e9] bg-[#fdf2f2] px-4">
                  <span className="w-8 shrink-0 select-none text-right text-[#d4c8b8]">{i + 1}</span>
                  <span className="ml-4 text-[#c25b56] line-through decoration-[#e0a0a0]">{b}</span>
                </div>
              )}
              {a !== undefined && a !== b && (
                <div className="flex border-b border-[#f5f0e9] bg-[#eef7f4] px-4">
                  <span className="w-8 shrink-0 select-none text-right text-[#d4c8b8]">{i + 1}</span>
                  <span className="ml-4 text-[#52796f]">{a}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
