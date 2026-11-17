import type {
  DocumentPage,
  Evidence,
  Requirement,
  RequirementCategory,
  RequirementStatus,
  ClaimStatus
} from "@bidpilot/contracts";

export type Usage = { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    estimatedCostUsd: Math.round((a.estimatedCostUsd + b.estimatedCostUsd) * 10000) / 10000
  };
}

export type Result<T> = { value: T; usage: Usage };

/** Page reference label "P{n}" maps to an index in the pages array (1-based). */
export type RawAnalysis = {
  summary: string;
  requirements: { code: string; description: string; category: RequirementCategory; mandatory: boolean; page: number; quote: string }[];
  deadlines: { label: string; date: string | null; rawText: string; ambiguous: boolean; page: number }[];
  evaluationCriteria: { name: string; weight: string | null; page: number }[];
  ambiguities: { text: string; page: number | null }[];
};

export type EligibilityVerdict = { status: "met" | "unknown" | "not_met"; evidenceLabels: string[]; note: string };

export type RawPlanSection = { key: string; title: string; writer: "technical" | "management"; requirementCodes: string[]; guidance: string };

export type LabeledEvidence = Evidence & { label: string };

export type SectionDraftInput = {
  organizationName: string;
  opportunity: { title: string; clientName: string; context: string };
  section: { key: string; title: string; writer: "technical" | "management"; guidance: string };
  requirements: Requirement[];
  evidence: LabeledEvidence[];
  revision?: { feedback: string; currentContent: string };
};

export type SectionDraft = { content: string; claims: { text: string; evidenceLabels: string[] }[] };

export type ValidationInput = {
  requirements: Requirement[];
  sections: { key: string; title: string; content: string; requirementIds: string[]; claims: { text: string; evidenceIds: string[] }[] }[];
  evidence: LabeledEvidence[];
};

export type RawValidation = {
  requirements: { requirementId: string; status: RequirementStatus; sectionKeys: string[]; note: string }[];
  claims: { sectionKey: string; claimIndex: number; status: ClaimStatus; note: string | null }[];
};

/**
 * Model provider adapter. Business rules (routing, ids, permissions,
 * citation mapping) live outside providers in deterministic code.
 */
export interface ModelProvider {
  readonly mode: "claude" | "heuristic";
  analyze(input: { pages: DocumentPage[]; opportunity: { title: string; clientName: string; context: string } }): Promise<Result<RawAnalysis>>;
  assessEligibility(input: { requirement: Requirement; evidence: LabeledEvidence[]; organizationName: string }): Promise<Result<EligibilityVerdict>>;
  plan(input: { requirements: Requirement[]; summary: string; opportunity: { title: string; clientName: string } }): Promise<Result<RawPlanSection[]>>;
  writeSection(input: SectionDraftInput): Promise<Result<SectionDraft>>;
  validate(input: ValidationInput): Promise<Result<RawValidation>>;
}

export class NonRetryableError extends Error {}
