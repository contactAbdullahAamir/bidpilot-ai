import assert from "node:assert/strict";
import { test } from "node:test";
import contracts from "../dist/index.js";

const { computeCoverage, routeQualification, can, rfpAnalysisSchema, createOpportunitySchema } = contracts;

test("coverage counts partial as half and ignores not-applicable", () => {
  assert.equal(computeCoverage([{ status: "addressed" }, { status: "partially_addressed" }, { status: "not_applicable" }, { status: "unaddressed" }]), 0.5);
  assert.equal(computeCoverage([]), 1);
});

test("qualification routing is deterministic", () => {
  assert.equal(routeQualification([{ status: "met" }]), "go");
  assert.equal(routeQualification([{ status: "met" }, { status: "unknown" }]), "conditional");
  assert.equal(routeQualification([{ status: "unknown" }, { status: "not_met" }]), "no_go");
});

test("role permissions", () => {
  assert.ok(can("reviewer", "review"));
  assert.ok(!can("reviewer", "editProposal"));
  assert.ok(!can("contributor", "approveKnowledge"));
  assert.ok(can("owner", "manageMembers"));
});

test("schemas reject malformed input", () => {
  assert.throws(() => createOpportunitySchema.parse({ clientName: "", title: "x" }));
  assert.throws(() => rfpAnalysisSchema.parse({ summary: "x", requirements: [{ id: "1" }], deadlines: [], evaluationCriteria: [], ambiguities: [] }));
});
