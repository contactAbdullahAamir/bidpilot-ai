import {
  routeQualification,
  type Evidence,
  type InternalContext,
  type ProposalPlan,
  type Qualification,
  type Requirement,
  type RequirementCategory,
  type RetrievalOutput,
  type RfpAnalysis,
  type ValidationOutput,
  type WritingOutput,
  type WrittenSection
} from "@bidpilot/contracts";
import { randomUUID } from "node:crypto";
import type { ApiClient } from "./api-client";
import { addUsage, LabeledEvidence, ModelProvider, Usage, ZERO_USAGE } from "./providers/types";
import { mapLimit, normalize } from "./text";

export type StepContext = {
  workflowId: string;
  context: InternalContext;
  provider: ModelProvider;
  api: ApiClient;
  /** Emits a user-facing progress event. */
  log: (message: string, level?: "info" | "success" | "warning" | "error") => Promise<void>;
};

export type StepResult = { output: unknown; usage: Usage; summary: string };

const ELIGIBILITY_HINT = /certif|insurance|experience|licens|accredit|soc 2|iso|clearance|registered/i;

function completed<T>(ctx: StepContext, step: string): T {
  const value = ctx.context.completed[step];
  if (!value) throw new Error(`Missing output from the ${step} step.`);
  return value as T;
}

export function labelEvidence(evidence: Evidence[]): LabeledEvidence[] {
  return evidence.map((e, index) => ({ ...e, label: `E${index + 1}` }));
}

// ---------------------------------------------------------------------------
// 1. RFP analysis
// ---------------------------------------------------------------------------

export async function runAnalysis(ctx: StepContext): Promise<StepResult> {
  const { pages, opportunity } = ctx.context;
  if (pages.length === 0) throw new Error("No readable RFP pages were found.");
  await ctx.log(`Reading ${pages.length} page${pages.length === 1 ? "" : "s"} of RFP content`);
  const { value: raw, usage } = await ctx.provider.analyze({ pages, opportunity });

  const pageAt = (n: number | null) => pages[Math.min(Math.max((n ?? 1) - 1, 0), pages.length - 1)];
  let unverified = 0;
  const locate = (page: number, quote: string) => {
    const needle = normalize(quote).slice(0, 120);
    const candidates = [pageAt(page), ...pages];
    const hit = needle ? candidates.find((p) => normalize(p.text).includes(needle)) : undefined;
    if (!hit) unverified += 1;
    const target = hit ?? pageAt(page);
    return { documentId: target.documentId, page: target.pageNumber, quote };
  };

  const usedCodes = new Set<string>();
  const requirements: Requirement[] = raw.requirements.map((r) => {
    let code = r.code.trim() || "REQ";
    while (usedCodes.has(code)) code = `${code}′`;
    usedCodes.add(code);
    return {
      id: randomUUID(),
      code,
      description: r.description,
      category: r.category,
      mandatory: r.mandatory,
      source: locate(r.page, r.quote),
      status: "unaddressed"
    };
  });

  const analysis: RfpAnalysis = {
    summary: raw.summary,
    requirements,
    deadlines: raw.deadlines.map((d) => ({
      id: randomUUID(),
      label: d.label,
      date: d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : null,
      rawText: d.rawText,
      ambiguous: d.ambiguous || !d.date,
      confirmed: false,
      source: locate(d.page, d.rawText)
    })),
    evaluationCriteria: raw.evaluationCriteria.map((c) => ({
      id: randomUUID(),
      name: c.name,
      weight: c.weight,
      source: { documentId: pageAt(c.page).documentId, page: pageAt(c.page).pageNumber, quote: c.name }
    })),
    ambiguities: raw.ambiguities.map((a) => ({
      id: randomUUID(),
      text: a.text,
      source: a.page ? { documentId: pageAt(a.page).documentId, page: pageAt(a.page).pageNumber, quote: a.text } : null
    }))
  };

  if (unverified) await ctx.log(`${unverified} citation${unverified === 1 ? "" : "s"} couldn't be matched verbatim to the source page. Check them in the requirements view.`, "warning");
  const ambiguousDeadlines = analysis.deadlines.filter((d) => d.ambiguous).length;
  if (ambiguousDeadlines) await ctx.log(`${ambiguousDeadlines} deadline${ambiguousDeadlines === 1 ? " is" : "s are"} ambiguous and need${ambiguousDeadlines === 1 ? "s" : ""} human confirmation`, "warning");
  return {
    output: analysis,
    usage,
    summary: `Extracted ${requirements.length} requirements (${requirements.filter((r) => r.mandatory).length} mandatory), ${analysis.deadlines.length} deadlines and ${analysis.evaluationCriteria.length} evaluation criteria`
  };
}

