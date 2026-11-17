"use client";

import type { Evidence, OpportunityDetail, Proposal, Qualification, SourceRef } from "@bidpilot/contracts";
import { useState } from "react";
import { api, formatDate } from "../../lib/api";
import { Icons } from "../icons";
import { useSession } from "../session";
import { Button, Card, EmptyState, Field, Modal, StatusBadge, useToast } from "../ui";

const COPY: Record<Qualification["recommendation"], { title: string; tone: string; icon: keyof typeof Icons }> = {
  go: { title: "Go: you meet every mandatory criterion", tone: "success", icon: "checkCircle" },
  conditional: { title: "Conditional: confirm before you bid", tone: "warning", icon: "alert" },
  no_go: { title: "No-go: a mandatory criterion isn't met", tone: "danger", icon: "xCircle" }
};

export function QualificationTab({ detail, proposal, reload, onSource }: { detail: OpportunityDetail; proposal: Proposal | null; reload: () => void; onSource: (source: SourceRef, title: string) => void }) {
  const { can } = useSession();
  const toast = useToast();
  const [overriding, setOverriding] = useState(false);
  const [form, setForm] = useState<{ recommendation: Qualification["recommendation"]; reason: string }>({ recommendation: "go", reason: "" });
  const q = detail.qualification;
  if (!q) return <Card><EmptyState icon="shield" title="Qualification hasn't run yet">BidPilot checks every mandatory eligibility requirement against your approved credentials.</EmptyState></Card>;

  const requirements = new Map((detail.analysis?.requirements ?? []).map((r) => [r.id, r]));
  const evidence = new Map<string, Evidence>((proposal?.evidence ?? []).map((e) => [e.id, e]));
  const effective = q.override?.recommendation ?? q.recommendation;
  const copy = COPY[effective];
  const IconCmp = Icons[copy.icon];

  async function submit() {
    try {
      await api(`/opportunities/${detail.id}/qualification/override`, { method: "POST", json: form });
      toast.success("Decision recorded in the audit log");
      setOverriding(false);
      reload();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <div className="stack">
      <div className={`verdict verdict-${copy.tone}`}>
        <IconCmp size={28} />
        <div className="grow">
          <h2>{copy.title}</h2>
          <p>{q.rationale}</p>
          {q.override && (
            <p className="override-note">
              <strong>Human decision:</strong> {q.override.actorName} changed the AI recommendation ({q.recommendation.replace("_", "-")}) to {q.override.recommendation.replace("_", "-")} on {formatDate(q.override.at)}: “{q.override.reason}”
            </p>
          )}
        </div>
        {can("overrideQualification") && <Button onClick={() => { setForm({ recommendation: effective, reason: "" }); setOverriding(true); }}>Record decision</Button>}
      </div>

      <Card title={`Mandatory eligibility (${q.findings.length})`} padded={false}>
        {q.findings.length === 0 ? <p className="muted pad">No mandatory eligibility criteria were found.</p> : (
          <ul className="findings">
            {q.findings.map((f) => {
              const r = requirements.get(f.requirementId);
              return (
                <li key={f.requirementId}>
                  <StatusBadge status={f.status} />
                  <div className="grow">
                    <strong>{r ? `${r.code}: ${r.description}` : "Requirement"}</strong>
                    <p className="muted">{f.note}</p>
                    <div className="row-actions">
                      {r && <button className="link small" onClick={() => onSource(r.source, `${r.code} source`)}><Icons.eye size={14} /> RFP page {r.source.page}</button>}
                      {f.evidenceIds.map((id) => evidence.get(id)).filter(Boolean).map((e) => (
                        <span key={e!.id} className="evidence-tag"><Icons.link size={12} /> {e!.assetTitle} v{e!.assetVersion}</span>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal
        open={overriding}
        onClose={() => setOverriding(false)}
        title="Record bid decision"
        description="The AI only recommends. An authorized person decides, and the reason is kept in the audit history."
        footer={<><Button variant="ghost" onClick={() => setOverriding(false)}>Cancel</Button><Button variant="primary" onClick={submit} disabled={form.reason.trim().length < 10}>Save decision</Button></>}
      >
        <div className="stack">
          <div className="segmented segmented-block">
            {(["go", "conditional", "no_go"] as const).map((r) => (
              <button key={r} className={form.recommendation === r ? "active" : ""} onClick={() => setForm({ ...form, recommendation: r })}>{r === "no_go" ? "No-go" : r === "go" ? "Go" : "Conditional"}</button>
            ))}
          </div>
          <Field label="Reason" hint="At least 10 characters, e.g. “Buyer confirmed a SOC 2 bridge letter is acceptable.”">
            {(id) => <textarea id={id} rows={4} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}
          </Field>
        </div>
      </Modal>
    </div>
  );
}
