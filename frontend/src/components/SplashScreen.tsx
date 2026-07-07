"use client";

type SplashScreenProps = {
  exiting?: boolean;
  status: "connecting" | "ready" | "offline";
};

const statusText = {
  connecting: "正在连接服务...",
  ready: "准备就绪",
  offline: "服务未连接，仍可浏览界面",
};

export function SplashScreen({ exiting = false, status }: SplashScreenProps) {
  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-[#fbf7f2] via-[#f5f0e9] to-[#e7dfd4] px-6 transition-opacity duration-500 ${
        exiting ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      aria-hidden={exiting}
    >
      <div className="splash-rise flex flex-col items-center text-center">
        <div className="relative mb-10 flex h-24 w-24 items-center justify-center">
          <span className="absolute inset-0 rounded-[2rem] bg-[#c4946c]/20 splash-pulse" />
          <span className="relative flex h-24 w-24 items-center justify-center rounded-[2rem] bg-gradient-to-br from-[#c4946c] to-[#8b5e3c] text-4xl font-bold text-white shadow-xl shadow-[#8b5e3c]/20">
            自
          </span>
          <span className="absolute -inset-1.5 rounded-[2.25rem] border-2 border-[#e7dfd4] opacity-60" />
        </div>

        <p className="text-xs font-semibold tracking-[0.25em] text-[#8b5e3c]">AUTOBIOGRAPHY</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-[#2c2416]">自传</h1>
        <p className="mt-3 max-w-xs text-base leading-relaxed text-[#7a7265]">
          AI 记者主动采访，按章节书写人生故事
        </p>

        <div className="mt-12 w-48 overflow-hidden rounded-full bg-[#e7dfd4]/80">
          <div
            className={`h-1 rounded-full bg-gradient-to-r from-[#c4946c] to-[#8b5e3c] ${
              status === "ready" ? "w-full transition-all duration-500" : "splash-progress w-2/3"
            }`}
          />
        </div>

        <p className="mt-4 text-sm text-[#b8a892]">{statusText[status]}</p>
      </div>

      <p className="absolute bottom-10 text-xs tracking-widest text-[#d4c8b8]">采 访 · 写 作 · 珍 藏</p>
    </div>
  );
}
