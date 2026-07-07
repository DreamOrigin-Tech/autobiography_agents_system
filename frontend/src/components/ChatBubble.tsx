interface ChatBubbleProps {
  role: string;
  content: string;
}

export function ChatBubble({ role, content }: ChatBubbleProps) {
  const isAgent = role === "agent";

  const avatar = (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
        isAgent
          ? "bg-gradient-to-br from-[#c4946c] to-[#8b5e3c] text-white shadow-sm"
          : "bg-[#e7dfd4] text-[#8b5e3c]"
      }`}
    >
      {isAgent ? "记" : "我"}
    </div>
  );

  const bubble = (
    <div
      className={`max-w-[78%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
        isAgent
          ? "rounded-bl-md bg-white text-[#2c2416] shadow-[0_1px_3px_0_rgba(0,0,0,0.06)]"
          : "rounded-br-md bg-gradient-to-br from-[#8b5e3c] to-[#6d4a30] text-white shadow-md"
      }`}
    >
      {isAgent && (
        <p className="mb-1 text-[11px] font-medium text-[#c4946c]">AI 记者</p>
      )}
      <p className="whitespace-pre-wrap">{content}</p>
    </div>
  );

  return (
    <div className={`flex items-end gap-2.5 mb-4 animate-fade-up ${isAgent ? "justify-start" : "justify-end"}`}>
      {isAgent ? <>{avatar}{bubble}</> : <>{bubble}{avatar}</>}
    </div>
  );
}
