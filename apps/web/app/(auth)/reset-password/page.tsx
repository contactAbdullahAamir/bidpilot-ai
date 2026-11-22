"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { Button, Field } from "../../../components/ui";
import { api } from "../../../lib/api";

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await api("/auth/reset-password", { method: "POST", json: { token, password } });
      router.replace("/dashboard");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-card">
        <h2>Link incomplete</h2>
        <p className="muted">This reset link is missing its code. Open the link from your email again, or request a new one.</p>
        <p className="muted center"><Link href="/forgot-password">Request a new link</Link></p>
      </div>
    );
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <h2>Choose a new password</h2>
      <p className="muted">You'll be signed out on every other device.</p>
      {error && (
        <div className="alert alert-danger" role="alert">
          {error} {/expired|invalid/i.test(error) && <Link href="/forgot-password">Request a new link</Link>}
        </div>
      )}
      <Field label="New password" hint="At least 8 characters.">{(id) => <input id={id} type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />}</Field>
      <Field label="Confirm new password">{(id) => <input id={id} type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
      <Button variant="primary" type="submit" loading={busy} className="btn-block">Set password and sign in</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
