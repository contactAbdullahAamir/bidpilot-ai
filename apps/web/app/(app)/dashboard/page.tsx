"use client";

import type { Dashboard } from "@bidpilot/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icons } from "../../../components/icons";
import { NewOpportunityModal } from "../../../components/new-opportunity";
import { OpportunityRow } from "../../../components/opportunity-row";
import { useSession } from "../../../components/session";
import { Badge, Button, Card, EmptyState, ErrorState, PageSkeleton, useToast } from "../../../components/ui";
import { api, daysUntil, formatDate, relativeTime, useApi } from "../../../lib/api";

const ACTION_LABELS: Record<string, string> = {
  "organization.created": "created the workspace",
  "opportunity.created": "created opportunity",
  "opportunity.deleted": "deleted opportunity",
  "document.uploaded": "uploaded",
  "document.deleted": "removed",
  "knowledge.created": "added knowledge",
  "knowledge.approved": "approved",
  "knowledge.archived": "archived",
  "knowledge.revised": "revised",
  "knowledge.updated": "updated",
  "knowledge.draft": "restored",
  "knowledge.deleted": "deleted knowledge",
  "workflow.rfp_analysis.started": "started analysis of",
  "workflow.revision.started": "requested a revision of",
  "proposal.submitted": "submitted for review",
  "proposal.approve": "approved the proposal",
  "proposal.request_changes": "requested changes",
  "proposal.reject": "rejected the proposal",
  "proposal.exported": "exported the PDF for",
  "section.edited": "edited",
  "qualification.overridden": "overrode qualification for",
  "deadline.confirmed": "confirmed a deadline for",
  "member.added": "added a team member:",
  "demo.seeded": "loaded the sample workspace:"
};

export default function DashboardPage() {
  const { session, can } = useSession();
  const router = useRouter();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Dashboard>("/dashboard", { pollMs: (d) => (d && d.counts.inFlight > 0 ? 4000 : false) });
  const [creating, setCreating] = useState(false);
  const [seeding, setSeeding] = useState(false);

  async function seed() {
    setSeeding(true);
    try {
      const result = await api<{ opportunityId: string }>("/demo/seed", { method: "POST" });
      toast.success("Sample workspace loaded. Run the analysis to see BidPilot in action.");
      router.push(`/opportunities/${result.opportunityId}`);
    } catch (e) {
      toast.error(e);
      setSeeding(false);
    }
  }

  if (loading && !data) return <PageSkeleton />;
  if (error && !data) return <div className="page"><ErrorState message={error.message} onRetry={reload} /></div>;
  const d = data!;
  const firstName = session.user.name.split(" ")[0];
  const steps = [
    { done: d.counts.approvedKnowledge > 0, label: "Add and approve company knowledge", hint: "Case studies, certifications, policies", href: "/knowledge" },
    { done: d.counts.opportunities > 0, label: "Create an opportunity with its RFP", hint: "PDF, DOCX or pasted text", action: () => setCreating(true) },
    { done: d.recent.some((o) => o.requirementCount > 0), label: "Run the AI analysis", hint: "Requirements, qualification, draft" },
    { done: d.counts.approved > 0, label: "Review, approve and export", hint: "Locked version with checksum" }
  ];
  const onboarding = steps.filter((s) => s.done).length < steps.length;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{greeting()}, {firstName}</p>
          <h1>Your bid pipeline</h1>
        </div>
        <div className="page-actions">
          {can("manageOpportunities") && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New opportunity</Button>}
        </div>
      </header>

      {onboarding && (
        <section className="onboarding">
          <div className="onboarding-intro">
            <Badge tone="accent">Getting started</Badge>
            <h2>From RFP to approved proposal in four steps</h2>
            <p className="muted">Explore with a realistic synthetic RFP and company profile, or bring your own.</p>
            {can("manageOpportunities") && (
              <Button variant="primary" icon="sparkles" loading={seeding} onClick={seed}>Load sample workspace</Button>
            )}
          </div>
          <ol className="checklist">
            {steps.map((step, i) => {
              const content = (
                <>
                  <span className={`check ${step.done ? "check-done" : ""}`}>{step.done ? <Icons.check size={14} /> : i + 1}</span>
                  <span><strong>{step.label}</strong><small>{step.hint}</small></span>
                </>
              );
              return (
                <li key={step.label} className={step.done ? "done" : ""}>
                  {step.href ? <Link href={step.href}>{content}</Link> : step.action ? <button onClick={step.action}>{content}</button> : <div>{content}</div>}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <div className="stats">
        <Stat label="Active opportunities" value={d.counts.opportunities} icon="briefcase" />
        <Stat label="AI working now" value={d.counts.inFlight} icon="sparkles" live={d.counts.inFlight > 0} />
        <Stat label="Waiting on review" value={d.counts.awaitingReview} icon="eye" tone={d.counts.awaitingReview ? "warning" : undefined} />
        <Stat label="Approved knowledge" value={d.counts.approvedKnowledge} icon="library" sub={d.counts.draftKnowledge ? `${d.counts.draftKnowledge} awaiting approval` : undefined} />
      </div>

      <div className="grid-main">
        <Card title="Recent opportunities" actions={<Link className="link" href="/opportunities">View all</Link>} padded={false}>
          {d.recent.length === 0 ? (
            <EmptyState icon="briefcase" title="No opportunities yet" action={can("manageOpportunities") && <Button icon="plus" onClick={() => setCreating(true)}>New opportunity</Button>}>
              Create one from an RFP, or load the sample workspace.
            </EmptyState>
          ) : (
            <div className="list">{d.recent.map((o) => <OpportunityRow key={o.id} opportunity={o} />)}</div>
          )}
        </Card>
        <div className="stack">
          <Card title="Upcoming deadlines" padded={false}>
            {d.upcoming.length === 0 ? (
              <p className="muted pad">No upcoming deadlines.</p>
            ) : (
              <ul className="deadlines">
                {d.upcoming.map((o) => {
                  const days = daysUntil(o.deadline)!;
                  return (
                    <li key={o.id}>
                      <Link href={`/opportunities/${o.id}`}>
                        <span className={`days ${days <= 7 ? "days-soon" : ""}`}><strong>{days}</strong>days</span>
                        <span><strong>{o.title}</strong><small>{o.clientName} · {formatDate(o.deadline)}</small></span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card title="Activity" padded={false}>
            {d.activity.length === 0 ? <p className="muted pad">Nothing yet.</p> : (
              <ul className="activity">
                {d.activity.map((a) => (
                  <li key={a.id}>
                    <span className="activity-dot" />
                    <span>
                      <strong>{a.actorName ?? "System"}</strong> {ACTION_LABELS[a.action] ?? a.action.replace(/[._]/g, " ")} {a.entityLabel && <em>{a.entityLabel}</em>}
                      <small>{relativeTime(a.createdAt)}</small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <NewOpportunityModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Stat({ label, value, icon, sub, tone, live }: { label: string; value: number; icon: keyof typeof Icons; sub?: string; tone?: "warning"; live?: boolean }) {
  const IconCmp = Icons[icon];
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <span className={`stat-icon ${live ? "stat-live" : ""}`}><IconCmp size={18} /></span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
        {sub && <small>{sub}</small>}
      </div>
    </div>
  );
}
