"use client";

import type { OpportunityDetail, Proposal, SourceRef } from "@bidpilot/contracts";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icons } from "../../../../components/icons";
import { useSession } from "../../../../components/session";
import { Button, ErrorState, Field, Modal, PageSkeleton, StatusBadge, Tabs, useToast } from "../../../../components/ui";
import { ComplianceTab } from "../../../../components/workspace/compliance";
import { OverviewTab } from "../../../../components/workspace/overview";
import { ProposalStudio } from "../../../../components/workspace/proposal-studio";
import { QualificationTab } from "../../../../components/workspace/qualification";
import { RequirementsTab } from "../../../../components/workspace/requirements";
import { ReviewTab } from "../../../../components/workspace/review";
import { SourceDrawer } from "../../../../components/workspace/source-drawer";
import { api, daysUntil, formatDate, pct, useApi } from "../../../../lib/api";

type TabId = "overview" | "requirements" | "qualification" | "proposal" | "compliance" | "review";
const ACTIVE = new Set(["queued", "running"]);

export default function OpportunityPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { can } = useSession();
  const detail = useApi<OpportunityDetail>(`/opportunities/${id}`, { pollMs: (d) => (d?.latestWorkflow && ACTIVE.has(d.latestWorkflow.status) ? 1500 : false) });
  const proposalQuery = useApi<Proposal | { empty: true }>(`/opportunities/${id}/proposal`);
  const [tab, setTab] = useState<TabId>("overview");
  const [source, setSource] = useState<{ ref: SourceRef; title: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const lastStatus = useRef<string | undefined>();

  const d = detail.data;
  const workflowStatus = d?.latestWorkflow?.status;
  const busy = Boolean(workflowStatus && ACTIVE.has(workflowStatus));
  const proposal = proposalQuery.data && !("empty" in proposalQuery.data) ? proposalQuery.data : null;

  // Refresh the proposal whenever a workflow step lands, and celebrate completion.
  const completedSteps = d?.latestWorkflow?.steps.filter((s) => s.status === "completed").length ?? 0;
  useEffect(() => {
    void proposalQuery.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedSteps, d?.proposalStatus, d?.updatedAt]);
  useEffect(() => {
    if (lastStatus.current && ACTIVE.has(lastStatus.current) && workflowStatus === "waiting_review") {
      toast.success("Draft ready. Review the proposal and compliance results.");
      setTab("proposal");
    }
    if (lastStatus.current && ACTIVE.has(lastStatus.current) && workflowStatus === "failed") toast.error("The workflow failed. See the log for details.");
    lastStatus.current = workflowStatus;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowStatus]);

  if (detail.loading && !d) return <PageSkeleton />;
  if (detail.error && !d) return <div className="page"><ErrorState message={detail.error.message} onRetry={detail.reload} /></div>;
  const o = d!;

  const reload = () => {
    void detail.reload();
    void proposalQuery.reload();
  };
  const onSource = (ref: SourceRef, title: string) => setSource({ ref, title });

  const requirements = o.analysis?.requirements ?? [];
  const gaps = requirements.filter((r) => ["unaddressed", "needs_clarification"].includes(r.status)).length;
  const claimIssues = proposal?.compliance?.unsupportedClaims ?? 0;
  const days = daysUntil(o.deadline);
  const stage = stageOf(o, proposal);

  const next = nextAction(o, proposal, busy);

  async function remove() {
    if (!window.confirm(`Delete "${o.title}" and all its documents, drafts and reviews? This can't be undone.`)) return;
    try {
      await api(`/opportunities/${o.id}`, { method: "DELETE" });
      toast.success("Opportunity deleted");
      router.push("/opportunities");
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <div className="page page-wide">
      <Link href="/opportunities" className="back"><Icons.arrowLeft size={14} /> Opportunities</Link>
      <header className="opp-header">
        <div className="grow">
          <div className="row-actions">
            <StatusBadge status={o.status} />
            {o.qualification && <StatusBadge status={o.qualification.override?.recommendation ?? o.qualification.recommendation} />}
          </div>
          <h1>{o.title}</h1>
          <p className="muted">
            {o.clientName}
            {o.deadline && <> · Due {formatDate(o.deadline)} {days !== null && <span className={`due ${days <= 7 ? "due-soon" : ""}`}>{days < 0 ? "past due" : `in ${days} days`}</span>}</>}
            {o.coverage !== null && <> · {pct(o.coverage)} coverage</>}
          </p>
        </div>
        <div className="page-actions">
          {can("manageOpportunities") && (
            <>
              <button className="icon-btn" onClick={() => setEditing(true)} aria-label="Edit details" title="Edit details"><Icons.edit size={16} /></button>
              <button className="icon-btn" onClick={remove} aria-label="Delete opportunity" title="Delete"><Icons.trash size={16} /></button>
            </>
          )}
          {next && <Button variant="primary" icon={next.icon} onClick={() => setTab(next.tab)}>{next.label}</Button>}
        </div>
      </header>

      <ol className="stepper">
        {["Documents", "Analysis", "Qualification", "Draft", "Review", "Approved"].map((label, index) => (
          <li key={label} className={index < stage ? "done" : index === stage ? (busy ? "current busy" : "current") : ""}>
            <span>{index < stage ? <Icons.check size={12} /> : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "requirements", label: "Requirements", count: requirements.length || undefined, alert: gaps > 0 },
          { id: "qualification", label: "Qualification", count: o.qualification ? o.qualification.findings.filter((f) => f.status !== "met").length || undefined : undefined, alert: Boolean(o.qualification && o.qualification.recommendation !== "go" && !o.qualification.override) },
          { id: "proposal", label: "Proposal studio", count: proposal?.sections.length || undefined },
          { id: "compliance", label: "Compliance", count: proposal?.compliance ? pct(proposal.compliance.coverage) : undefined, alert: claimIssues > 0 || (proposal?.compliance?.mandatoryGaps ?? 0) > 0 },
          { id: "review", label: "Review & export" }
        ]}
      />

      <div className="tab-body">
        {tab === "overview" && <OverviewTab detail={o} reload={reload} onSource={onSource} />}
        {tab === "requirements" && <RequirementsTab detail={o} reload={reload} onSource={onSource} />}
        {tab === "qualification" && <QualificationTab detail={o} proposal={proposal} reload={reload} onSource={onSource} />}
        {tab === "proposal" && <ProposalStudio detail={o} proposal={proposal} reload={reload} onSource={onSource} busy={busy} />}
        {tab === "compliance" && <ComplianceTab detail={o} proposal={proposal} onSource={onSource} />}
        {tab === "review" && <ReviewTab detail={o} proposal={proposal} reload={reload} busy={busy} />}
      </div>

      <SourceDrawer source={source?.ref ?? null} title={source?.title ?? ""} onClose={() => setSource(null)} />
      <EditDetails open={editing} onClose={() => setEditing(false)} opportunity={o} onSaved={reload} />
    </div>
  );
}

function stageOf(o: OpportunityDetail, proposal: Proposal | null): number {
  if (proposal?.status === "approved") return 6;
  if (proposal?.status === "in_review") return 4;
  if (proposal?.sections.length) return 4;
  if (o.qualification) return 3;
  if (o.analysis) return 2;
  if (o.documents.some((d) => d.status === "parsed")) return 1;
  return 0;
}

function nextAction(o: OpportunityDetail, proposal: Proposal | null, busy: boolean): { label: string; tab: TabId; icon: keyof typeof Icons } | null {
  if (busy) return { label: "Watch progress", tab: "overview", icon: "sparkles" };
  if (!o.documents.some((d) => d.status === "parsed")) return { label: "Add the RFP", tab: "overview", icon: "upload" };
  if (!o.analysis || o.latestWorkflow?.status === "failed") return { label: "Analyze RFP", tab: "overview", icon: "sparkles" };
  if (proposal?.status === "approved") return { label: "Download PDF", tab: "review", icon: "download" };
  if (proposal?.status === "in_review") return { label: "Review proposal", tab: "review", icon: "eye" };
  if (proposal) return { label: "Open proposal studio", tab: "proposal", icon: "edit" };
  return null;
}

function EditDetails({ open, onClose, opportunity, onSaved }: { open: boolean; onClose: () => void; opportunity: OpportunityDetail; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ clientName: "", title: "", deadline: "", context: "" });
  useEffect(() => {
    if (open) setForm({ clientName: opportunity.clientName, title: opportunity.title, deadline: opportunity.deadline?.slice(0, 10) ?? "", context: opportunity.context });
  }, [open, opportunity]);

  async function save() {
    try {
      await api(`/opportunities/${opportunity.id}`, {
        method: "PATCH",
        json: { ...form, deadline: form.deadline ? new Date(`${form.deadline}T17:00:00`).toISOString() : null }
      });
      toast.success("Details updated");
      onClose();
      onSaved();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit details" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="stack">
        <div className="grid-2">
          <Field label="Client">{(id) => <input id={id} value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />}</Field>
          <Field label="Deadline">{(id) => <input id={id} type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />}</Field>
        </div>
        <Field label="Title">{(id) => <input id={id} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
        <Field label="Notes for the writers">{(id) => <textarea id={id} rows={4} value={form.context} onChange={(e) => setForm({ ...form, context: e.target.value })} />}</Field>
      </div>
    </Modal>
  );
}
