interface ChatBubbleProps { role: string; content: string; }

export function ChatBubble({ role, content }: ChatBubbleProps) {
  const isAgent = role === "agent";
  const avatar = (
    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isAgent ? "bg-gradient-to-br from-[#6366f1] to-[#06b6d4] text-white shadow-[0_2px_8px_rgba(99,102,241,0.3)]" : "bg-[#eef2ff] text-[#6366f1]"}`}>
      {isAgent ? "AI" : "我"}
    </div>
  );
  const bubble = (
    <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${isAgent ? "rounded-bl-md bg-white text-[#1e1b4b] shadow-[0_1px_3px_rgba(99,102,241,0.06)]" : "rounded-br-md bg-gradient-to-br from-[#6366f1] to-[#4f46e5] text-white shadow-md"}`}>
      {isAgent && <p className="mb-1 text-[11px] font-medium text-[#6366f1]">AI 记者</p>}
      <p className="whitespace-pre-wrap">{content}</p>
    </div>
  );
  return (
    <div className={`flex items-end gap-2.5 mb-4 animate-fade-up ${isAgent ? "justify-start" : "justify-end"}`}>
      {isAgent ? <>{avatar}{bubble}</> : <>{bubble}{avatar}</>}
    </div>
  );
}
