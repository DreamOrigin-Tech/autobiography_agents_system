"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface BottomNavProps {
  projectId: string;
  activeChapterId?: string;
}

const icons = {
  interview: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      <path d="M8 9h8M8 13h6" />
    </svg>
  ),
  chapters: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
    </svg>
  ),
  settings: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
  reading: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
      <line x1="8" y1="7" x2="16" y2="7" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  ),
};

export function BottomNav({ projectId, activeChapterId }: BottomNavProps) {
  const pathname = usePathname();
  const interviewHref = activeChapterId
    ? `/project/${projectId}/interview/${activeChapterId}`
    : `/project/${projectId}`;
  const chapterHref = activeChapterId
    ? `/project/${projectId}/chapter/${activeChapterId}`
    : `/project/${projectId}`;

  const tabs = [
    { href: interviewHref, label: "采访", icon: icons.interview, match: "/interview/" },
    { href: `/project/${projectId}`, label: "章节", icon: icons.chapters, match: `/project/${projectId}` },
    { href: `/project/${projectId}/settings`, label: "设置", icon: icons.settings, match: "/settings" },
    { href: chapterHref, label: "阅读", icon: icons.reading, match: "/chapter/" },
  ];

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 border-t border-[#e7dfd4] bg-white/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-lg">
        {tabs.map((tab) => {
          const active =
            tab.match === `/project/${projectId}`
              ? pathname === tab.match
              : pathname.includes(tab.match);
          return (
            <Link
              key={tab.label}
              href={tab.href}
              className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                active ? "text-[#8b5e3c]" : "text-[#b8a892] hover:text-[#7a7265]"
              }`}
            >
              {tab.icon}
              {tab.label}
              {active && (
                <span className="absolute bottom-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-[#8b5e3c]" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
