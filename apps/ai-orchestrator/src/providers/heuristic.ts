import type { Requirement, RequirementCategory } from "@bidpilot/contracts";
import { keywords, overlap, sentences } from "../text";
import {
  EligibilityVerdict,
  LabeledEvidence,
  ModelProvider,
  RawAnalysis,
  RawPlanSection,
  RawValidation,
  Result,
  SectionDraft,
  SectionDraftInput,
  ValidationInput,
  ZERO_USAGE
} from "./types";

const OBLIGATION = /\b(shall|must|is required to|are required to|required|will be required)\b/i;
const HEADING = /^(\d+(\.\d+)*\.?|[A-Z]\.)\s+[A-Z][^.!?]{0,80}$/;
const MANDATORY = /\b(must|shall|mandatory|required|non-responsive)\b/i;
const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
const DATE_PATTERNS = [
  new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2}),?\\s+(\\d{4})`, "i"),
  /\b(\d{4})-(\d{2})-(\d{2})\b/,
  /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/
];
const AMBIGUOUS = /\b(on or about|approximately|tbd|to be determined|as needed|may adjust|subject to change|etc\.?|reasonable)\b/i;

export function classify(text: string): RequirementCategory {
  const t = text.toLowerCase();
  if (/\b(proposals? (must|shall) (be submitted|include)|submitted electronically|submission instructions|page limit|not exceeding \d+ pages|single pdf|attachment [a-z0-9]\b|late proposals)/.test(t)) return "submission";
  if (/\b(price|pricing|cost|fee|invoice|payment|milestone payments?|net \d+)\b/.test(t)) return "commercial";
  if (/\b(certif|soc 2|iso\/iec|iso 27001|insurance|years of experience|experience delivering|licensed|eligib|pmp)\w*/.test(t)) return "eligibility";
  if (/\b(encrypt|security|incident|mfa|multi-factor|sso|single sign-on|saml|vulnerab|penetration|privacy|gdpr|hipaa|access control)\w*/.test(t)) return "security";
  if (/\b(integrat|api|apis|cloud|host|hosting|availability|uptime|scal|concurrent|performance|architecture|database|fedramp|infrastructure)\w*/.test(t)) return "technical";
  return "functional";
}

function parseDate(text: string): string | null {
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const date = new Date(match[0].replace(/,/g, ""));
    if (!Number.isNaN(date.getTime())) {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }
  }
  return null;
}

function shortTitle(text: string, max = 90): string {
  const clean = text.replace(/^[A-Z]{1,3}-?\d+[.)]?\s*/, "").replace(/^the (vendor|portal|solution|contractor) (shall|must|will)\s+/i, "").trim();
  const capped = clean.charAt(0).toUpperCase() + clean.slice(1);
  return capped.length > max ? `${capped.slice(0, max - 1).trim()}…` : capped.replace(/\.$/, "");
}

/** Pick the evidence sentence most relevant to a requirement. */
function bestSentence(requirement: string, evidence: LabeledEvidence[]): { sentence: string; label: string; score: number } | null {
  let best: { sentence: string; label: string; score: number } | null = null;
  for (const item of evidence) {
    for (const sentence of sentences(item.excerpt)) {
      const score = overlap(requirement, sentence);
      if (!best || score > best.score) best = { sentence: sentence.replace(/^[^:]{1,60}:\s+/, ""), label: item.label, score };
    }
  }
  return best && best.score >= 0.2 ? best : null;
}

const NEGATION = /\b(not|no|never|planned|pending|in progress|does not|do not|lacks?|without)\b/i;

/**
 * Deterministic, offline provider used when no Anthropic credentials are
 * configured. It never invents facts: drafts only restate RFP requirements
 * and quote approved evidence, and everything it cannot support is flagged.
 */
export class HeuristicProvider implements ModelProvider {
  readonly mode = "heuristic" as const;

  async analyze({ pages }: Parameters<ModelProvider["analyze"]>[0]): Promise<Result<RawAnalysis>> {
    const requirements: RawAnalysis["requirements"] = [];
    const deadlines: RawAnalysis["deadlines"] = [];
    const evaluationCriteria: RawAnalysis["evaluationCriteria"] = [];
    const ambiguities: RawAnalysis["ambiguities"] = [];
    const seen = new Set<string>();
    const counters: Record<string, number> = {};
    let inEvaluation = false;

    pages.forEach((page, pageIndex) => {
      const pageNo = pageIndex + 1;
      for (const line of page.text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const isHeading = HEADING.test(trimmed);
        if (/evaluation criteria|scored on|scoring/i.test(trimmed)) inEvaluation = true;
        else if (/^\d+\.\s+[A-Z]/.test(trimmed) && !/evaluation/i.test(trimmed)) inEvaluation = false;

        const weight = trimmed.match(/(\d{1,3})\s*(%|percent|points)/i);
        if (inEvaluation && weight && trimmed.length < 160) {
          evaluationCriteria.push({ name: trimmed.replace(/[-–:]*\s*\d{1,3}\s*(%|percent|points).*$/i, "").trim(), weight: `${weight[1]}${weight[2] === "%" ? "%" : ` ${weight[2]}`}`, page: pageNo });
          continue;
        }

        for (const sentence of sentences(trimmed)) {
          const date = parseDate(sentence);
          if (date && /\b(due|deadline|conference|award|submit|questions|closing|no later than)\b/i.test(sentence)) {
            const ambiguous = AMBIGUOUS.test(sentence) || AMBIGUOUS.test(trimmed);
            deadlines.push({
              label: sentence.split(/[:]/)[0].replace(/\bon or about\b.*$/i, "").slice(0, 80).trim() || "Deadline",
              date,
              rawText: sentence,
              ambiguous,
              page: pageNo
            });
          }
          if (AMBIGUOUS.test(sentence)) ambiguities.push({ text: sentence, page: pageNo });
          if (isHeading || !OBLIGATION.test(sentence) || sentence.length < 25 || /deemed non-responsive|will be scored|following criteria/i.test(sentence)) continue;
          const key = sentence.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const explicitCode = sentence.match(/^([A-Z]{1,3}-?\d{1,3})[.)]?\s/);
          const category = classify(sentence);
          const prefix = { functional: "F", technical: "T", security: "S", eligibility: "M", commercial: "C", submission: "SUB" }[category];
          counters[prefix] = (counters[prefix] ?? 0) + 1;
          requirements.push({
            code: explicitCode ? explicitCode[1] : `${prefix}-${counters[prefix]}`,
            description: shortTitle(sentence, 400),
            category,
            mandatory: MANDATORY.test(sentence) || category === "eligibility",
            page: pageNo,
            quote: sentence
          });
        }
      }
    });

    const categories = new Set(requirements.map((r) => r.category));
    const summary =
      `The RFP spans ${pages.length} page${pages.length === 1 ? "" : "s"} with ${requirements.length} requirements ` +
      `(${requirements.filter((r) => r.mandatory).length} mandatory) across ${categories.size} categories, ` +
      `${deadlines.length} dated milestone${deadlines.length === 1 ? "" : "s"} and ${evaluationCriteria.length} evaluation criteria.` +
      (ambiguities.length ? ` ${ambiguities.length} statement${ambiguities.length === 1 ? " needs" : "s need"} clarification.` : "");
    return { value: { summary, requirements, deadlines, evaluationCriteria, ambiguities }, usage: ZERO_USAGE };
  }

  async assessEligibility({ requirement, evidence }: Parameters<ModelProvider["assessEligibility"]>[0]): Promise<Result<EligibilityVerdict>> {
    const best = bestSentence(requirement.description, evidence);
    if (!best) {
      return { value: { status: "unknown", evidenceLabels: [], note: "No approved evidence found. Confirm with the team or add a knowledge asset." }, usage: ZERO_USAGE };
    }
    if (NEGATION.test(best.sentence)) {
      return {
        value: { status: "unknown", evidenceLabels: [best.label], note: `Evidence suggests this may not be met: "${best.sentence}" A human must confirm.` },
        usage: ZERO_USAGE
      };
    }
    const status = best.score >= 0.45 ? "met" : "unknown";
    return {
      value: { status, evidenceLabels: [best.label], note: status === "met" ? `Supported by: "${best.sentence}"` : `Partial match only: "${best.sentence}" Confirm before relying on it.` },
      usage: ZERO_USAGE
    };
  }

  async plan({ requirements }: Parameters<ModelProvider["plan"]>[0]): Promise<Result<RawPlanSection[]>> {
    const byCategory = (cats: RequirementCategory[]) => requirements.filter((r) => cats.includes(r.category)).map((r) => r.code);
    const sections: RawPlanSection[] = [
      { key: "executive_summary", title: "Executive Summary", writer: "management", requirementCodes: [], guidance: "Summarize fit, approach and differentiators." },
      { key: "qualifications", title: "Company Qualifications and Experience", writer: "management", requirementCodes: byCategory(["eligibility"]), guidance: "Address every eligibility requirement with evidence." },
      { key: "solution", title: "Proposed Solution", writer: "technical", requirementCodes: byCategory(["functional"]), guidance: "Explain how each functional requirement is met." },
      { key: "technical_architecture", title: "Technical Architecture and Integration", writer: "technical", requirementCodes: byCategory(["technical"]), guidance: "Cover hosting, integration, scalability and availability." },
      { key: "security", title: "Security and Compliance", writer: "technical", requirementCodes: byCategory(["security"]), guidance: "Cover encryption, identity and incident response." },
      {
        key: "delivery",
        title: "Delivery Plan, Training and Support",
        writer: "management",
        requirementCodes: requirements.filter((r) => r.category === "functional" && /deliver|training|support|maintenance|months/i.test(r.description)).map((r) => r.code),
        guidance: "Timeline, governance, training and support."
      },
      { key: "commercial", title: "Commercial Approach", writer: "management", requirementCodes: byCategory(["commercial"]), guidance: "Describe the pricing structure only; never commit to numbers." },
      { key: "submission_compliance", title: "Submission Compliance", writer: "management", requirementCodes: byCategory(["submission"]), guidance: "Confirm format and submission rules." }
    ];
    // Delivery-flavoured functional requirements belong to delivery, not solution.
    const delivery = new Set(sections.find((s) => s.key === "delivery")!.requirementCodes);
    sections.find((s) => s.key === "solution")!.requirementCodes = sections.find((s) => s.key === "solution")!.requirementCodes.filter((c) => !delivery.has(c));
    return { value: sections.filter((s) => s.key === "executive_summary" || s.requirementCodes.length > 0), usage: ZERO_USAGE };
  }

  async writeSection(input: SectionDraftInput): Promise<Result<SectionDraft>> {
    const { organizationName: org, opportunity, section, requirements, evidence } = input;
    const claims: SectionDraft["claims"] = [];
    const parts: string[] = [];

    if (section.key === "executive_summary") {
      parts.push(
        `${org} is pleased to submit this response to ${opportunity.clientName} for **${opportunity.title}**.`,
        `This proposal responds to each requirement in the RFP and links every factual statement about ${org} to approved company evidence. Statements that still need confirmation are flagged for the review team.`
      );
      const highlights = evidence.filter((e) => e.assetKind === "case_study").slice(0, 2);
      if (highlights.length) {
        parts.push("### Relevant experience");
        for (const item of highlights) {
          const sentence = sentences(item.excerpt).find((s) => s.length > 50 && /deliver|built|went live|achiev|replac|designed/i.test(s)) ?? sentences(item.excerpt).find((s) => s.length > 50);
          if (!sentence) continue;
          const text = sentence.replace(/^[^:]{1,60}:\s+/, "");
          parts.push(`- **${item.assetTitle.replace(/^Case study:\s*/i, "")}**: ${text} [${item.label}]`);
          claims.push({ text, evidenceLabels: [item.label] });
        }
      }
    } else if (section.key === "commercial") {
      parts.push(`${org} will provide pricing in the format requested by ${opportunity.clientName}.`);
      for (const requirement of requirements) {
        parts.push(`**${requirement.code}.** ${requirement.description}. Acknowledged. *[Needs input: the commercial team must supply figures. Pricing is never generated automatically.]*`);
      }
    } else {
      if (input.revision?.feedback) parts.push(`*Revised to address reviewer feedback: ${input.revision.feedback}*`);
      for (const requirement of requirements) {
        const best = bestSentence(requirement.description, evidence);
        parts.push(`#### ${requirement.code}: ${shortTitle(requirement.description, 80)}`);
        if (best && !NEGATION.test(best.sentence)) {
          parts.push(`${org} meets this requirement. ${best.sentence} [${best.label}]`);
          claims.push({ text: best.sentence, evidenceLabels: [best.label] });
        } else if (best) {
          parts.push(`${best.sentence} [${best.label}] *[Needs input: approved evidence suggests a gap. Confirm the position or provide a mitigation before submission.]*`);
          claims.push({ text: best.sentence, evidenceLabels: [best.label] });
        } else if (requirement.category === "submission") {
          parts.push(`${org} will comply with this submission requirement.`);
        } else {
          parts.push(`${org} will address this requirement in the delivered solution. *[Needs input: no approved evidence was found. Add details or evidence before submission.]*`);
        }
      }
    }
    return { value: { content: parts.join("\n\n"), claims }, usage: ZERO_USAGE };
  }

  async validate({ requirements, sections, evidence }: ValidationInput): Promise<Result<RawValidation>> {
    const byId = new Map(evidence.map((e) => [e.id, e]));
    const result: RawValidation = { requirements: [], claims: [] };
    for (const requirement of requirements) {
      const owning = sections.filter((s) => s.requirementIds.includes(requirement.id));
      if (owning.length === 0) {
        result.requirements.push({ requirementId: requirement.id, status: "unaddressed", sectionKeys: [], note: "No proposal section is assigned to this requirement." });
        continue;
      }
      const text = owning.map((s) => s.content).join("\n");
      const mentioned = text.includes(requirement.code) || overlap(requirement.description, text) >= 0.5;
      const flagged = new RegExp(`${requirement.code.replace(/[-]/g, "\\-")}[^#]*?\\[Needs input`, "s").test(text);
      result.requirements.push({
        requirementId: requirement.id,
        status: !mentioned ? "unaddressed" : flagged ? "partially_addressed" : "addressed",
        sectionKeys: owning.map((s) => s.key),
        note: !mentioned ? "Not discussed in the assigned section." : flagged ? "Response is flagged as needing input or evidence." : "Addressed in the assigned section."
      });
    }
    for (const section of sections) {
      section.claims.forEach((claim, claimIndex) => {
        const sources = claim.evidenceIds.map((id) => byId.get(id)).filter(Boolean);
        if (sources.length === 0) {
          result.claims.push({ sectionKey: section.key, claimIndex, status: "unsupported", note: "No approved evidence is linked to this claim." });
          return;
        }
        const support = Math.max(...sources.map((s) => overlap(claim.text, s!.excerpt)));
        if (NEGATION.test(claim.text)) {
          result.claims.push({ sectionKey: section.key, claimIndex, status: "needs_confirmation", note: "Evidence describes a gap or a future plan, not a current capability." });
        } else {
          result.claims.push({
            sectionKey: section.key,
            claimIndex,
            status: support >= 0.6 ? "supported" : "needs_confirmation",
            note: support >= 0.6 ? null : "Evidence only partially matches this wording."
          });
        }
      });
    }
    return { value: result, usage: ZERO_USAGE };
  }
}

export { keywords };
export type { Requirement };
