"use client";

import type { OpportunityDetail, Proposal, SourceRef } from "@bidpilot/contracts";
import { useState } from "react";
import { relativeTime, titleCase } from "../../lib/api";
import { Icons } from "../icons";
import { Badge, Card, EmptyState, Ring, StatusBadge } from "../ui";

export function ComplianceTab({ detail, proposal, onSource }: { detail: OpportunityDetail; proposal: Proposal | null; onSource: (source: SourceRef, title: string) => void }) {
  const [onlyGaps, setOnlyGaps] = useState(false);
  const report = proposal?.compliance;
  if (!report) return <Card><EmptyState icon="shield" title="Compliance hasn't been checked yet">Validation runs automatically after the draft is written.</EmptyState></Card>;

  const requirements = new Map((detail.analysis?.requirements ?? []).map((r) => [r.id, r]));
  const sections = new Map(proposal!.sections.map((s) => [s.id, s]));
  const items = report.items.filter((i) => !onlyGaps || ["unaddressed", "partially_addressed", "needs_clarification"].includes(i.status));
  const count = (status: string) => report.items.filter((i) => i.status === status).length;
  const unsupported = proposal!.sections.flatMap((s) => s.claims.map((c) => ({ ...c, section: s.title }))).filter((c) => c.verificationStatus !== "supported");

  return (
    <div className="stack">
      <div className="compliance-hero">
        <Ring value={report.coverage} size={96} />
        <div className="grow">
          <h2>Requirement coverage</h2>
          <p className="muted">Checked {relativeTime(report.checkedAt)}. Partial responses count as half.</p>
          <div className="row-actions">
            <Badge tone="success">{count("addressed")} addressed</Badge>
            <Badge tone="warning">{count("partially_addressed") + count("needs_clarification")} partial</Badge>
            <Badge tone="danger">{count("unaddressed")} gaps</Badge>
            {count("not_applicable") > 0 && <Badge>{count("not_applicable")} N/A</Badge>}
          </div>
        </div>
        <div className="hero-metrics">
          <div className={report.mandatoryGaps ? "metric-bad" : "metric-good"}><strong>{report.mandatoryGaps}</strong><span>mandatory gaps</span></div>
          <div className={report.unsupportedClaims ? "metric-bad" : "metric-good"}><strong>{report.unsupportedClaims}</strong><span>claims to verify</span></div>
        </div>
      </div>

      {unsupported.length > 0 && (
        <Card title="Claims that need evidence or confirmation" padded={false}>
          <ul className="findings">
            {unsupported.map((c) => (
              <li key={c.id}>
                <StatusBadge status={c.verificationStatus} />
                <div className="grow">
                  <strong>“{c.text}”</strong>
                  <p className="muted small">{c.section}{c.note ? ` · ${c.note}` : ""}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Compliance matrix" actions={<label className="toggle"><input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} /> Gaps only</label>} padded={false}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ width: 90 }}>Code</th><th>Requirement</th><th style={{ width: 200 }}>Answered in</th><th style={{ width: 120 }}>Status</th></tr></thead>
            <tbody>
              {items.map((item) => {
                const r = requirements.get(item.requirementId);
                return (
                  <tr key={item.requirementId}>
                    <td>
                      <button className="link" onClick={() => r && onSource(r.source, `${r.code} source`)} title="View source">
                        <code className="code">{r?.code ?? "?"}</code>
                      </button>
                    </td>
                    <td>
                      <div className="req-text">{r?.description}{r?.mandatory && <Badge tone="danger">Mandatory</Badge>}</div>
                      <small className="muted">{item.note}</small>
                    </td>
                    <td className="small">{item.sectionIds.map((id) => sections.get(id)?.title).filter(Boolean).join(", ") || <span className="muted">—</span>}</td>
                    <td><StatusBadge status={item.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="muted small"><Icons.shield size={13} /> Categories: {Array.from(new Set((detail.analysis?.requirements ?? []).map((r) => titleCase(r.category)))).join(", ")}</p>
    </div>
  );
}
