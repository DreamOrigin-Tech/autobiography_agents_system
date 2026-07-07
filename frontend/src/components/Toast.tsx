"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  exiting: boolean;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

let _nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++_nextId;
    setToasts((prev) => [...prev, { id, type, message, exiting: false }]);

    // Auto-dismiss after 3.5s
    setTimeout(() => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
      );
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 200);
    }, 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}

      {/* Toast container */}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto toast-enter max-w-sm rounded-xl px-5 py-3 text-sm font-medium shadow-[0_8px_24px_-6px_rgba(0,0,0,0.12)] backdrop-blur-xl ${
              t.exiting ? "toast-exit" : ""
            } ${
              t.type === "success"
                ? "bg-[#ecfdf5] text-[#065f46] border border-[#a7f3d0]"
                : t.type === "error"
                ? "bg-[#fef2f2] text-[#991b1b] border border-[#fecaca]"
                : "bg-[#eef2ff] text-[#3730a3] border border-[#c7d2fe]"
            }`}
          >
            <span className="mr-2">
              {t.type === "success" ? "✓" : t.type === "error" ? "✕" : "✦"}
            </span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  return useContext(ToastContext);
}
