"use client";

import { useEffect, useState, type ReactNode } from "react";
import { SplashScreen } from "./SplashScreen";

const MIN_SPLASH_MS = 650;
const READY_PAUSE_MS = 120;
const EXIT_MS = 260;
const SPLASH_KEY = "splash_seen";

export function StartupGate({ children }: { children: ReactNode }) {
  const [showSplash, setShowSplash] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [status, setStatus] = useState<"connecting" | "ready">("connecting");

  useEffect(() => {
    if (sessionStorage.getItem(SPLASH_KEY) === "1") return;

    let cancelled = false;
    let exitTimer: number | undefined;
    let hideTimer: number | undefined;

    const showTimer = window.setTimeout(() => {
      if (cancelled) return;
      setShowSplash(true);
    }, 0);
    const readyTimer = window.setTimeout(() => {
      if (cancelled) return;
      setStatus("ready");
      exitTimer = window.setTimeout(() => {
        if (cancelled) return;
        setExiting(true);
        hideTimer = window.setTimeout(() => {
          if (cancelled) return;
          sessionStorage.setItem(SPLASH_KEY, "1");
          setShowSplash(false);
        }, EXIT_MS);
      }, READY_PAUSE_MS);
    }, MIN_SPLASH_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(showTimer);
      window.clearTimeout(readyTimer);
      if (exitTimer !== undefined) window.clearTimeout(exitTimer);
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    };
  }, []);

  return (
    <>
      {children}
      {showSplash && <SplashScreen exiting={exiting} status={status} />}
    </>
  );
}
