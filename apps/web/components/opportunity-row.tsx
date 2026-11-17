"use client";

import type { OpportunitySummary } from "@bidpilot/contracts";
import Link from "next/link";
import { daysUntil, pct } from "../lib/api";
import { Icons } from "./icons";
import { StatusBadge } from "./ui";

export function OpportunityRow({ opportunity: o }: { opportunity: OpportunitySummary }) {
  const days = daysUntil(o.deadline);
  return (
    <Link href={`/opportunities/${o.id}`} className="row">
      <div className="row-main">
        <strong>{o.title}</strong>
        <span>{o.clientName}{o.requirementCount ? ` · ${o.requirementCount} requirements` : o.documentCount ? ` · ${o.documentCount} document${o.documentCount === 1 ? "" : "s"}` : " · No RFP yet"}</span>
      </div>
      <div className="row-meta">
        {o.recommendation && <StatusBadge status={o.recommendation} />}
        {o.coverage !== null && <span className="coverage" title="Requirement coverage">{pct(o.coverage)}</span>}
        <StatusBadge status={o.status} />
        {days !== null && o.status !== "completed" && <span className={`due ${days <= 7 ? "due-soon" : ""}`}>{days < 0 ? "Past due" : `${days}d`}</span>}
        <Icons.arrowRight size={16} className="row-arrow" />
      </div>
    </Link>
  );
}
