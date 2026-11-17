import assert from "node:assert/strict";
import { test } from "node:test";
import type { Evidence, InternalContext, ProposalPlan, Qualification, RfpAnalysis, ValidationOutput, WritingOutput } from "@bidpilot/contracts";
import { ApiClient } from "../src/api-client";
import { HeuristicProvider } from "../src/providers/heuristic";
import { WorkflowRunner } from "../src/runner";
import { sentences } from "../src/text";

const RFP = [
  `RFP: Portal Modernization
Proposals due on or about February 12, 2027 at 2:00 PM local time.
Written questions due: January 15, 2027.`,
  `3. Mandatory Eligibility Requirements
M-1. The vendor must hold a current SOC 2 Type II report.
M-2. The vendor must hold a current ISO/IEC 27001 certification.`,
  `4. Functional Requirements
F-1. The portal shall support English and Spanish for all resident-facing content.
F-2. The portal must conform to WCAG 2.1 Level AA accessibility guidelines.
C-1. Pricing shall be provided as fixed-fee milestones.
Evaluation criteria
Technical approach - 60%
Price - 40%`
];

const EVIDENCE: Evidence[] = [
  { id: "e-iso", assetId: "a1", assetTitle: "Security policy", assetKind: "policy", assetVersion: 1, excerpt: "Northstar has held ISO/IEC 27001 certification since 2019. Northstar does not currently hold a SOC 2 Type II report.", score: 1 },
  { id: "e-dmv", assetId: "a2", assetTitle: "Case study: DMV portal", assetKind: "case_study", assetVersion: 1, excerpt: "Northstar designed and built a bilingual English and Spanish resident portal conforming to WCAG 2.1 Level AA.", score: 1 }
];

/** In-memory stand-in for the API's internal endpoints. */
class FakeApi extends ApiClient {
  steps: Record<string, unknown> = {};
  events: string[] = [];
  finished: { status: string; error?: string } | null = null;
  runningCalls = 0;
  constructor(private readonly ctx: InternalContext) {
    super("http://unused", "token");
  }
  override async context() {
    return structuredClone({ ...this.ctx, completed: { ...this.ctx.completed, ...this.steps } });
  }
  override async step(_id: string, step: string, body: { status: string; output?: unknown }) {
    if (body.status === "running") this.runningCalls += 1;
    if (body.status === "completed") this.steps[step] = body.output;
  }
  override async event(_id: string, _step: string | null, _level: string, message: string) {
    this.events.push(message);
  }
  override async search(_id: string, query: string) {
    const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
    return EVIDENCE.filter((e) => terms.some((t) => e.excerpt.toLowerCase().includes(t)));
  }
  override async finish(_id: string, body: { status: "waiting_review" | "failed"; error?: string }) {
    this.finished = body;
  }
}

function context(): InternalContext {
  return {
    contractVersion: "1.0",
    workflowId: "00000000-0000-0000-0000-000000000001",
    workflowType: "rfp_analysis",
    status: "queued",
    opportunity: { id: "o1", title: "Portal Modernization", clientName: "CivicWorks", context: "", deadline: null },
    organizationName: "Northstar",
    pages: RFP.map((text, i) => ({ documentId: "d1", filename: "rfp.txt", pageNumber: i + 1, text })),
    completed: {},
    revision: null
  };
}

test("sentence splitter keeps list codes attached", () => {
  assert.deepEqual(sentences("M-2. The vendor must hold a SOC 2 report. It must be current."), ["M-2. The vendor must hold a SOC 2 report.", "It must be current."]);
});

test("full pipeline produces a validated, evidence-linked draft", async () => {
  const api = new FakeApi(context());
  const runner = new WorkflowRunner(new HeuristicProvider(), api);
  await runner.run("wf", { cancelled: false });

  assert.deepEqual(api.finished, { status: "waiting_review" });
  const analysis = api.steps.analysis as RfpAnalysis;
  const codes = analysis.requirements.map((r) => r.code);
  for (const code of ["M-1", "M-2", "F-1", "F-2", "C-1"]) assert.ok(codes.includes(code), `extracted ${code}`);
  assert.ok(!codes.some((c) => c.includes("′")), "section headings are not requirements");
  assert.ok(analysis.requirements.every((r) => r.source.page >= 1 && r.source.documentId === "d1"));
  assert.ok(analysis.deadlines.some((d) => d.ambiguous && d.date === "2027-02-12"), "ambiguous deadline flagged");
  assert.equal(analysis.evaluationCriteria.length, 2);

  const qualification = api.steps.qualification as Qualification;
  assert.equal(qualification.recommendation, "conditional", "missing SOC 2 must not be silently qualified");

  const plan = api.steps.planning as ProposalPlan;
  const assigned = plan.sections.flatMap((s) => s.requirementIds);
  assert.equal(new Set(assigned).size, analysis.requirements.length, "every requirement owned by exactly one section");

  const writing = api.steps.writing as WritingOutput;
  const known = new Set(EVIDENCE.map((e) => e.id));
  assert.ok(writing.sections.flatMap((s) => s.claims).every((c) => c.evidenceIds.every((id) => known.has(id))));
  assert.ok(!writing.sections.find((s) => s.key === "commercial")!.content.match(/\$\d/), "no generated prices");

  const validation = api.steps.validation as ValidationOutput;
  assert.equal(validation.items.length, analysis.requirements.length);
});

test("resume skips completed steps after a restart", async () => {
  const first = new FakeApi(context());
  await new WorkflowRunner(new HeuristicProvider(), first).run("wf", { cancelled: false });
  const resumed = new FakeApi({ ...context(), completed: { analysis: first.steps.analysis, qualification: first.steps.qualification, retrieval: first.steps.retrieval } });
  await new WorkflowRunner(new HeuristicProvider(), resumed).run("wf", { cancelled: false });
  assert.equal(resumed.runningCalls, 3, "only planning, writing and validation re-run");
  assert.equal(resumed.finished?.status, "waiting_review");
});

test("cancelled runs stop without finishing", async () => {
  const api = new FakeApi(context());
  await new WorkflowRunner(new HeuristicProvider(), api).run("wf", { cancelled: true });
  assert.equal(api.finished, null);
});
