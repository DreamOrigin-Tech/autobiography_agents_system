export function LoadingSpinner({ label = "加载中..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <div className="flex gap-1.5">
        <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#a5b4fc]" style={{ animationDelay: "0ms" }} />
        <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#818cf8]" style={{ animationDelay: "150ms" }} />
        <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-[#6366f1]" style={{ animationDelay: "300ms" }} />
      </div>
      <p className="text-sm text-[#a5a0c8]">{label}</p>
    </div>
  );
}

export function CardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-fade-up rounded-2xl bg-white p-5 shadow-sm" style={{ animationDelay: `${i * 80}ms` }}>
          <div className="flex items-start gap-4">
            <div className="skeleton h-11 w-11 rounded-xl" />
            <div className="flex-1 space-y-2.5">
              <div className="skeleton h-3 w-20" /><div className="skeleton h-5 w-3/4" /><div className="skeleton h-3 w-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <div className="space-y-6 px-4 py-4">
      {[85, 70, 90, 60].map((w, i) => (
        <div key={i} className={`flex items-end gap-2.5 ${i % 2 === 0 ? "" : "justify-end flex-row-reverse"}`}>
          <div className="skeleton h-9 w-9 rounded-full" />
          <div className="skeleton rounded-2xl px-4 py-4" style={{ width: `${w}%`, height: i % 2 === 0 ? 72 : 52 }} />
        </div>
      ))}
    </div>
  );
}
