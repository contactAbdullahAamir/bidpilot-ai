"use client";

import type { Opportunity } from "@bidpilot/contracts";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { api } from "../lib/api";
import { Icons } from "./icons";
import { Button, Field, Modal, useToast } from "./ui";

/** Create an opportunity, optionally attach the RFP and start analysis in one step. */
export function NewOpportunityModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({ clientName: "", title: "", deadline: "", context: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      setBusy("Creating opportunity…");
      const opportunity = await api<Opportunity>("/opportunities", {
        method: "POST",
        json: {
          clientName: form.clientName,
          title: form.title,
          deadline: form.deadline ? new Date(`${form.deadline}T17:00:00`).toISOString() : null,
          context: form.context || undefined
        }
      });
      if (file) {
        setBusy("Uploading and reading the RFP…");
        const body = new FormData();
        body.append("file", file);
        body.append("kind", "rfp");
        try {
          const doc = await api<{ status: string; error: string | null }>(`/opportunities/${opportunity.id}/documents`, { method: "POST", body });
          if (doc.status === "parsed") {
            setBusy("Starting analysis…");
            await api(`/opportunities/${opportunity.id}/analyze`, { method: "POST" });
            toast.success("Analysis started. You can follow it live.");
          } else {
            toast.error(doc.error ?? "We couldn't read that file.");
          }
        } catch (e) {
          toast.error(e);
        }
      } else {
        toast.success("Opportunity created");
      }
      onClose();
      setForm({ clientName: "", title: "", deadline: "", context: "" });
      setFile(null);
      router.push(`/opportunities/${opportunity.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="New opportunity"
      description="Add the RFP now and we'll start the analysis right away."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={Boolean(busy)}>Cancel</Button>
          <Button variant="primary" type="submit" form="new-opp" loading={Boolean(busy)} icon={file ? "sparkles" : undefined}>
            {busy ?? (file ? "Create & analyze" : "Create opportunity")}
          </Button>
        </>
      }
    >
      <form id="new-opp" onSubmit={submit} className="stack">
        {error && <div className="alert alert-danger">{error}</div>}
        <div className="grid-2">
          <Field label="Client">{(id) => <input id={id} required value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} placeholder="CivicWorks Department" autoFocus />}</Field>
          <Field label="Submission deadline" hint="Optional">{(id) => <input id={id} type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />}</Field>
        </div>
        <Field label="Opportunity title">{(id) => <input id={id} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="City Services Portal Modernization" />}</Field>
        <Field label="Notes for the writers" hint="Win themes, relationships, or anything the AI should know. Optional.">
          {(id) => <textarea id={id} rows={3} value={form.context} onChange={(e) => setForm({ ...form, context: e.target.value })} />}
        </Field>
        <label className={`dropzone ${file ? "dropzone-filled" : ""}`}>
          <input type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => setFile(e.target.files?.[0] ?? null)} hidden />
          {file ? <Icons.file size={20} /> : <Icons.upload size={20} />}
          <div>
            <strong>{file ? file.name : "Attach the RFP"}</strong>
            <span>{file ? "We'll parse it and start the analysis automatically." : "PDF, DOCX or TXT up to 25 MB. You can also add it later."}</span>
          </div>
          {file && <button type="button" className="icon-btn" onClick={(e) => { e.preventDefault(); setFile(null); }} aria-label="Remove file"><Icons.x size={16} /></button>}
        </label>
      </form>
    </Modal>
  );
}
