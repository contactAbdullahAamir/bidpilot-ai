"use client";

import type { InvitationPreview } from "@bidpilot/contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { Button, Field, Spinner } from "../../../components/ui";
import { api, titleCase } from "../../../lib/api";

function AcceptInvite() {
  const token = useSearchParams().get("token") ?? "";
  const [invite, setInvite] = useState<InvitationPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(token ? null : "This invitation link is missing its code. Open the link from your email again.");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    api<InvitationPreview>(`/auth/invitations/${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch((e: Error) => setLoadError(e.message));
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ organizationId: string }>("/auth/invitations/accept", {
        method: "POST",
        json: invite?.accountExists ? { token, password } : { token, name, password }
      });
      try {
        window.localStorage.setItem("bidpilot.activeOrg", result.organizationId);
      } catch {
        /* storage unavailable */
      }
      window.location.href = "/dashboard";
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="auth-card">
        <h2>Invitation unavailable</h2>
        <div className="alert alert-danger" role="alert">{loadError}</div>
        <p className="muted center"><Link href="/login">Go to sign in</Link></p>
      </div>
    );
  }
  if (!invite) {
    return (
      <div className="auth-card">
        <p className="muted"><Spinner /> Loading invitation…</p>
      </div>
    );
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <h2>Join {invite.organizationName}</h2>
      <p className="muted">
        {invite.invitedBy ? `${invite.invitedBy} invited you` : "You've been invited"} to join as <strong>{titleCase(invite.role)}</strong>.
      </p>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      <Field label="Email">{(id) => <input id={id} type="email" value={invite.email} readOnly disabled />}</Field>
      {invite.accountExists ? (
        <Field label="Your BidPilot password" hint={<Link href="/forgot-password">Forgot your password?</Link>}>
          {(id) => <input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />}
        </Field>
      ) : (
        <>
          <Field label="Your name">{(id) => <input id={id} autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
          <Field label="Create a password" hint="At least 8 characters.">
            {(id) => <input id={id} type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
        </>
      )}
      <Button variant="primary" type="submit" loading={busy} className="btn-block">Accept and join</Button>
    </form>
  );
}

export default function InvitePage() {
  return (
    <Suspense>
      <AcceptInvite />
    </Suspense>
  );
}
