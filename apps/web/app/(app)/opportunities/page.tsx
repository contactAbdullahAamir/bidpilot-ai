"use client";

import type { OpportunitySummary } from "@bidpilot/contracts";
import { useMemo, useState } from "react";
import { Icons } from "../../../components/icons";
import { NewOpportunityModal } from "../../../components/new-opportunity";
import { useSession } from "../../../components/session";
import { Button, Card, EmptyState, ErrorState, PageSkeleton } from "../../../components/ui";
import { useApi } from "../../../lib/api";
import { OpportunityRow } from "../../../components/opportunity-row";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "In progress" },
  { id: "review", label: "Needs review" },
  { id: "approved", label: "Approved" },
  { id: "draft", label: "Draft" }
] as const;

export default function OpportunitiesPage() {
  const { can } = useSession();
  const { data, error, loading, reload } = useApi<OpportunitySummary[]>("/opportunities", {
    pollMs: (d) => (d?.some((o) => ["processing", "qualification", "research", "generation", "validation"].includes(o.status)) ? 4000 : false)
  });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((o) => {
      if (q && !`${o.title} ${o.clientName}`.toLowerCase().includes(q)) return false;
      if (filter === "active") return ["processing", "qualification", "research", "generation", "validation", "failed"].includes(o.status);
      if (filter === "review") return o.status === "human_review";
      if (filter === "approved") return o.status === "completed";
      if (filter === "draft") return o.status === "draft";
      return true;
    });
  }, [data, query, filter]);

  if (loading && !data) return <PageSkeleton />;
  if (error && !data) return <div className="page"><ErrorState message={error.message} onRetry={reload} /></div>;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Pipeline</p>
          <h1>Opportunities</h1>
        </div>
        {can("manageOpportunities") && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New opportunity</Button>}
      </header>
      <div className="toolbar">
        <div className="search">
          <Icons.search size={16} />
          <input placeholder="Search by title or client" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search opportunities" />
        </div>
        <div className="segmented">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? "active" : ""} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
      </div>
      <Card padded={false}>
        {data!.length === 0 ? (
          <EmptyState icon="briefcase" title="Start your first response" action={can("manageOpportunities") && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New opportunity</Button>}>
            Upload an RFP and BidPilot extracts every requirement, checks eligibility and drafts an evidence-backed proposal.
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState icon="search" title="No matches">Try a different search or filter.</EmptyState>
        ) : (
          <div className="list">{filtered.map((o) => <OpportunityRow key={o.id} opportunity={o} />)}</div>
        )}
      </Card>
      <NewOpportunityModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
