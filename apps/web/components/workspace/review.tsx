"use client";

import type { OpportunityDetail, Proposal, ReviewDecision } from "@bidpilot/contracts";
import { useState } from "react";
import { api, formatDate, relativeTime } from "../../lib/api";
import { Icons } from "../icons";
import { useSession } from "../session";
import { Button, Card, EmptyState, Field, StatusBadge, useToast } from "../ui";

export function ReviewTab({ detail, proposal, reload, busy }: { detail: OpportunityDetail; proposal: Proposal | null; reload: () => void; busy: boolean }) {
  const { can } = useSession();
  const toast = useToast();
  const [rationale, setRationale] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);

  if (!proposal) return <Card><EmptyState icon="eye" title="Nothing to review yet">The draft appears here after the analysis finishes.</EmptyState></Card>;
  const report = proposal.compliance;
  const risky = Boolean(report && (report.mandatoryGaps > 0 || report.unsupportedClaims > 0));

  async function submitForReview() {
    setSubmitting("submit");
    try {
      await api(`/opportunities/${detail.id}/proposal/submit`, { method: "POST" });
      toast.success("Sent for review");
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setSubmitting(null);
    }
  }

  async function decide(decision: ReviewDecision) {
    setSubmitting(decision);
    try {
      await api(`/opportunities/${detail.id}/proposal/reviews`, { method: "POST", json: { decision, rationale } });
      toast.success(decision === "approve" ? "Approved. This version is now locked and ready to export." : decision === "reject" ? "Proposal rejected" : "Changes requested");
      setRationale("");
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setSubmitting(null);
    }
  }

  async function download() {
    setSubmitting("export");
    try {
      const response = await fetch(`/api/v1/opportunities/${detail.id}/proposal/export.pdf`, { credentials: "same-origin" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.message ?? "Export failed");
      const blob = await response.blob();
      const name = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "proposal.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e);
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="grid-main">
      <div className="stack">
        {proposal.status === "approved" ? (
          <div className="verdict verdict-success">
            <Icons.shield size={28} />
            <div className="grow">
              <h2>Version {proposal.version} is approved and locked</h2>
              <p>Any edit creates a new version that needs approval again. The PDF is rendered only from this frozen snapshot.</p>
              <p className="checksum">SHA-256 {proposal.approvedChecksum}</p>
            </div>
            <Button variant="primary" icon="download" loading={submitting === "export"} onClick={download}>Download PDF</Button>
          </div>
        ) : proposal.status === "in_review" ? (
          <Card title={`Review version ${proposal.version}`}>
            {risky && (
              <div className="alert alert-warning">
                <Icons.alert size={16} /> This version has {report!.mandatoryGaps} mandatory gap{report!.mandatoryGaps === 1 ? "" : "s"} and {report!.unsupportedClaims} claim{report!.unsupportedClaims === 1 ? "" : "s"} to verify. To approve anyway, explain why below.
              </div>
            )}
            {can("review") ? (
              <div className="stack">
                <Field label="Review notes" hint={risky ? "Required to approve with open issues (10+ characters)." : "Shared with the team and stored in the audit log."}>
                  {(id) => <textarea id={id} rows={4} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="What's good, what must change…" />}
                </Field>
                <div className="row-actions">
                  <Button variant="primary" icon="check" loading={submitting === "approve"} disabled={busy || (risky && rationale.trim().length < 10)} onClick={() => decide("approve")}>Approve & lock</Button>
                  <Button icon="edit" loading={submitting === "request_changes"} disabled={busy || rationale.trim().length < 3} onClick={() => decide("request_changes")}>Request changes</Button>
                  <Button variant="danger" loading={submitting === "reject"} disabled={busy || rationale.trim().length < 3} onClick={() => decide("reject")}>Reject</Button>
                </div>
              </div>
            ) : (
              <p className="muted">Waiting for a reviewer. Your role can't approve proposals.</p>
            )}
          </Card>
        ) : (
          <Card title="Send for review">
            <p className="muted">When the draft is ready, send it to a reviewer. They can approve and lock this version, request changes, or reject it.</p>
            <ul className="readiness">
              <li className={report ? "ok" : "bad"}>{report ? <Icons.checkCircle size={16} /> : <Icons.xCircle size={16} />} Validation has run on this version</li>
              <li className={report && report.mandatoryGaps === 0 ? "ok" : "warn"}>{report && report.mandatoryGaps === 0 ? <Icons.checkCircle size={16} /> : <Icons.alert size={16} />} No mandatory requirement gaps{report ? ` (${report.mandatoryGaps})` : ""}</li>
              <li className={report && report.unsupportedClaims === 0 ? "ok" : "warn"}>{report && report.unsupportedClaims === 0 ? <Icons.checkCircle size={16} /> : <Icons.alert size={16} />} All claims supported by evidence{report ? ` (${report.unsupportedClaims} open)` : ""}</li>
              <li className={(detail.analysis?.deadlines ?? []).every((d) => !d.ambiguous || d.confirmed) ? "ok" : "warn"}>
                {(detail.analysis?.deadlines ?? []).every((d) => !d.ambiguous || d.confirmed) ? <Icons.checkCircle size={16} /> : <Icons.alert size={16} />} Ambiguous deadlines confirmed
              </li>
            </ul>
            {can("editProposal") && (
              <Button variant="primary" icon="arrowRight" loading={submitting === "submit"} disabled={busy || !report} onClick={submitForReview}>Send for review</Button>
            )}
          </Card>
        )}
      </div>
      <Card title="Decision history" padded={false}>
        {proposal.reviews.length === 0 ? <p className="muted pad">No decisions yet.</p> : (
          <ul className="history">
            {proposal.reviews.map((r) => (
              <li key={r.id}>
                <StatusBadge status={r.decision === "approve" ? "approved" : r.decision === "reject" ? "rejected" : "needs_revision"} />
                <div className="grow">
                  <strong>{r.reviewerName} <span className="muted">({r.reviewerRole.replace("_", " ")})</span></strong>
                  <small className="muted">Version {r.proposalVersion} · {formatDate(r.createdAt)} · {relativeTime(r.createdAt)}</small>
                  {r.rationale && <p>“{r.rationale}”</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
