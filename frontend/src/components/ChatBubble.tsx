interface ChatBubbleProps { role: string; content: string; agentLabel?: string; }

export function ChatBubble({ role, content, agentLabel = "AI 记者" }: ChatBubbleProps) {
  const isAgent = role === "agent";
  const label = roleLabel(role, agentLabel);
  const avatar = (
    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isAgent ? "bg-[#0f766e] text-white shadow-sm" : "bg-[#f0fdfa] text-[#0f766e]"}`}>
      {roleAvatar(role)}
    </div>
  );
  const bubble = (
    <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${isAgent ? "rounded-bl-md border border-[#dfe5eb] bg-white text-[#1f2937] shadow-sm" : "rounded-br-md bg-[#0f766e] text-white shadow-sm"}`}>
      {(isAgent || role !== "user") && <p className={`mb-1 text-[11px] font-medium ${isAgent ? "text-[#0f766e]" : "text-white/80"}`}>{label}</p>}
      <p className="whitespace-pre-wrap">{content}</p>
    </div>
  );
  return (
    <div className={`flex items-end gap-2.5 mb-4 animate-fade-up ${isAgent ? "justify-start" : "justify-end"}`}>
      {isAgent ? <>{avatar}{bubble}</> : <>{bubble}{avatar}</>}
    </div>
  );
}

function roleLabel(role: string, agentLabel: string): string {
  if (role === "agent") return agentLabel;
  if (role === "interviewer") return "采访员";
  if (role === "note") return "现场备注";
  return "受访者";
}

function roleAvatar(role: string): string {
  if (role === "agent") return "AI";
  if (role === "interviewer") return "采";
  if (role === "note") return "记";
  return "我";
}
