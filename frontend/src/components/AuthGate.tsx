"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { api, getWeChatLoginUrl } from "@/lib/api";
import type { AuthProviders, AuthUser } from "@/lib/types";

interface AuthGateProps {
  children: ReactNode;
}

export default function AuthGate({ children }: AuthGateProps) {
  const pathname = usePathname();
  const isPublicShare = pathname.startsWith("/share/");
  const [status, setStatus] = useState<"checking" | "authenticated" | "anonymous">(
    isPublicShare ? "authenticated" : "checking",
  );
  const [user, setUser] = useState<AuthUser | null>(null);
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [authError, setAuthError] = useState("");

  const loadUser = useCallback(async () => {
    try {
      const currentUser = await api.getMe();
      setUser(currentUser);
      setStatus("authenticated");
    } catch (error) {
      if (error instanceof Error && error.message === "请先登录") {
        setStatus("anonymous");
        return;
      }
      setAuthError(error instanceof Error ? error.message : "无法连接登录服务");
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    if (isPublicShare) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.all([
        loadUser(),
        api.getAuthProviders().then(setProviders).catch((error: unknown) => {
          if (!cancelled) {
            setAuthError(error instanceof Error ? error.message : "无法加载登录方式");
          }
        }),
      ]);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isPublicShare, loadUser]);

  if (isPublicShare) return <>{children}</>;
  if (status === "checking") return <AuthChecking />;
  if (status === "anonymous") {
    return (
      <LoginScreen
        providers={providers}
        initialError={getAuthErrorFromUrl() || authError}
        onLoggedIn={loadUser}
      />
    );
  }
  if (!user) return <AuthChecking />;

  return (
    <div className="min-h-screen">
      {providers?.dev_auth_bypass !== true && (
        <AccountBar user={user} onLoggedOut={() => setStatus("anonymous")} />
      )}
      {children}
    </div>
  );
}

function LoginScreen({
  providers,
  initialError,
  onLoggedIn,
}: {
  providers: AuthProviders | null;
  initialError: string;
  onLoggedIn: () => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);

  async function handlePasswordLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.login(password.trim());
      await onLoggedIn();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  function handleWeChatLogin() {
    setError("");
    const nextPath = `${window.location.pathname}${window.location.search}`;
    window.location.assign(getWeChatLoginUrl(nextPath));
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <section className="w-full max-w-md">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0f766e] text-xl font-bold text-white shadow-[0_10px_24px_-12px_rgba(15,118,110,0.7)]">
            自
          </div>
          <p className="mt-5 text-sm font-semibold text-[#0f766e]">自传 Agent</p>
          <h1 className="mt-2 text-3xl font-bold text-[#1f2937]">登录您的自传空间</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[#667085]">
            登录后，您的采访记录、章节草稿和写作偏好只属于您。
          </p>
        </div>

        <div className="card mt-8 p-6 sm:p-8">
          {error && (
            <div className="rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm leading-relaxed text-[#b42318]">
              {error}
            </div>
          )}

          {providers?.wechat_enabled && (
            <button
              type="button"
              onClick={handleWeChatLogin}
              className="mt-1 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#07c160] px-5 py-3 font-medium text-white transition hover:bg-[#06ad55] hover:shadow-[0_4px_12px_-2px_rgba(7,193,96,0.35)]"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-xs font-bold">
                微
              </span>
              微信扫码登录
            </button>
          )}

          {providers?.wechat_enabled && providers.password_enabled && (
            <div className="my-6 flex items-center gap-3 text-xs text-[#98a2b3]">
              <span className="h-px flex-1 bg-[#eaecf0]" />
              <span>本地管理员回退</span>
              <span className="h-px flex-1 bg-[#eaecf0]" />
            </div>
          )}

          {providers?.password_enabled && (
            <form onSubmit={handlePasswordLogin}>
              <label htmlFor="access-password" className="block text-sm font-medium text-[#344054]">
                管理员密码
              </label>
              <input
                id="access-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="输入管理员密码"
                className="input mt-2 w-full text-base"
                autoComplete="current-password"
                autoFocus={!providers.wechat_enabled}
              />
              <button
                type="submit"
                disabled={busy || !password.trim()}
                className="btn-primary mt-4 w-full py-3.5"
              >
                {busy ? "正在验证..." : "进入工作台"}
              </button>
            </form>
          )}

          {providers && !providers.wechat_enabled && !providers.password_enabled && (
            <div className="rounded-xl border border-[#fedf89] bg-[#fffaeb] px-4 py-3 text-sm leading-relaxed text-[#b54708]">
              <p>管理员尚未配置登录方式，请先配置微信开放平台参数或 `ACCESS_PASSWORD`。</p>
              {providers.wechat_issues && providers.wechat_issues.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                  {providers.wechat_issues.map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              )}
              {providers.wechat_redirect_uri && (
                <p className="mt-2 break-all text-xs">
                  微信回调地址：{providers.wechat_redirect_uri}
                </p>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function AccountBar({ user, onLoggedOut }: { user: AuthUser; onLoggedOut: () => void }) {
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    setBusy(true);
    try {
      await api.logout();
    } finally {
      setBusy(false);
      onLoggedOut();
    }
  }

  return (
    <div className="border-b border-[#eaecf0] bg-white/90">
      <div className="mx-auto flex min-h-10 max-w-6xl items-center justify-end gap-3 px-5 sm:px-8">
        <span className="max-w-40 truncate text-xs text-[#667085]">{user.name}</span>
        <button
          type="button"
          onClick={handleLogout}
          disabled={busy}
          className="text-xs font-medium text-[#667085] transition hover:text-[#b42318] disabled:opacity-50"
        >
          {busy ? "退出中..." : "退出登录"}
        </button>
      </div>
    </div>
  );
}

function AuthChecking() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#dfe5eb] border-t-[#0f766e]" />
        <p className="mt-4 text-sm text-[#667085]">正在打开您的自传空间...</p>
      </div>
    </main>
  );
}

function getAuthErrorFromUrl(): string {
  if (typeof window === "undefined") return "";
  const error = new URLSearchParams(window.location.search).get("auth_error");
  return error || "";
}
