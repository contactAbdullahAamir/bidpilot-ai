"use client";

import type { DocumentRecord, OpportunityDetail, SourceRef } from "@bidpilot/contracts";
import { useState, type DragEvent } from "react";
import { api, bytes, formatDate, relativeTime } from "../../lib/api";
import { Icons } from "../icons";
import { useSession } from "../session";
import { Badge, Button, Card, EmptyState, Field, Modal, StatusBadge, useToast } from "../ui";
import { WorkflowMonitor } from "./workflow-monitor";

export function OverviewTab({ detail, reload, onSource }: { detail: OpportunityDetail; reload: () => void; onSource: (source: SourceRef, title: string) => void }) {
  const { can } = useSession();
  const toast = useToast();
  const [starting, setStarting] = useState(false);
  const workflow = detail.latestWorkflow;
  const active = workflow && (workflow.status === "queued" || workflow.status === "running");
  const parsedDocs = detail.documents.filter((d) => d.status === "parsed");

  async function analyze() {
    setStarting(true);
    try {
      await api(`/opportunities/${detail.id}/analyze`, { method: "POST" });
      toast.success(detail.analysis ? "Re-analysis started" : "Analysis started");
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="grid-main">
      <div className="stack">
        {workflow && <WorkflowMonitor workflow={workflow} onChange={reload} canRun={can("editProposal")} />}

        {!active && parsedDocs.length > 0 && can("editProposal") && (
          <div className="cta-card">
            <div>
              <strong>{detail.analysis ? "Documents changed or need a fresh draft?" : "Ready when you are"}</strong>
              <p className="muted">
                {detail.analysis
                  ? "Re-running replaces the analysis, qualification and draft. Human edits to sections are overwritten."
                  : `BidPilot will read ${parsedDocs.reduce((n, d) => n + d.pageCount, 0)} pages, extract requirements, check eligibility and draft every section with citations.`}
              </p>
            </div>
            <Button variant={detail.analysis ? "secondary" : "primary"} icon="sparkles" loading={starting} onClick={analyze}>
              {detail.analysis ? "Re-run analysis" : "Analyze RFP"}
            </Button>
          </div>
        )}

        {detail.analysis && <AnalysisSummary detail={detail} reload={reload} onSource={onSource} />}
      </div>
      <div className="stack">
        <Documents detail={detail} reload={reload} />
        {detail.context && (
          <Card title="Team notes">
            <p className="muted prewrap">{detail.context}</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function AnalysisSummary({ detail, reload, onSource }: { detail: OpportunityDetail; reload: () => void; onSource: (source: SourceRef, title: string) => void }) {
  const analysis = detail.analysis!;
  const { can } = useSession();
  const toast = useToast();
  const [confirming, setConfirming] = useState<{ id: string; date: string } | null>(null);

  async function confirmDeadline() {
    if (!confirming?.date) return;
    try {
      await api(`/opportunities/${detail.id}/deadlines/${confirming.id}/confirm`, { method: "POST", json: { date: confirming.date } });
      toast.success("Deadline confirmed");
      setConfirming(null);
      reload();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <>
      <Card title="RFP at a glance">
        <p className="lead">{analysis.summary}</p>
        <div className="mini-stats">
          <div><strong>{analysis.requirements.length}</strong><span>requirements</span></div>
          <div><strong>{analysis.requirements.filter((r) => r.mandatory).length}</strong><span>mandatory</span></div>
          <div><strong>{analysis.evaluationCriteria.length}</strong><span>evaluation criteria</span></div>
          <div><strong>{analysis.ambiguities.length}</strong><span>to clarify</span></div>
        </div>
      </Card>

      <Card title="Key dates" padded={false}>
        {analysis.deadlines.length === 0 ? <p className="muted pad">No dates were found in the RFP.</p> : (
          <ul className="dates">
            {analysis.deadlines.map((d) => (
              <li key={d.id}>
                <Icons.calendar size={16} />
                <div className="grow">
                  <strong>{d.label}</strong>
                  <button className="link small" onClick={() => onSource(d.source, d.label)}>“{d.rawText.slice(0, 110)}{d.rawText.length > 110 ? "…" : ""}”</button>
                </div>
                <span className="date">{d.date ? formatDate(d.date) : "Unclear"}</span>
                {d.confirmed ? <Badge tone="success">Confirmed</Badge> : d.ambiguous ? (
                  can("manageOpportunities") ? <Button size="sm" icon="alert" onClick={() => setConfirming({ id: d.id, date: d.date ?? "" })}>Confirm</Button> : <Badge tone="warning">Ambiguous</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid-2">
        <Card title="Evaluation criteria" padded={false}>
          {analysis.evaluationCriteria.length === 0 ? <p className="muted pad">None found.</p> : (
            <ul className="criteria">
              {analysis.evaluationCriteria.map((c) => (
                <li key={c.id}>
                  <span>{c.name}</span>
                  {c.weight && <strong>{c.weight}</strong>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Needs clarification" padded={false}>
          {analysis.ambiguities.length === 0 ? <p className="muted pad">Nothing ambiguous detected.</p> : (
            <ul className="ambiguities">
              {analysis.ambiguities.map((a) => (
                <li key={a.id}>
                  <Icons.alert size={14} />
                  {a.source ? <button className="link-plain" onClick={() => onSource(a.source!, "Ambiguous statement")}>{a.text}</button> : <span>{a.text}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Modal
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        title="Confirm deadline"
        description="The RFP wording is ambiguous. Confirm the date the team will work to (for example, after checking with the buyer)."
        footer={<><Button variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button><Button variant="primary" onClick={confirmDeadline} disabled={!confirming?.date}>Confirm date</Button></>}
      >
        <Field label="Confirmed date">{(id) => <input id={id} type="date" value={confirming?.date ?? ""} onChange={(e) => setConfirming(confirming && { ...confirming, date: e.target.value })} />}</Field>
      </Modal>
    </>
  );
}

function Documents({ detail, reload }: { detail: OpportunityDetail; reload: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState({ title: "", text: "" });
  const editable = can("editProposal");

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setUploading(true);
    for (const file of list) {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", detail.documents.length === 0 && list.indexOf(file) === 0 ? "rfp" : "appendix");
      try {
        const doc = await api<DocumentRecord>(`/opportunities/${detail.id}/documents`, { method: "POST", body });
        if (doc.status === "parsed") toast.success(`${doc.filename}: ${doc.pageCount} pages ready${doc.emptyPages.length ? `, ${doc.emptyPages.length} without text` : ""}`);
        else toast.error(`${doc.filename}: ${doc.error}`);
      } catch (e) {
        toast.error(e);
      }
    }
    setUploading(false);
    reload();
  }

  async function submitPaste() {
    try {
      await api(`/opportunities/${detail.id}/documents/text`, { method: "POST", json: { title: paste.title || "Pasted RFP", text: paste.text, kind: detail.documents.length ? "appendix" : "rfp" } });
      toast.success("Text added");
      setPasting(false);
      setPaste({ title: "", text: "" });
      reload();
    } catch (e) {
      toast.error(e);
    }
  }

  async function remove(doc: DocumentRecord) {
    if (!window.confirm(`Remove ${doc.filename}? This can't be undone.`)) return;
    try {
      await api(`/documents/${doc.id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      toast.error(e);
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (editable) void upload(event.dataTransfer.files);
  };

  return (
    <Card title="RFP documents" actions={editable && <Button size="sm" variant="ghost" icon="edit" onClick={() => setPasting(true)}>Paste text</Button>} padded={false}>
      {detail.documents.length > 0 && (
        <ul className="docs">
          {detail.documents.map((doc) => (
            <li key={doc.id}>
              <span className={`doc-icon ${doc.status === "failed" ? "doc-failed" : ""}`}><Icons.file size={16} /></span>
              <div className="grow">
                <strong title={doc.filename}>{doc.filename}</strong>
                <small>
                  {doc.kind === "rfp" ? "RFP" : "Appendix"} · {doc.pageCount} pages · {bytes(doc.sizeBytes)} · {relativeTime(doc.createdAt)}
                </small>
                {doc.error && <small className="text-danger">{doc.error}</small>}
                {doc.emptyPages.length > 0 && doc.status === "parsed" && <small className="text-warning">Pages {doc.emptyPages.slice(0, 6).join(", ")} have no text layer (scanned?)</small>}
              </div>
              <StatusBadge status={doc.status} />
              {editable && <button className="icon-btn" onClick={() => remove(doc)} aria-label={`Remove ${doc.filename}`}><Icons.trash size={15} /></button>}
            </li>
          ))}
        </ul>
      )}
      {editable ? (
        <label
          className={`dropzone dropzone-inline ${dragging ? "dropzone-active" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input type="file" multiple accept=".pdf,.docx,.txt,.md" hidden onChange={(e) => e.target.files && upload(e.target.files)} />
          {uploading ? <span className="spinner" /> : <Icons.upload size={20} />}
          <div>
            <strong>{uploading ? "Reading documents…" : detail.documents.length ? "Add appendices" : "Drop the RFP here"}</strong>
            <span>PDF, DOCX or TXT · up to 25 MB · we keep page numbers for citations</span>
          </div>
        </label>
      ) : detail.documents.length === 0 ? (
        <EmptyState icon="file" title="No documents yet" />
      ) : null}

      <Modal
        open={pasting}
        onClose={() => setPasting(false)}
        title="Paste RFP text"
        description="Useful for emailed RFPs or portal listings. Use a form feed or blank lines between pages."
        width={680}
        footer={<><Button variant="ghost" onClick={() => setPasting(false)}>Cancel</Button><Button variant="primary" onClick={submitPaste} disabled={paste.text.trim().length < 20}>Add text</Button></>}
      >
        <div className="stack">
          <Field label="Title">{(id) => <input id={id} value={paste.title} onChange={(e) => setPaste({ ...paste, title: e.target.value })} placeholder="RFP CW-2027-014" />}</Field>
          <Field label="Content" hint={`${paste.text.length.toLocaleString()} characters`}>{(id) => <textarea id={id} rows={14} value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} />}</Field>
        </div>
      </Modal>
    </Card>
  );
}
