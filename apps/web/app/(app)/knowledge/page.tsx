"use client";

import type { Evidence, KnowledgeAsset, KnowledgeKind } from "@bidpilot/contracts";
import { FormEvent, useMemo, useState } from "react";
import { Icons } from "../../../components/icons";
import { useSession } from "../../../components/session";
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, Field, Modal, PageSkeleton, StatusBadge, useToast } from "../../../components/ui";
import { api, relativeTime, titleCase, useApi } from "../../../lib/api";

const KINDS: { id: KnowledgeKind; label: string; hint: string }[] = [
  { id: "case_study", label: "Case study", hint: "Past projects with measurable outcomes" },
  { id: "capability", label: "Capability", hint: "Technology, methods, delivery profile" },
  { id: "certification", label: "Certification", hint: "ISO, SOC 2, licences, accreditations" },
  { id: "policy", label: "Policy", hint: "Security, privacy, quality policies" },
  { id: "team", label: "Team & company", hint: "Staffing, bios, insurance, company facts" },
  { id: "other", label: "Other", hint: "Anything else the writers may cite" }
];

export default function KnowledgePage() {
  const { can } = useSession();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<KnowledgeAsset[]>("/knowledge");
  const [kind, setKind] = useState<KnowledgeKind | "all">("all");
  const [status, setStatus] = useState<"all" | "approved" | "draft" | "archived">("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<KnowledgeAsset | null>(null);
  const [testing, setTesting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((a) => (kind === "all" || a.kind === kind) && (status === "all" || a.status === status) && (!q || `${a.title} ${a.tags.join(" ")} ${a.content}`.toLowerCase().includes(q)));
  }, [data, kind, status, query]);

  if (loading && !data) return <PageSkeleton />;
  if (error && !data) return <div className="page"><ErrorState message={error.message} onRetry={reload} /></div>;
  const drafts = data!.filter((a) => a.status === "draft").length;

  async function setAssetStatus(asset: KnowledgeAsset, action: "approve" | "archive" | "restore") {
    try {
      const updated = await api<KnowledgeAsset>(`/knowledge/${asset.id}/${action}`, { method: "POST" });
      toast.success(action === "approve" ? `"${asset.title}" is now available to the writers` : action === "archive" ? "Archived. Writers won't cite it." : "Restored as draft");
      if (open?.id === asset.id) setOpen(updated);
      reload();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Evidence library</p>
          <h1>Knowledge base</h1>
          <p className="muted">Writers only cite <strong>approved</strong> assets. Every citation links back to the exact version used.</p>
        </div>
        <div className="page-actions">
          <Button icon="search" onClick={() => setTesting(true)}>Test retrieval</Button>
          {can("manageKnowledge") && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Add knowledge</Button>}
        </div>
      </header>

      {drafts > 0 && can("approveKnowledge") && (
        <div className="alert alert-info"><Icons.alert size={16} /> {drafts} asset{drafts === 1 ? " is" : "s are"} waiting for approval. Writers can't use {drafts === 1 ? "it" : "them"} until approved.</div>
      )}

      <div className="toolbar">
        <div className="search"><Icons.search size={16} /><input placeholder="Search titles, tags and content" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search knowledge" /></div>
        <div className="segmented">
          {(["all", "approved", "draft", "archived"] as const).map((s) => <button key={s} className={status === s ? "active" : ""} onClick={() => setStatus(s)}>{titleCase(s)}</button>)}
        </div>
      </div>
      <div className="chips">
        <button className={`chip ${kind === "all" ? "chip-active" : ""}`} onClick={() => setKind("all")}>All <span>{data!.length}</span></button>
        {KINDS.map((k) => {
          const count = data!.filter((a) => a.kind === k.id).length;
          return count ? <button key={k.id} className={`chip ${kind === k.id ? "chip-active" : ""}`} onClick={() => setKind(k.id)}>{k.label} <span>{count}</span></button> : null;
        })}
      </div>

      {data!.length === 0 ? (
        <Card>
          <EmptyState icon="library" title="Teach BidPilot about your company" action={can("manageKnowledge") && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Add your first asset</Button>}>
            Add case studies, certifications and policies. Approved assets become the only source of facts in your proposals.
          </EmptyState>
        </Card>
      ) : filtered.length === 0 ? (
        <Card><EmptyState icon="search" title="Nothing matches" /></Card>
      ) : (
        <div className="cards">
          {filtered.map((asset) => (
            <button key={asset.id} className={`asset ${asset.status === "archived" ? "asset-archived" : ""}`} onClick={() => setOpen(asset)}>
              <div className="row-actions"><Badge tone="accent">{titleCase(asset.kind)}</Badge><StatusBadge status={asset.status === "draft" ? "pending_approval" : asset.status} /></div>
              <strong>{asset.title}</strong>
              <p>{asset.content.slice(0, 180)}{asset.content.length > 180 ? "…" : ""}</p>
              <small className="muted">v{asset.version} · {asset.chunkCount} passages · updated {relativeTime(asset.updatedAt)}</small>
            </button>
          ))}
        </div>
      )}

      <AssetEditor open={creating} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />
      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title={open?.title ?? ""} subtitle={open ? `${titleCase(open.kind)} · version ${open.version}${open.sourceFilename ? ` · from ${open.sourceFilename}` : ""}` : undefined}>
        {open && <AssetDetail asset={open} onStatus={setAssetStatus} onChanged={(a) => { setOpen(a); reload(); }} onDeleted={() => { setOpen(null); reload(); }} />}
      </Drawer>
      <RetrievalTester open={testing} onClose={() => setTesting(false)} />
    </div>
  );
}

function AssetDetail({ asset, onStatus, onChanged, onDeleted }: { asset: KnowledgeAsset; onStatus: (a: KnowledgeAsset, action: "approve" | "archive" | "restore") => void; onChanged: (a: KnowledgeAsset) => void; onDeleted: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: asset.title, content: asset.content, tags: asset.tags.join(", ") });

  async function save() {
    try {
      const updated = await api<KnowledgeAsset>(`/knowledge/${asset.id}`, { method: "PATCH", json: { title: form.title, content: form.content, tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean) } });
      toast.success(updated.version > asset.version ? `Saved as version ${updated.version}. It needs approval again.` : "Saved");
      setEditing(false);
      onChanged(updated);
    } catch (e) {
      toast.error(e);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this asset permanently? Past proposals keep their quoted excerpts, but this can't be undone.")) return;
    try {
      await api(`/knowledge/${asset.id}`, { method: "DELETE" });
      toast.success("Deleted");
      onDeleted();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <div className="stack">
      <div className="row-actions">
        <StatusBadge status={asset.status === "draft" ? "pending_approval" : asset.status} />
        {asset.approvedByName && <span className="muted small">Approved by {asset.approvedByName} {asset.approvedAt && relativeTime(asset.approvedAt)}</span>}
      </div>
      <div className="row-actions">
        {asset.status === "draft" && can("approveKnowledge") && <Button variant="primary" icon="check" onClick={() => onStatus(asset, "approve")}>Approve for use</Button>}
        {asset.status !== "archived" && can("manageKnowledge") && !editing && <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
        {asset.status !== "archived" && can("manageKnowledge") && <Button variant="ghost" onClick={() => onStatus(asset, "archive")}>Archive</Button>}
        {asset.status === "archived" && can("manageKnowledge") && <Button onClick={() => onStatus(asset, "restore")}>Restore</Button>}
        {can("manageKnowledge") && <Button variant="ghost" icon="trash" onClick={remove}>Delete</Button>}
      </div>
      {editing ? (
        <div className="stack">
          <Field label="Title">{(id) => <input id={id} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
          <Field label="Tags" hint="Comma separated">{(id) => <input id={id} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />}</Field>
          <Field label="Content" hint="Changing content creates a new version that must be approved again.">{(id) => <textarea id={id} rows={16} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />}</Field>
          <div className="row-actions"><Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></div>
        </div>
      ) : (
        <>
          {asset.tags.length > 0 && <div className="row-actions">{asset.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
          <div className="page-text">{asset.content}</div>
        </>
      )}
    </div>
  );
}

function AssetEditor({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { can } = useSession();
  const [mode, setMode] = useState<"write" | "upload">("write");
  const [form, setForm] = useState({ title: "", kind: "case_study" as KnowledgeKind, content: "", tags: "" });
  const [file, setFile] = useState<File | null>(null);
  const [approve, setApprove] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      let asset: KnowledgeAsset;
      if (mode === "upload") {
        if (!file) throw new Error("Choose a file to upload.");
        const body = new FormData();
        body.append("file", file);
        body.append("kind", form.kind);
        if (form.title) body.append("title", form.title);
        asset = await api<KnowledgeAsset>("/knowledge/upload", { method: "POST", body });
      } else {
        asset = await api<KnowledgeAsset>("/knowledge", { method: "POST", json: { title: form.title, kind: form.kind, content: form.content, tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean) } });
      }
      if (approve && can("approveKnowledge")) await api(`/knowledge/${asset.id}/approve`, { method: "POST" });
      toast.success(approve && can("approveKnowledge") ? "Added and approved" : "Added as draft. An admin needs to approve it.");
      setForm({ title: "", kind: "case_study", content: "", tags: "" });
      setFile(null);
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add knowledge" description="Facts here become citable evidence in proposals." width={680}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="asset-form" loading={busy}>Add asset</Button></>}>
      <form id="asset-form" className="stack" onSubmit={submit}>
        <div className="segmented segmented-block">
          <button type="button" className={mode === "write" ? "active" : ""} onClick={() => setMode("write")}>Write or paste</button>
          <button type="button" className={mode === "upload" ? "active" : ""} onClick={() => setMode("upload")}>Upload file</button>
        </div>
        <div className="kind-grid">
          {KINDS.map((k) => (
            <button type="button" key={k.id} className={`kind ${form.kind === k.id ? "kind-active" : ""}`} onClick={() => setForm({ ...form, kind: k.id })}>
              <strong>{k.label}</strong><small>{k.hint}</small>
            </button>
          ))}
        </div>
        <Field label="Title" hint={mode === "upload" ? "Optional. Defaults to the file name." : undefined}>{(id) => <input id={id} required={mode === "write"} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Case study: County 311 modernization" />}</Field>
        {mode === "write" ? (
          <>
            <Field label="Content" hint="Use short headings and paragraphs. Specific, measurable facts make the strongest evidence.">{(id) => <textarea id={id} required rows={10} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />}</Field>
            <Field label="Tags" hint="Optional, comma separated">{(id) => <input id={id} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />}</Field>
          </>
        ) : (
          <label className={`dropzone ${file ? "dropzone-filled" : ""}`}>
            <input type="file" accept=".pdf,.docx,.txt,.md" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file ? <Icons.file size={20} /> : <Icons.upload size={20} />}
            <div><strong>{file ? file.name : "Choose a file"}</strong><span>PDF, DOCX, TXT or Markdown</span></div>
          </label>
        )}
        {can("approveKnowledge") && <label className="toggle"><input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} /> Approve immediately. I've checked these facts are accurate.</label>}
      </form>
    </Modal>
  );
}

function RetrievalTester({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Evidence[] | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function run(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      setResults(await api<Evidence[]>(`/knowledge/search?q=${encodeURIComponent(query)}`));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Test retrieval" description="See exactly which approved passages the writers would receive for a requirement." width={680}>
      <form className="search-row" onSubmit={run}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. must hold a current SOC 2 Type II report" autoFocus />
        <Button variant="primary" type="submit" loading={busy} disabled={!query.trim()}>Search</Button>
      </form>
      {results && (results.length === 0 ? <p className="muted">No approved evidence matches. That's a gap the writers would have to flag.</p> : (
        <ul className="evidence-list">
          {results.map((r) => (
            <li key={r.id}>
              <div className="row-actions"><Badge tone="accent">{titleCase(r.assetKind)}</Badge><span className="muted small">score {r.score}</span></div>
              <strong>{r.assetTitle} <span className="muted">v{r.assetVersion}</span></strong>
              <p>{r.excerpt}</p>
            </li>
          ))}
        </ul>
      ))}
    </Modal>
  );
}
