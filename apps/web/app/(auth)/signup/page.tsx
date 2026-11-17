"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { api } from "../../../lib/api";
import { Button, Field } from "../../../components/ui";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", organizationName: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/auth/signup", { method: "POST", json: form });
      router.replace("/dashboard?welcome=1");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="auth-card" onSubmit={submit}>
      <h2>Create your workspace</h2>
      <p className="muted">Free to try. Takes 30 seconds.</p>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      <Field label="Your name">{(id) => <input id={id} autoComplete="name" required value={form.name} onChange={set("name")} autoFocus />}</Field>
      <Field label="Company">{(id) => <input id={id} autoComplete="organization" required value={form.organizationName} onChange={set("organizationName")} placeholder="Northstar Digital Solutions" />}</Field>
      <Field label="Work email">{(id) => <input id={id} type="email" autoComplete="email" required value={form.email} onChange={set("email")} />}</Field>
      <Field label="Password" hint="At least 8 characters.">{(id) => <input id={id} type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set("password")} />}</Field>
      <Button variant="primary" type="submit" loading={busy} className="btn-block">Create workspace</Button>
      <p className="muted center">Already have an account? <Link href="/login">Sign in</Link></p>
    </form>
  );
}
