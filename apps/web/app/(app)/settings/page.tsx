"use client";

import { ROLE_PERMISSIONS, type Invitation, type OrganizationRole } from "@bidpilot/contracts";
import { FormEvent, useState } from "react";
import { useSession } from "../../../components/session";
import { Badge, Button, Card, ErrorState, Field, Modal, PageSkeleton, useToast } from "../../../components/ui";
import { api, formatDate, relativeTime, titleCase, useApi } from "../../../lib/api";

type Member = { id: string; name: string; email: string; role: OrganizationRole; joinedAt: string };

const ROLES: OrganizationRole[] = ["owner", "admin", "proposal_manager", "contributor", "reviewer"];

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

function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export default function SettingsPage() {
  const { session, organizationName, role: myRole, can } = useSession();
  const toast = useToast();
  const manage = can("manageMembers");
  const members = useApi<Member[]>("/organization/members");
  const invitations = useApi<Invitation[]>(manage ? "/organization/invitations" : null);
  const [inviting, setInviting] = useState(false);
  const [invite, setInvite] = useState<{ email: string; role: OrganizationRole }>({ email: "", role: "contributor" });
  const [removing, setRemoving] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);

  const assignable = ROLES.filter((r) => r !== "owner" || myRole === "owner");

  async function sendInvite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/organization/invitations", { method: "POST", json: invite });
      toast.success(`Invitation sent to ${invite.email}.`);
      setInviting(false);
      setInvite({ email: "", role: "contributor" });
      void invitations.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function resend(inv: Invitation) {
    try {
      await api("/organization/invitations", { method: "POST", json: { email: inv.email, role: inv.role } });
      toast.success(`New invitation sent to ${inv.email}. The old link no longer works.`);
      void invitations.reload();
    } catch (e) {
      toast.error(e);
    }
  }

  async function revoke(inv: Invitation) {
    try {
      await api(`/organization/invitations/${inv.id}`, { method: "DELETE" });
      toast.success(`Invitation for ${inv.email} revoked.`);
      void invitations.reload();
    } catch (e) {
      toast.error(e);
    }
  }

  async function changeRole(member: Member, role: OrganizationRole) {
    try {
      await api(`/organization/members/${member.id}`, { method: "PATCH", json: { role } });
      toast.success(`${member.name} is now ${titleCase(role)}.`);
      void members.reload();
    } catch (e) {
      toast.error(e);
      void members.reload();
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api(`/organization/members/${removing.id}`, { method: "DELETE" });
      toast.success(`${removing.name} was removed from ${organizationName}.`);
      setRemoving(null);
      void members.reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  if (members.loading && !members.data) return <PageSkeleton />;
  if (members.error && !members.data) return <div className="page"><ErrorState message={members.error.message} onRetry={members.reload} /></div>;

  const pending = invitations.data ?? [];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>{organizationName}</h1>
          <p className="muted">AI engine: {session.aiMode === "claude"
              ? `Claude (Anthropic${session.aiModel ? `, ${session.aiModel}` : ""})`
              : session.aiMode === "openai"
                ? `OpenAI-compatible API (${session.aiModel ?? "unknown model"})`
                : session.aiMode === "heuristic"
                  ? "Offline engine. Set an AI API key (ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY...) on the orchestrator to use a real model."
                  : "unreachable"}</p>
        </div>
        {manage && <Button variant="primary" icon="plus" onClick={() => setInviting(true)}>Invite member</Button>}
      </header>

      <Card title={`Members (${members.data!.length})`} padded={false}>
        <ul className="members">
          {members.data!.map((m) => {
            const isMe = m.id === session.user.id;
            const editable = manage && !isMe && (m.role !== "owner" || myRole === "owner");
            return (
              <li key={m.id}>
                <span className="avatar">{initials(m.name)}</span>
                <div className="grow">
                  <strong>{m.name}{isMe && <span className="muted"> (you)</span>}</strong>
                  <small className="muted">{m.email} · joined {formatDate(m.joinedAt)}</small>
                </div>
                {editable ? (
                  <div className="member-actions">
                    <select aria-label={`Role for ${m.name}`} value={m.role} onChange={(e) => void changeRole(m, e.target.value as OrganizationRole)}>
                      {assignable.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
                    </select>
                    <Button variant="ghost" size="sm" icon="trash" aria-label={`Remove ${m.name}`} title="Remove from workspace" onClick={() => setRemoving(m)} />
                  </div>
                ) : (
                  <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{titleCase(m.role)}</Badge>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {manage && pending.length > 0 && (
        <Card title={`Pending invitations (${pending.length})`} padded={false}>
          <ul className="members">
            {pending.map((inv) => (
              <li key={inv.id}>
                <span className="avatar">{inv.email[0].toUpperCase()}</span>
                <div className="grow">
                  <strong>{inv.email}</strong>
                  <small className="muted">{titleCase(inv.role)} · invited {relativeTime(inv.createdAt)}{inv.invitedBy ? ` by ${inv.invitedBy}` : ""} · expires {formatDate(inv.expiresAt)}</small>
                </div>
                <div className="member-actions">
                  <Button variant="ghost" size="sm" onClick={() => void resend(inv)}>Resend</Button>
                  <Button variant="ghost" size="sm" onClick={() => void revoke(inv)}>Revoke</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ChangePassword />

      <Card title="What each role can do" padded={false}>
        <div className="table-wrap">
          <table className="table matrix">
            <thead><tr><th>Permission</th>{ROLES.map((r) => <th key={r}>{titleCase(r)}</th>)}</tr></thead>
            <tbody>
              {(Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]).map((p) => (
                <tr key={p}>
                  <td>{PERMISSION_COPY[p]}</td>
                  {ROLES.map((r) => <td key={r} className="center">{(ROLE_PERMISSIONS[p] as readonly string[]).includes(r) ? "✓" : <span className="muted">·</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={inviting} onClose={() => setInviting(false)} title="Invite a team member" description="We'll email them a link to join. It expires in 7 days."
        footer={<><Button variant="ghost" onClick={() => setInviting(false)}>Cancel</Button><Button variant="primary" type="submit" form="invite-form" loading={busy}>Send invitation</Button></>}>
        <form id="invite-form" className="stack" onSubmit={sendInvite}>
          <Field label="Email">{(id) => <input id={id} type="email" required autoFocus value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />}</Field>
          <div className="kind-grid">
            {assignable.map((r) => (
              <button type="button" key={r} className={`kind ${invite.role === r ? "kind-active" : ""}`} onClick={() => setInvite({ ...invite, role: r })}>
                <strong>{titleCase(r)}</strong><small>{ROLE_COPY[r]}</small>
              </button>
            ))}
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(removing)} onClose={() => setRemoving(null)} title={`Remove ${removing?.name ?? "member"}?`}
        description={`They will immediately lose access to ${organizationName}. Their past work and audit history stay in place. You can invite them again later.`}
        footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" loading={busy} onClick={() => void remove()}>Remove member</Button></>}>
        <p className="muted">{removing?.email}</p>
      </Modal>
    </div>
  );
}

function ChangePassword() {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.newPassword !== form.confirm) return setError("The new passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await api("/auth/change-password", { method: "POST", json: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
      toast.success("Password changed. Other devices have been signed out.");
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Your password">
      <form className="stack" onSubmit={submit}>
        {error && <div className="alert alert-danger" role="alert">{error}</div>}
        <div className="grid-2">
          <Field label="Current password">{(id) => <input id={id} type="password" autoComplete="current-password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />}</Field>
          <div />
          <Field label="New password" hint="At least 8 characters.">{(id) => <input id={id} type="password" autoComplete="new-password" required minLength={8} value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />}</Field>
          <Field label="Confirm new password">{(id) => <input id={id} type="password" autoComplete="new-password" required minLength={8} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />}</Field>
        </div>
        <div><Button type="submit" loading={busy}>Change password</Button></div>
      </form>
    </Card>
  );
}