// ---------------------------------------------------------------------------
// 2. Qualification
// ---------------------------------------------------------------------------

export async function runQualification(ctx: StepContext): Promise<StepResult> {
  const analysis = completed<RfpAnalysis>(ctx, "analysis");
  const gating = analysis.requirements.filter((r) => r.mandatory && (r.category === "eligibility" || (r.category !== "submission" && ELIGIBILITY_HINT.test(r.description))));
  if (gating.length === 0) {
    const value: Qualification = { recommendation: "go", rationale: "No mandatory eligibility criteria were found in the RFP.", findings: [], override: null };
    return { output: value, usage: ZERO_USAGE, summary: "No eligibility gates found" };
  }
  await ctx.log(`Checking ${gating.length} mandatory eligibility requirement${gating.length === 1 ? "" : "s"} against approved credentials`);
  let usage = ZERO_USAGE;
  const findings = await mapLimit(gating, 3, async (requirement) => {
    const evidence = labelEvidence(await ctx.api.search(ctx.workflowId, `${requirement.code} ${requirement.description}`, 4));
    const { value, usage: u } = await ctx.provider.assessEligibility({ requirement, evidence, organizationName: ctx.context.organizationName });
    usage = addUsage(usage, u);
    const evidenceIds = value.evidenceLabels.map((label) => evidence.find((e) => e.label === label)?.id).filter((id): id is string => Boolean(id));
    // A "met" verdict without resolvable evidence is not acceptable.
    const status = value.status === "met" && evidenceIds.length === 0 ? "unknown" : value.status;
    if (status !== "met") await ctx.log(`${requirement.code}: ${status === "not_met" ? "not met" : "needs confirmation"}. ${value.note}`, "warning");
    return { requirementId: requirement.id, status, evidenceIds, note: value.note } as Qualification["findings"][number];
  });
  const recommendation = routeQualification(findings);
  const count = (s: string) => findings.filter((f) => f.status === s).length;
  const rationale =
    recommendation === "go"
      ? `All ${findings.length} mandatory eligibility requirements are supported by approved evidence.`
      : recommendation === "no_go"
        ? `${count("not_met")} mandatory requirement${count("not_met") === 1 ? " is" : "s are"} not met. An authorized person must decide whether to proceed.`
        : `${count("unknown")} mandatory requirement${count("unknown") === 1 ? " needs" : "s need"} human confirmation before bidding. ${count("met")} of ${findings.length} are supported by evidence.`;
  return {
    output: { recommendation, rationale, findings, override: null } satisfies Qualification,
    usage,
    summary: `Recommendation: ${recommendation.replace("_", "-").toUpperCase()}`
  };
}

// ---------------------------------------------------------------------------
// 3. Evidence retrieval
// ---------------------------------------------------------------------------

export async function runRetrieval(ctx: StepContext): Promise<StepResult> {
  const analysis = completed<RfpAnalysis>(ctx, "analysis");
  const targets = analysis.requirements.filter((r) => r.category !== "submission");
  await ctx.log(`Searching approved knowledge for ${targets.length} requirements`);
  const byRequirement: Record<string, string[]> = {};
  const evidence = new Map<string, Evidence>();
  await mapLimit(targets, 4, async (requirement) => {
    const results = await ctx.api.search(ctx.workflowId, requirement.description, 3);
    byRequirement[requirement.id] = results.map((r) => r.id);
    for (const item of results) if (!evidence.has(item.id)) evidence.set(item.id, item);
  });
  // Always include top case studies for summary sections.
  for (const item of await ctx.api.search(ctx.workflowId, `${ctx.context.opportunity.title} ${ctx.context.opportunity.clientName} case study delivered`, 4)) {
    if (!evidence.has(item.id)) evidence.set(item.id, item);
  }
  const uncovered = targets.filter((r) => (byRequirement[r.id] ?? []).length === 0).length;
  const assets = new Set([...evidence.values()].map((e) => e.assetId)).size;
  if (uncovered) await ctx.log(`${uncovered} requirement${uncovered === 1 ? " has" : "s have"} no matching approved evidence`, "warning");
  const output: RetrievalOutput = { byRequirement, evidence: [...evidence.values()] };
  return { output, usage: ZERO_USAGE, summary: `Retrieved ${evidence.size} evidence passages from ${assets} approved asset${assets === 1 ? "" : "s"}` };
}

// ---------------------------------------------------------------------------
// 4. Planning
// ---------------------------------------------------------------------------

