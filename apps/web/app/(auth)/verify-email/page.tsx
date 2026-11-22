"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Spinner } from "../../../components/ui";
import { api } from "../../../lib/api";

function Verify() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<{ status: "working" | "done" | "error"; message?: string }>({ status: "working" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) return setState({ status: "error", message: "This link is missing its code. Open the link from your email again." });
    api("/auth/verify-email", { method: "POST", json: { token } })
      .then(() => setState({ status: "done" }))
      .catch((e: Error) => setState({ status: "error", message: e.message }));
  }, [token]);

  return (
    <div className="auth-card">
      {state.status === "working" && (
        <>
          <h2>Confirming your email</h2>
          <p className="muted"><Spinner /> One moment…</p>
        </>
      )}
      {state.status === "done" && (
        <>
          <h2>Email confirmed</h2>
          <p className="muted">Thanks! Your email address is verified.</p>
          <p className="center"><Link className="btn btn-primary" href="/dashboard">Go to your workspace</Link></p>
        </>
      )}
      {state.status === "error" && (
        <>
          <h2>We couldn't confirm your email</h2>
          <div className="alert alert-danger" role="alert">{state.message}</div>
          <p className="muted">Sign in and use “Resend email” on the banner to get a new link.</p>
          <p className="muted center"><Link href="/login">Go to sign in</Link></p>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
