"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Icons } from "../../components/icons";
import { SessionProvider, useSession } from "../../components/session";
import { Spinner } from "../../components/ui";
import { api } from "../../lib/api";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: Icons.dashboard },
  { href: "/opportunities", label: "Opportunities", icon: Icons.briefcase },
  { href: "/knowledge", label: "Knowledge base", icon: Icons.library },
  { href: "/settings", label: "Team & settings", icon: Icons.settings }
];

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider
      fallback={
        <div className="boot">
          <span className="brand-mark">B</span>
          <Spinner />
        </div>
      }
    >
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}

function VerifyBanner({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | string>("idle");
  async function resend() {
    setState("sending");
    try {
      await api("/auth/resend-verification", { method: "POST" });
      setState("sent");
    } catch (e) {
      setState((e as Error).message);
    }
  }
  return (
    <div className="verify-banner" role="status">
      <Icons.alert size={16} />
      <span className="grow">
        Please confirm your email address. We sent a link to <strong>{email}</strong>.
        {state !== "idle" && state !== "sending" && state !== "sent" && <span className="verify-error"> {state}</span>}
      </span>
      {state === "sent" ? (
        <span className="verify-sent">Sent. Check your inbox.</span>
      ) : (
        <button className="link-btn" onClick={() => void resend()} disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Resend email"}</button>
      )}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { session, organizationName, role, logout, switchOrganization } = useSession();
  const [open, setOpen] = useState(false);
  const initials = session.user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className={`shell ${open ? "nav-open" : ""}`}>
      <aside className="sidebar">
        <Link href="/dashboard" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-mark">B</span>
          <span>BidPilot <em>AI</em></span>
        </Link>
        <div className="org-switch">
          <span className="org-label">Workspace</span>
          {session.memberships.length > 1 ? (
            <select value={session.activeOrganizationId} onChange={(e) => switchOrganization(e.target.value)} aria-label="Switch workspace">
              {session.memberships.map((m) => (
                <option key={m.organizationId} value={m.organizationId}>{m.organizationName}</option>
              ))}
            </select>
          ) : (
            <strong>{organizationName}</strong>
          )}
        </div>
        <nav className="nav">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const IconCmp = item.icon;
            return (
              <Link key={item.href} href={item.href} className={`nav-item ${active ? "nav-active" : ""}`} onClick={() => setOpen(false)}>
                <IconCmp size={17} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div
            className={`mode-chip mode-${session.aiMode ?? "offline"}`}
            title={session.aiMode === "heuristic" ? "No AI API key configured. The deterministic offline engine is drafting proposals." : session.aiModel ?? undefined}
          >
            <span className="badge-dot" />
            {session.aiMode === "claude" ? "AI: Claude" : session.aiMode === "openai" ? `AI: ${session.aiModel ?? "external model"}` : session.aiMode === "heuristic" ? "AI: offline engine" : "AI service offline"}
          </div>
          <div className="user">
            <span className="avatar">{initials}</span>
            <div className="user-meta">
              <strong>{session.user.name}</strong>
              <span>{role.replace("_", " ")}</span>
            </div>
            <button className="icon-btn" onClick={() => void logout()} aria-label="Sign out" title="Sign out"><Icons.logout size={16} /></button>
          </div>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn" onClick={() => setOpen(true)} aria-label="Open navigation"><Icons.menu /></button>
          <span className="brand-mark small">B</span>
          <strong>{organizationName}</strong>
        </header>
        {session.user.emailVerified === false && <VerifyBanner email={session.user.email} />}
        {children}
      </div>
    </div>
  );
}