const FALLBACK_SECTION: Record<RequirementCategory, { key: string; title: string; writer: "technical" | "management" }> = {
  functional: { key: "solution", title: "Proposed Solution", writer: "technical" },
  technical: { key: "technical_architecture", title: "Technical Architecture and Integration", writer: "technical" },
  security: { key: "security", title: "Security and Compliance", writer: "technical" },
  eligibility: { key: "qualifications", title: "Company Qualifications and Experience", writer: "management" },
  commercial: { key: "commercial", title: "Commercial Approach", writer: "management" },
  submission: { key: "submission_compliance", title: "Submission Compliance", writer: "management" }
};

export async function runPlanning(ctx: StepContext): Promise<StepResult> {
  const analysis = completed<RfpAnalysis>(ctx, "analysis");
  const { value: raw, usage } = await ctx.provider.plan({ requirements: analysis.requirements, summary: analysis.summary, opportunity: ctx.context.opportunity });
  const byCode = new Map(analysis.requirements.map((r) => [r.code, r.id]));
  const assigned = new Set<string>();
  const usedKeys = new Set<string>();
  const sections: ProposalPlan["sections"] = raw.map((section) => {
    let key = section.key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "section";
    while (usedKeys.has(key)) key = `${key}_2`;
    usedKeys.add(key);
    const requirementIds = section.requirementCodes
      .map((code) => byCode.get(code))
      .filter((id): id is string => Boolean(id) && !assigned.has(id!));
    requirementIds.forEach((id) => assigned.add(id));
    return { key, title: section.title, writer: section.writer, requirementIds, guidance: section.guidance };
  });
  // Deterministic guard: every requirement must be owned by a section.
  for (const requirement of analysis.requirements) {
    if (assigned.has(requirement.id)) continue;
    const fallback = FALLBACK_SECTION[requirement.category];
    let section = sections.find((s) => s.key === fallback.key);
    if (!section) {
      section = { ...fallback, requirementIds: [], guidance: "Address the assigned requirements." };
      sections.push(section);
    }
    section.requirementIds.push(requirement.id);
    assigned.add(requirement.id);
  }
  const output: ProposalPlan = { sections };
  const writers = (w: string) => sections.filter((s) => s.writer === w).length;
  return { output, usage, summary: `Planned ${sections.length} sections (${writers("technical")} technical, ${writers("management")} management)` };
}

// ---------------------------------------------------------------------------
// 5. Writing (parallel technical + management writers)
// ---------------------------------------------------------------------------

export async function runWriting(ctx: StepContext): Promise<StepResult> {
  const analysis = completed<RfpAnalysis>(ctx, "analysis");
  const plan = completed<ProposalPlan>(ctx, "planning");
  const retrieval = completed<RetrievalOutput>(ctx, "retrieval");
  const evidence = labelEvidence(retrieval.evidence);
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const requirementsById = new Map(analysis.requirements.map((r) => [r.id, r]));
  const revision = ctx.context.revision;
  const current = new Map((revision?.currentSections ?? []).map((s) => [s.key, s]));

  const targets = revision
    ? revision.sectionKeys.map((key) => {
        const planned = plan.sections.find((s) => s.key === key);
        const existing = current.get(key);
        return planned ?? { key, title: existing?.title ?? key, writer: existing?.writer ?? "management", requirementIds: existing?.requirementIds ?? [], guidance: "" };
      })
    : plan.sections;

  await ctx.log(
    revision
      ? `Revising ${targets.length} section${targets.length === 1 ? "" : "s"} with reviewer feedback`
      : `Drafting ${targets.length} sections in parallel (technical and management writers)`
  );
  let usage = ZERO_USAGE;
  const sections = await mapLimit(targets, 3, async (section): Promise<WrittenSection> => {
    const requirements = section.requirementIds.map((id) => requirementsById.get(id)).filter((r): r is Requirement => Boolean(r));
    const evidenceIds = new Set(requirements.flatMap((r) => retrieval.byRequirement[r.id] ?? []));
    let sectionEvidence = evidence.filter((e) => evidenceIds.has(e.id));
    if (section.key === "executive_summary" || sectionEvidence.length === 0) {
      sectionEvidence = [...sectionEvidence, ...evidence.filter((e) => e.assetKind === "case_study" && !evidenceIds.has(e.id))].slice(0, 12);
    }
    const { value, usage: u } = await ctx.provider.writeSection({
      organizationName: ctx.context.organizationName,
      opportunity: ctx.context.opportunity,
      section,
      requirements,
      evidence: sectionEvidence,
      revision: revision ? { feedback: revision.feedback, currentContent: current.get(section.key)?.content ?? "" } : undefined
    });
    usage = addUsage(usage, u);
    const toIds = (labels: string[]) => labels.map((label) => evidence.find((e) => e.label === label)?.id).filter((id): id is string => Boolean(id) && byId.has(id!));
    const citedInText = [...value.content.matchAll(/\[(E\d+)\]/g)].map((m) => m[1]);
    const claims = value.claims.map((claim) => ({ text: claim.text, evidenceIds: toIds(claim.evidenceLabels) }));
    await ctx.log(`${section.writer === "technical" ? "Technical" : "Management"} writer finished "${section.title}"`);
    return {
      key: section.key,
      title: section.title,
      writer: section.writer,
      content: value.content,
      requirementIds: section.requirementIds,
      evidenceIds: Array.from(new Set([...toIds(citedInText), ...claims.flatMap((c) => c.evidenceIds)])),
      claims
    };
  });
  const output: WritingOutput = { sections };
  const claimCount = sections.reduce((n, s) => n + s.claims.length, 0);
  return { output, usage, summary: `Drafted ${sections.length} section${sections.length === 1 ? "" : "s"} with ${claimCount} evidence-linked claims` };
}

