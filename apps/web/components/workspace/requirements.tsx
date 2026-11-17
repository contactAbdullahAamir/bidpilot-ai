"use client";

import type { OpportunityDetail, Requirement, SourceRef } from "@bidpilot/contracts";
import { useMemo, useState } from "react";
import { api, titleCase } from "../../lib/api";
import { Icons } from "../icons";
import { useSession } from "../session";
import { Badge, Card, EmptyState, StatusBadge, useToast } from "../ui";

const CATEGORIES = ["all", "eligibility", "functional", "technical", "security", "commercial", "submission"] as const;

export function RequirementsTab({ detail, reload, onSource }: { detail: OpportunityDetail; reload: () => void; onSource: (source: SourceRef, title: string) => void }) {
  const { can } = useSession();
  const toast = useToast();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("all");
  const [onlyMandatory, setOnlyMandatory] = useState(false);
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [query, setQuery] = useState("");
  const requirements = detail.analysis?.requirements ?? [];

  const filtered = useMemo(
    () =>
      requirements.filter((r) => {
        if (category !== "all" && r.category !== category) return false;
        if (onlyMandatory && !r.mandatory) return false;
        if (onlyGaps && !["unaddressed", "partially_addressed", "needs_clarification"].includes(r.status)) return false;
        const q = query.trim().toLowerCase();
        return !q || `${r.code} ${r.description}`.toLowerCase().includes(q);
      }),
    [requirements, category, onlyMandatory, onlyGaps, query]
  );

  async function toggleNa(requirement: Requirement) {
    const status = requirement.status === "not_applicable" ? "unaddressed" : "not_applicable";
    try {
      await api(`/opportunities/${detail.id}/requirements/${requirement.id}`, { method: "PATCH", json: { status } });
      toast.info(status === "not_applicable" ? `${requirement.code} marked not applicable` : `${requirement.code} restored`);
      reload();
    } catch (e) {
      toast.error(e);
    }
  }

  if (!detail.analysis) {
    return <Card><EmptyState icon="search" title="No requirements yet">Run the analysis to extract every requirement with its source page.</EmptyState></Card>;
  }

  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, c === "all" ? requirements.length : requirements.filter((r) => r.category === c).length]));

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="search">
          <Icons.search size={16} />
          <input placeholder="Search requirements" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search requirements" />
        </div>
        <label className="toggle"><input type="checkbox" checked={onlyMandatory} onChange={(e) => setOnlyMandatory(e.target.checked)} /> Mandatory only</label>
        <label className="toggle"><input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} /> Gaps only</label>
      </div>
      <div className="chips">
        {CATEGORIES.filter((c) => counts[c] > 0).map((c) => (
          <button key={c} className={`chip ${category === c ? "chip-active" : ""}`} onClick={() => setCategory(c)}>
            {c === "all" ? "All" : titleCase(c)} <span>{counts[c]}</span>
          </button>
        ))}
      </div>
      <Card padded={false}>
        {filtered.length === 0 ? <EmptyState icon="search" title="No requirements match these filters" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th style={{ width: 90 }}>Code</th><th>Requirement</th><th style={{ width: 120 }}>Category</th><th style={{ width: 120 }}>Coverage</th><th style={{ width: 150 }} /></tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className={r.status === "not_applicable" ? "row-muted" : ""}>
                    <td><code className="code">{r.code}</code></td>
                    <td>
                      <div className="req-text">
                        {r.description}
                        {r.mandatory && <Badge tone="danger">Mandatory</Badge>}
                      </div>
                    </td>
                    <td><span className="muted small">{titleCase(r.category)}</span></td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="cell-actions">
                      <button className="link small" onClick={() => onSource(r.source, `${r.code} source`)}><Icons.eye size={14} /> p.{r.source.page}</button>
                      {can("editProposal") && <button className="link small" onClick={() => toggleNa(r)}>{r.status === "not_applicable" ? "Restore" : "N/A"}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
