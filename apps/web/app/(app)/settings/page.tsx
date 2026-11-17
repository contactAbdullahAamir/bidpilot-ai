"use client";

import { ROLE_PERMISSIONS, type OrganizationRole } from "@bidpilot/contracts";
import { FormEvent, useState } from "react";
import { useSession } from "../../../components/session";
import { Badge, Button, Card, ErrorState, Field, Modal, PageSkeleton, useToast } from "../../../components/ui";
import { api, formatDate, titleCase, useApi } from "../../../lib/api";

type Member = { id: string; name: string; email: string; role: OrganizationRole; joinedAt: string };

const ROLE_COPY: Record<OrganizationRole, string> = {
  owner: "Full control, including members and settings",
  admin: "Manage members, knowledge and opportunities",
  proposal_manager: "Run workflows, edit drafts, manage knowledge",
  contributor: "Upload documents and edit proposal sections",
  reviewer: "Review, approve or reject proposals"
};

const PERMISSION_COPY: Record<keyof typeof ROLE_PERMISSIONS, string> = {
  manageKnowledge: "Add & edit knowledge",
  approveKnowledge: "Approve knowledge",
  manageOpportunities: "Create opportunities",
  editProposal: "Run AI & edit drafts",
  review: "Approve proposals",
  overrideQualification: "Override bid decision",
  manageMembers: "Manage members"
};

export default function SettingsPage() {
  const { session, organizationName, can } = useSession();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Member[]>("/organization/members");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "reviewer" as OrganizationRole });

  async function add(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/organization/members", { method: "POST", json: form });
      toast.success(`${form.name} added. Share their temporary password securely.`);
      setAdding(false);
      setForm({ name: "", email: "", password: "", role: "reviewer" });
      reload();
    } catch (e) {
      toast.error(e);
    }
  }

  if (loading && !data) return <PageSkeleton />;
  if (error && !data) return <div className="page"><ErrorState message={error.message} onRetry={reload} /></div>;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>{organizationName}</h1>
          <p className="muted">AI engine: {session.aiMode === "claude" ? "Claude (Anthropic)" : session.aiMode === "heuristic" ? "Offline engine. Set ANTHROPIC_API_KEY on the orchestrator to enable Claude." : "unreachable"}</p>
        </div>
        {can("manageMembers") && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add member</Button>}
      </header>

      <Card title={`Members (${data!.length})`} padded={false}>
        <ul className="members">
          {data!.map((m) => (
            <li key={m.id}>
              <span className="avatar">{m.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}</span>
              <div className="grow"><strong>{m.name}{m.id === session.user.id && <span className="muted"> (you)</span>}</strong><small className="muted">{m.email} · joined {formatDate(m.joinedAt)}</small></div>
              <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{titleCase(m.role)}</Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="What each role can do" padded={false}>
        <div className="table-wrap">
          <table className="table matrix">
            <thead><tr><th>Permission</th>{(Object.keys(ROLE_COPY) as OrganizationRole[]).map((r) => <th key={r}>{titleCase(r)}</th>)}</tr></thead>
            <tbody>
              {(Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]).map((p) => (
                <tr key={p}>
                  <td>{PERMISSION_COPY[p]}</td>
                  {(Object.keys(ROLE_COPY) as OrganizationRole[]).map((r) => <td key={r} className="center">{(ROLE_PERMISSIONS[p] as readonly string[]).includes(r) ? "✓" : <span className="muted">·</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a team member" description="They can sign in right away with the temporary password you set."
        footer={<><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" type="submit" form="member-form">Add member</Button></>}>
        <form id="member-form" className="stack" onSubmit={add}>
          <div className="grid-2">
            <Field label="Name">{(id) => <input id={id} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
            <Field label="Email">{(id) => <input id={id} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
          </div>
          <Field label="Temporary password" hint="At least 8 characters. Ignored if they already have an account.">{(id) => <input id={id} type="text" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}</Field>
          <div className="kind-grid">
            {(Object.keys(ROLE_COPY) as OrganizationRole[]).filter((r) => r !== "owner").map((r) => (
              <button type="button" key={r} className={`kind ${form.role === r ? "kind-active" : ""}`} onClick={() => setForm({ ...form, role: r })}>
                <strong>{titleCase(r)}</strong><small>{ROLE_COPY[r]}</small>
              </button>
            ))}
          </div>
        </form>
      </Modal>
    </div>
  );
}
