"use client";

type SplashScreenProps = { exiting?: boolean; status: "connecting" | "ready" };

const statusText = { connecting: "正在整理书页...", ready: "准备就绪" };

export function SplashScreen({ exiting = false, status }: SplashScreenProps) {
  return (
    <div className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#f7f8fa] px-6 transition-opacity duration-300 ${exiting ? "pointer-events-none opacity-0" : "opacity-100"}`} aria-hidden={exiting}>
      <div className="splash-rise flex flex-col items-center text-center">
        <div className="relative mb-8 flex h-20 w-20 items-center justify-center">
          <span className="absolute inset-0 rounded-2xl bg-[#0f766e]/12 splash-pulse" />
          <span className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-[#0f766e] text-3xl font-bold text-white shadow-lg shadow-[#0f766e]/20">自</span>
          <span className="absolute -bottom-1 h-1 w-8 rounded-full bg-[#d97706]" />
        </div>
        <p className="text-xs font-semibold text-[#0f766e]">自传 Agent</p>
        <h1 className="mt-2 text-2xl font-bold text-[#1f2937]">把故事慢慢写下来</h1>
        <p className="mt-3 max-w-xs text-sm leading-relaxed text-[#667085]">采访、写作、修订，都在同一本书里完成。</p>
        <div className="mt-9 w-40 overflow-hidden rounded-full bg-[#dfe5eb]/80">
          <div className={`h-1 rounded-full bg-[#0f766e] ${status === "ready" ? "w-full transition-all duration-300" : "splash-progress w-2/3"}`} />
        </div>
        <p className="mt-3 text-xs text-[#98a2b3]">{statusText[status]}</p>
      </div>
    </div>
  );
}