// ---------------------------------------------------------------------------
// 6. Validation (compliance + claim verification)
// ---------------------------------------------------------------------------

export async function runValidation(ctx: StepContext): Promise<StepResult> {
  const analysis = completed<RfpAnalysis>(ctx, "analysis");
  const retrieval = completed<RetrievalOutput>(ctx, "retrieval");
  const written = completed<WritingOutput>(ctx, "writing");
  const evidence = labelEvidence(retrieval.evidence);
  const merged = new Map((ctx.context.revision?.currentSections ?? []).map((s) => [s.key, s]));
  for (const section of written.sections) merged.set(section.key, section);
  const sections = [...merged.values()];
  const requirements = analysis.requirements.filter((r) => r.status !== "not_applicable");

  await ctx.log(`Checking coverage of ${requirements.length} requirements and ${sections.reduce((n, s) => n + s.claims.length, 0)} claims`);
  const { value, usage } = await ctx.provider.validate({ requirements, sections, evidence });

  const knownKeys = new Set(sections.map((s) => s.key));
  const itemsById = new Map(value.requirements.map((r) => [r.requirementId, r]));
  const items: ValidationOutput["items"] = analysis.requirements.map((requirement) => {
    if (requirement.status === "not_applicable") return { requirementId: requirement.id, status: "not_applicable", sectionIds: [], note: "Marked not applicable by the team." };
    const item = itemsById.get(requirement.id);
    return item
      ? { requirementId: requirement.id, status: item.status, sectionIds: item.sectionKeys.filter((k) => knownKeys.has(k)), note: item.note }
      : { requirementId: requirement.id, status: "unaddressed", sectionIds: [], note: "The reviewer could not find a response to this requirement." };
  });

  // Deterministic rule: a claim without resolvable evidence can never be "supported".
  const claims: ValidationOutput["claims"] = [];
  for (const section of sections) {
    section.claims.forEach((claim, claimIndex) => {
      const verdict = value.claims.find((c) => c.sectionKey === section.key && c.claimIndex === claimIndex);
      let status = verdict?.status ?? "needs_confirmation";
      let note = verdict?.note ?? null;
      if (claim.evidenceIds.length === 0) {
        status = "unsupported";
        note = note ?? "No approved evidence is linked to this claim.";
      }
      claims.push({ sectionKey: section.key, claimIndex, status, note });
    });
  }
  const output: ValidationOutput = { items, claims };
  const gaps = items.filter((i) => i.status === "unaddressed" || i.status === "needs_clarification").length;
  const unsupported = claims.filter((c) => c.status !== "supported").length;
  if (gaps) await ctx.log(`${gaps} requirement${gaps === 1 ? " is" : "s are"} not yet addressed`, "warning");
  if (unsupported) await ctx.log(`${unsupported} claim${unsupported === 1 ? " needs" : "s need"} evidence or confirmation`, "warning");
  return { output, usage, summary: `Validation complete: ${items.filter((i) => i.status === "addressed").length}/${items.length} requirements addressed` };
}

export const STEP_RUNNERS = {
  analysis: runAnalysis,
  qualification: runQualification,
  retrieval: runRetrieval,
  planning: runPlanning,
  writing: runWriting,
  validation: runValidation
} as const;

export const STEP_LABELS: Record<keyof typeof STEP_RUNNERS, string> = {
  analysis: "RFP analysis",
  qualification: "Qualification",
  retrieval: "Evidence retrieval",
  planning: "Proposal planning",
  writing: "Section writing",
  validation: "Compliance and claim validation"
};

/** Starting timeouts from the blueprint (seconds). */
export const STEP_TIMEOUTS: Record<keyof typeof STEP_RUNNERS, number> = {
  analysis: 600,
  qualification: 300,
  retrieval: 120,
  planning: 180,
  writing: 600,
  validation: 300
};
