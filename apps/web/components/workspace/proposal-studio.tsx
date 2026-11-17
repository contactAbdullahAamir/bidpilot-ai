"use client";

import type { Evidence, OpportunityDetail, Proposal, ProposalSection, SourceRef } from "@bidpilot/contracts";
import { useEffect, useMemo, useState } from "react";
import { api, titleCase } from "../../lib/api";
import { Icons } from "../icons";
import { Markdown } from "../markdown";
import { useSession } from "../session";
import { Badge, Button, Card, EmptyState, Field, Modal, StatusBadge, Tabs, useToast } from "../ui";

export function ProposalStudio({
  detail,
  proposal,
  reload,
  onSource,
  busy
}: {
  detail: OpportunityDetail;
  proposal: Proposal | null;
  reload: () => void;
  onSource: (source: SourceRef, title: string) => void;
  busy: boolean;
}) {
  const { can } = useSession();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState<"requirements" | "claims" | "evidence">("claims");
  const [focusLabel, setFocusLabel] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const [revision, setRevision] = useState<{ sectionIds: string[]; feedback: string }>({ sectionIds: [], feedback: "" });

  const sections = proposal?.sections ?? [];
  const section = sections.find((s) => s.id === selectedId) ?? sections[0];
  const labels = useMemo(() => new Map((proposal?.evidence ?? []).map((e, i) => [`E${i + 1}`, e])), [proposal]);
  const labelOf = useMemo(() => new Map((proposal?.evidence ?? []).map((e, i) => [e.id, `E${i + 1}`])), [proposal]);
  const requirements = useMemo(() => new Map((detail.analysis?.requirements ?? []).map((r) => [r.id, r])), [detail.analysis]);
  const editable = can("editProposal") && !busy;

  useEffect(() => {
    if (!editing) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (draft !== section?.content) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [editing, draft, section]);

  if (!proposal || sections.length === 0) {
    return <Card><EmptyState icon="edit" title={busy ? "Writers are drafting…" : "No draft yet"}>{busy ? "Sections appear here as soon as the writers finish." : "Run the analysis to generate an evidence-backed first draft."}</EmptyState></Card>;
  }

  function select(next: ProposalSection) {
    if (editing && draft !== section.content && !window.confirm("Discard unsaved changes?")) return;
    setEditing(false);
    setSelectedId(next.id);
    setFocusLabel(null);
  }

  async function save() {
    setSaving(true);
    try {
      await api(`/opportunities/${detail.id}/proposal/sections/${section.id}`, { method: "PATCH", json: { content: draft } });
      toast.success(proposal!.status === "approved" ? "Saved as a new version. The previous approval no longer applies." : "Section saved");
      setEditing(false);
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  }

  async function requestRevision() {
    try {
      await api(`/opportunities/${detail.id}/revise`, { method: "POST", json: revision });
      toast.success("Revision started. Only the selected sections and validation will re-run.");
      setRevising(false);
      reload();
    } catch (e) {
      toast.error(e);
    }
  }

  const cite = (label: string) => {
    setFocusLabel(label);
    setPanel("evidence");
  };
  const citeTone = (label: string) => {
    const evidence = labels.get(label);
    if (!evidence) return "missing" as const;
    const claim = section.claims.find((c) => c.evidenceIds.includes(evidence.id));
    return claim && claim.verificationStatus !== "supported" ? ("warn" as const) : ("ok" as const);
  };
  const sectionEvidence = section.evidenceIds.map((id) => (proposal.evidence.find((e) => e.id === id))).filter((e): e is Evidence => Boolean(e));
  const issues = (s: ProposalSection) => s.claims.filter((c) => c.verificationStatus !== "supported").length + (s.content.match(/\[Needs input/g)?.length ?? 0);

  return (
    <div className="studio">
      <aside className="studio-nav">
        <div className="studio-nav-head">
          <span className="muted small">Version {proposal.version}</span>
          <StatusBadge status={proposal.status} />
        </div>
        <ol>
          {sections.map((s, i) => {
            const count = issues(s);
            return (
              <li key={s.id}>
                <button className={s.id === section.id ? "active" : ""} onClick={() => select(s)}>
                  <span className="studio-num">{i + 1}</span>
                  <span className="grow">
                    <strong>{s.title}</strong>
                    <small>{s.writer === "technical" ? "Technical" : "Management"} writer{s.editedByHuman ? " · edited" : ""}</small>
                  </span>
                  {count > 0 ? <span className="issue-count" title={`${count} item(s) need attention`}>{count}</span> : <Icons.checkCircle size={15} className="ok-icon" />}
                </button>
              </li>
            );
          })}
        </ol>
        {editable && (
          <Button size="sm" icon="wand" className="btn-block" onClick={() => { setRevision({ sectionIds: [section.id], feedback: "" }); setRevising(true); }}>
            Ask AI to revise
          </Button>
        )}
      </aside>

      <article className="studio-doc">
        <header className="studio-doc-head">
          <div>
            <h2>{section.title}</h2>
            <div className="row-actions">
              <StatusBadge status={section.status} />
              <span className="muted small">v{section.version} · {section.requirementIds.length} requirements · {section.claims.length} claims</span>
            </div>
          </div>
          {editable && !editing && <Button size="sm" icon="edit" onClick={() => { setDraft(section.content); setEditing(true); }}>Edit</Button>}
        </header>
        {proposal.status === "approved" && editing && <div className="alert alert-warning">This version is approved. Saving creates a new version that needs approval again.</div>}
        {busy && <div className="alert alert-info">A workflow is running. Editing unlocks when it finishes.</div>}
        {editing ? (
          <div className="editor">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`Edit ${section.title}`} autoFocus />
            <div className="editor-foot">
              <span className="muted small">Markdown supported. Keep citations like [E2] to preserve evidence links.</span>
              <div className="row-actions">
                <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                <Button variant="primary" loading={saving} onClick={save} disabled={draft === section.content}>Save section</Button>
              </div>
            </div>
          </div>
        ) : (
          <Markdown source={section.content} onCite={cite} citeTone={citeTone} />
        )}
      </article>

      <aside className="studio-panel">
        <Tabs
          value={panel}
          onChange={setPanel}
          tabs={[
            { id: "claims", label: "Claims", count: section.claims.length, alert: section.claims.some((c) => c.verificationStatus !== "supported") },
            { id: "requirements", label: "Reqs", count: section.requirementIds.length },
            { id: "evidence", label: "Evidence", count: sectionEvidence.length }
          ]}
        />
        {panel === "claims" && (
          <ul className="claims">
            {section.claims.length === 0 && <li className="muted small">No factual company claims in this section.</li>}
            {section.claims.map((claim) => (
              <li key={claim.id} className={`claim claim-${claim.verificationStatus}`}>
                <StatusBadge status={claim.verificationStatus} />
                <p>{claim.text}</p>
                {claim.note && <small className="muted">{claim.note}</small>}
                <div className="row-actions">
                  {claim.evidenceIds.map((id) => labelOf.get(id)).filter(Boolean).map((label) => (
                    <button key={label} className="cite cite-ok" onClick={() => cite(label!)}>{label}</button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        {panel === "requirements" && (
          <ul className="panel-reqs">
            {section.requirementIds.length === 0 && <li className="muted small">This section has no assigned requirements.</li>}
            {section.requirementIds.map((id) => requirements.get(id)).filter(Boolean).map((r) => (
              <li key={r!.id}>
                <div className="row-actions"><code className="code">{r!.code}</code><StatusBadge status={r!.status} /></div>
                <p>{r!.description}</p>
                <button className="link small" onClick={() => onSource(r!.source, `${r!.code} source`)}><Icons.eye size={13} /> Source p.{r!.source.page}</button>
              </li>
            ))}
          </ul>
        )}
        {panel === "evidence" && (
          <ul className="evidence-list">
            {(focusLabel && labels.get(focusLabel) && !sectionEvidence.includes(labels.get(focusLabel)!) ? [labels.get(focusLabel)!, ...sectionEvidence] : sectionEvidence).map((e) => {
              const label = labelOf.get(e.id)!;
              return (
                <li key={e.id} className={label === focusLabel ? "focused" : ""} ref={(el) => { if (el && label === focusLabel) el.scrollIntoView({ block: "nearest" }); }}>
                  <div className="row-actions"><span className="cite cite-ok">{label}</span><Badge>{titleCase(e.assetKind)}</Badge></div>
                  <strong>{e.assetTitle} <span className="muted">v{e.assetVersion}</span></strong>
                  <p>{e.excerpt}</p>
                </li>
              );
            })}
            {sectionEvidence.length === 0 && !focusLabel && <li className="muted small">No evidence cited. Add approved knowledge assets to strengthen this section.</li>}
          </ul>
        )}
      </aside>

      <Modal
        open={revising}
        onClose={() => setRevising(false)}
        title="Ask AI to revise"
        description="Only the selected sections are rewritten, then compliance and claims are re-checked. Other sections stay as they are."
        width={600}
        footer={<><Button variant="ghost" onClick={() => setRevising(false)}>Cancel</Button><Button variant="primary" icon="wand" onClick={requestRevision} disabled={!revision.sectionIds.length || revision.feedback.trim().length < 3}>Start revision</Button></>}
      >
        <div className="stack">
          <div className="check-list">
            {sections.map((s) => (
              <label key={s.id} className="toggle">
                <input
                  type="checkbox"
                  checked={revision.sectionIds.includes(s.id)}
                  onChange={(e) => setRevision({ ...revision, sectionIds: e.target.checked ? [...revision.sectionIds, s.id] : revision.sectionIds.filter((id) => id !== s.id) })}
                />
                {s.title}
              </label>
            ))}
          </div>
          <Field label="What should change?" hint="e.g. “Lead with the 311 case study and address the SOC 2 gap with our 2027 audit plan.”">
            {(id) => <textarea id={id} rows={4} value={revision.feedback} onChange={(e) => setRevision({ ...revision, feedback: e.target.value })} />}
          </Field>
        </div>
      </Modal>
    </div>
  );
}
