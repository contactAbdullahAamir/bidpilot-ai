"use client";

import { can as canRole, type OrganizationRole, type Permission, type Session } from "@bidpilot/contracts";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setActiveOrganization } from "../lib/api";

type SessionValue = {
  session: Session;
  role: OrganizationRole;
  organizationName: string;
  can: (permission: Permission) => boolean;
  switchOrganization: (id: string) => void;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);
const ORG_KEY = "bidpilot.activeOrg";

export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);

  const load = useCallback(async () => {
    try {
      const stored = window.localStorage.getItem(ORG_KEY);
      if (stored) setActiveOrganization(stored);
    } catch {
      /* storage unavailable */
    }
    try {
      setSession(await api<Session>("/auth/me"));
    } catch {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session) return <>{fallback}</>;
  const membership = session.memberships.find((m) => m.organizationId === session.activeOrganizationId) ?? session.memberships[0];
  setActiveOrganization(membership.organizationId);

  const value: SessionValue = {
    session,
    role: membership.role,
    organizationName: membership.organizationName,
    can: (permission) => canRole(membership.role, permission),
    switchOrganization: (id) => {
      try {
        window.localStorage.setItem(ORG_KEY, id);
      } catch {
        /* ignore */
      }
      setActiveOrganization(id);
      window.location.href = "/dashboard";
    },
    logout: async () => {
      await api("/auth/logout", { method: "POST" }).catch(() => undefined);
      try {
        window.localStorage.removeItem(ORG_KEY);
      } catch {
        /* ignore */
      }
      window.location.href = session.demo ? "/" : "/login";
    }
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
