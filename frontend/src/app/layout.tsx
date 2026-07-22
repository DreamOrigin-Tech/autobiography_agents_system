import type { Metadata, Viewport } from "next";
import AuthGate from "@/components/AuthGate";
import { StartupGate } from "@/components/StartupGate";
import { ToastProvider } from "@/components/Toast";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://jiumozhi.tech:6985"),
  title: "自传 Agent",
  description: "AI 驱动的自传写作助手 — 采访、写作、精准修改",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="min-h-full antialiased">
        <ToastProvider>
          <StartupGate>
            <AuthGate>{children}</AuthGate>
          </StartupGate>
        </ToastProvider>
      </body>
    </html>
  );
}
