"use client";

import { useState } from "react";
import { api } from "../lib/api";
import { Button } from "./ui";

/** Creates a private demo workspace, starts the AI analysis and opens it. */
export function DemoButton({ label = "Try the live demo", className = "", variant = "primary" }: { label?: string; className?: string; variant?: "primary" | "secondary" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ opportunityId: string; organizationId: string }>("/demo/start", { method: "POST" });
      try {
        window.localStorage.setItem("bidpilot.activeOrg", result.organizationId);
      } catch {
        /* storage unavailable */
      }
      window.location.href = `/opportunities/${result.opportunityId}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <span className="demo-cta">
      <Button variant={variant} size="lg" icon="sparkles" loading={busy} onClick={() => void start()} className={className}>
        {busy ? "Preparing your workspace…" : label}
      </Button>
      {error && <small className="demo-error" role="alert">{error}</small>}
    </span>
  );
}
