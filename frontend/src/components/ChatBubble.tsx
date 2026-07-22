interface ChatBubbleProps { role: string; content: string; }

export function ChatBubble({ role, content }: ChatBubbleProps) {
  const isAgent = role === "agent";
  const avatar = (
    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isAgent ? "bg-[#0f766e] text-white shadow-sm" : "bg-[#f0fdfa] text-[#0f766e]"}`}>
      {isAgent ? "AI" : "我"}
    </div>
  );
  const bubble = (
    <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${isAgent ? "rounded-bl-md border border-[#dfe5eb] bg-white text-[#1f2937] shadow-sm" : "rounded-br-md bg-[#0f766e] text-white shadow-sm"}`}>
      {isAgent && <p className="mb-1 text-[11px] font-medium text-[#0f766e]">AI 记者</p>}
      <p className="whitespace-pre-wrap">{content}</p>
    </div>
  );
  return (
    <div className={`flex items-end gap-2.5 mb-4 animate-fade-up ${isAgent ? "justify-start" : "justify-end"}`}>
      {isAgent ? <>{avatar}{bubble}</> : <>{bubble}{avatar}</>}
    </div>
  );
}
