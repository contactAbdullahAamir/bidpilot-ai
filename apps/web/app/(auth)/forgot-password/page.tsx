"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Button, Field } from "../../../components/ui";
import { api } from "../../../lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/forgot-password", { method: "POST", json: { email } });
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="auth-card">
        <h2>Check your email</h2>
        <p className="muted">If an account exists for <strong>{email}</strong>, we've sent a link to reset your password. It expires in 1 hour.</p>
        <p className="muted center"><Link href="/login">Back to sign in</Link></p>
      </div>
    );
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <h2>Reset your password</h2>
      <p className="muted">Enter your work email and we'll send you a reset link.</p>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      <Field label="Work email">{(id) => <input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}</Field>
      <Button variant="primary" type="submit" loading={busy} className="btn-block">Send reset link</Button>
      <p className="muted center"><Link href="/login">Back to sign in</Link></p>
    </form>
  );
}
