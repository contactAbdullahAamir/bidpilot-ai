import { z } from "zod";

/** Contract version shared by every service. Bump on breaking changes. */
export const CONTRACT_VERSION = "1.0";

const isoDate = z.string().datetime({ offset: true });

// ---------------------------------------------------------------------------
// Identity, organizations and roles
// ---------------------------------------------------------------------------

export const organizationRoleSchema = z.enum([
  "owner",
  "admin",
  "proposal_manager",
  "contributor",
  "reviewer"
]);

export const signupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
  organizationName: z.string().trim().min(1).max(160)
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200)
});

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean().optional()
});

const newPassword = z.string().min(8, "Use at least 8 characters").max(200);

export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email() });
export const resetPasswordSchema = z.object({ token: z.string().min(10).max(200), password: newPassword });
export const verifyEmailSchema = z.object({ token: z.string().min(10).max(200) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword });

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  role: organizationRoleSchema
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(10).max(200),
  /** Required when the invitee has no account yet. */
  name: z.string().trim().min(1).max(120).optional(),
  /** New password for a new account, or the existing account's password. */
  password: z.string().min(1).max(200)
});

export const updateMemberSchema = z.object({ role: organizationRoleSchema });

export const invitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: organizationRoleSchema,
  invitedBy: z.string().nullable(),
  expiresAt: isoDate,
  createdAt: isoDate
});

export const invitationPreviewSchema = z.object({
  email: z.string(),
  role: organizationRoleSchema,
  organizationName: z.string(),
  invitedBy: z.string().nullable(),
  accountExists: z.boolean()
});

export const membershipSchema = z.object({
  organizationId: z.string(),
  organizationName: z.string(),
  role: organizationRoleSchema
});

export const aiModeSchema = z.enum(["claude", "openai", "heuristic"]);
export type AiMode = z.infer<typeof aiModeSchema>;

export const sessionSchema = z.object({
  user: userSchema,
  memberships: z.array(membershipSchema),
  activeOrganizationId: z.string(),
  aiMode: aiModeSchema.optional(),
  aiModel: z.string().nullable().optional()
});

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export const opportunityStatusSchema = z.enum([
  "draft",
  "processing",
  "qualification",
  "research",
  "generation",
  "validation",
  "human_review",
  "completed",
  "failed"
]);

export const createOpportunitySchema = z.object({
  clientName: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  deadline: isoDate.nullable().optional(),
  context: z.string().trim().max(5000).optional()
});

export const updateOpportunitySchema = createOpportunitySchema.partial();

export const opportunitySchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  clientName: z.string(),
  title: z.string(),
  deadline: isoDate.nullable(),
  context: z.string(),
  status: opportunityStatusSchema,
  createdAt: isoDate,
  updatedAt: isoDate
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const documentStatusSchema = z.enum(["processing", "parsed", "failed"]);
export const documentKindSchema = z.enum(["rfp", "appendix"]);

export const documentSchema = z.object({
  id: z.string(),
  opportunityId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  kind: documentKindSchema,
  status: documentStatusSchema,
  pageCount: z.number().int(),
  emptyPages: z.array(z.number().int()),
  error: z.string().nullable(),
  createdAt: isoDate
});

export const pasteDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(20).max(2_000_000),
  kind: documentKindSchema.default("rfp")
});

export const documentPageSchema = z.object({
  documentId: z.string(),
  filename: z.string(),
  pageNumber: z.number().int().min(1),
  text: z.string()
});

// ---------------------------------------------------------------------------
// Knowledge base and evidence
// ---------------------------------------------------------------------------

export const knowledgeKindSchema = z.enum([
  "case_study",
  "capability",
  "certification",
  "policy",
  "team",
  "other"
]);
export const knowledgeStatusSchema = z.enum(["draft", "approved", "archived"]);

export const createKnowledgeSchema = z.object({
  title: z.string().trim().min(1).max(200),
  kind: knowledgeKindSchema,
  content: z.string().trim().min(20).max(500_000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([])
});

export const updateKnowledgeSchema = createKnowledgeSchema.partial();

export const knowledgeAssetSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: knowledgeKindSchema,
  status: knowledgeStatusSchema,
  version: z.number().int(),
  content: z.string(),
  tags: z.array(z.string()),
  chunkCount: z.number().int(),
  sourceFilename: z.string().nullable(),
  approvedAt: isoDate.nullable(),
  approvedByName: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate
});

export const evidenceSchema = z.object({
  id: z.string(), // chunk id
  assetId: z.string(),
  assetTitle: z.string(),
  assetKind: knowledgeKindSchema,
  assetVersion: z.number().int(),
  excerpt: z.string(),
  score: z.number()
});

// ---------------------------------------------------------------------------
// RFP analysis
// ---------------------------------------------------------------------------

export const requirementCategorySchema = z.enum([
  "functional",
  "technical",
  "security",
  "eligibility",
  "commercial",
  "submission"
]);

export const requirementStatusSchema = z.enum([
  "unaddressed",
  "addressed",
  "partially_addressed",
  "not_applicable",
  "needs_clarification"
]);

export const sourceRefSchema = z.object({
  documentId: z.string(),
  page: z.number().int().min(1),
  quote: z.string()
});

export const requirementSchema = z.object({
  id: z.string(),
  code: z.string(),
  description: z.string(),
  category: requirementCategorySchema,
  mandatory: z.boolean(),
  source: sourceRefSchema,
  status: requirementStatusSchema
});

export const deadlineSchema = z.object({
  id: z.string(),
  label: z.string(),
  date: z.string().nullable(), // ISO date when confidently parsed, else null
  rawText: z.string(),
  ambiguous: z.boolean(),
  confirmed: z.boolean(),
  source: sourceRefSchema
});

export const evaluationCriterionSchema = z.object({
  id: z.string(),
  name: z.string(),
  weight: z.string().nullable(),
  source: sourceRefSchema
});

export const rfpAnalysisSchema = z.object({
  summary: z.string(),
  requirements: z.array(requirementSchema),
  deadlines: z.array(deadlineSchema),
  evaluationCriteria: z.array(evaluationCriterionSchema),
  ambiguities: z.array(z.object({ id: z.string(), text: z.string(), source: sourceRefSchema.nullable() }))
});

export const qualificationFindingSchema = z.object({
  requirementId: z.string(),
  status: z.enum(["met", "unknown", "not_met"]),
  evidenceIds: z.array(z.string()),
  note: z.string()
});

export const qualificationSchema = z.object({
  recommendation: z.enum(["go", "conditional", "no_go"]),
  rationale: z.string(),
  findings: z.array(qualificationFindingSchema),
  override: z
    .object({
      recommendation: z.enum(["go", "conditional", "no_go"]),
      reason: z.string(),
      actorName: z.string(),
      at: isoDate
    })
    .nullable()
    .optional()
});

export const qualificationOverrideSchema = z.object({
  recommendation: z.enum(["go", "conditional", "no_go"]),
  reason: z.string().trim().min(10).max(2000)
});

export const confirmDeadlineSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export const updateRequirementSchema = z.object({
  status: requirementStatusSchema
});

// ---------------------------------------------------------------------------
// Proposal
// ---------------------------------------------------------------------------

export const claimStatusSchema = z.enum([
  "supported",
  "unsupported",
  "needs_confirmation",
  "conflicting",
  "stale"
]);

export const claimSchema = z.object({
  id: z.string(),
  text: z.string(),
  evidenceIds: z.array(z.string()),
  verificationStatus: claimStatusSchema,
  note: z.string().nullable()
});

export const sectionStatusSchema = z.enum(["draft", "needs_revision", "validated", "approved"]);

export const proposalSectionSchema = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  writer: z.enum(["technical", "management"]),
  position: z.number().int(),
  content: z.string(),
  requirementIds: z.array(z.string()),
  evidenceIds: z.array(z.string()),
  claims: z.array(claimSchema),
  status: sectionStatusSchema,
  version: z.number().int(),
  editedByHuman: z.boolean(),
  updatedAt: isoDate
});

export const complianceItemSchema = z.object({
  requirementId: z.string(),
  status: requirementStatusSchema,
  sectionIds: z.array(z.string()),
  note: z.string()
});

export const complianceReportSchema = z.object({
  coverage: z.number().min(0).max(1),
  mandatoryGaps: z.number().int(),
  unsupportedClaims: z.number().int(),
  items: z.array(complianceItemSchema),
  checkedAt: isoDate
});

export const proposalStatusSchema = z.enum(["draft", "in_review", "approved", "rejected"]);

export const reviewDecisionSchema = z.enum(["approve", "request_changes", "reject"]);

export const reviewSchema = z.object({
  id: z.string(),
  proposalVersion: z.number().int(),
  decision: reviewDecisionSchema,
  rationale: z.string(),
  reviewerName: z.string(),
  reviewerRole: organizationRoleSchema,
  checksum: z.string().nullable(),
  createdAt: isoDate
});

export const proposalSchema = z.object({
  id: z.string(),
  opportunityId: z.string(),
  version: z.number().int(),
  status: proposalStatusSchema,
  sections: z.array(proposalSectionSchema),
  compliance: complianceReportSchema.nullable(),
  evidence: z.array(evidenceSchema),
  reviews: z.array(reviewSchema),
  approvedChecksum: z.string().nullable(),
  updatedAt: isoDate
});

export const updateSectionSchema = z.object({
  content: z.string().max(200_000)
});

export const reviseSchema = z.object({
  sectionIds: z.array(z.string()).min(1),
  feedback: z.string().trim().min(3).max(4000)
});

export const createReviewSchema = z.object({
  decision: reviewDecisionSchema,
  rationale: z.string().trim().max(4000).default("")
});

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export const workflowStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_review",
  "completed",
  "failed",
  "cancelled"
]);

export const workflowTypeSchema = z.enum(["rfp_analysis", "revision"]);

export const workflowStepNameSchema = z.enum([
  "analysis",
  "qualification",
  "retrieval",
  "planning",
  "writing",
  "validation"
]);

export const ANALYSIS_STEPS = workflowStepNameSchema.options;
export const REVISION_STEPS = ["writing", "validation"] as const;

export const workflowStepSchema = z.object({
  step: workflowStepNameSchema,
  status: z.enum(["pending", "running", "completed", "failed", "skipped"]),
  attempts: z.number().int(),
  startedAt: isoDate.nullable(),
  completedAt: isoDate.nullable(),
  error: z.string().nullable()
});

export const workflowEventSchema = z.object({
  sequence: z.number().int(),
  step: z.string().nullable(),
  level: z.enum(["info", "success", "warning", "error"]),
  message: z.string(),
  createdAt: isoDate
});

export const workflowSchema = z.object({
  id: z.string().min(1),
  opportunityId: z.string().min(1),
  organizationId: z.string().min(1),
  type: workflowTypeSchema,
  status: workflowStatusSchema,
  currentStep: workflowStepNameSchema.nullable(),
  error: z.string().nullable(),
  mode: aiModeSchema.nullable(),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    estimatedCostUsd: z.number()
  }),
  steps: z.array(workflowStepSchema),
  events: z.array(workflowEventSchema),
  createdAt: isoDate,
  updatedAt: isoDate
});

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

export const opportunityDetailSchema = opportunitySchema.extend({
  documents: z.array(documentSchema),
  analysis: rfpAnalysisSchema.nullable(),
  qualification: qualificationSchema.nullable(),
  latestWorkflow: workflowSchema.nullable(),
  proposalStatus: proposalStatusSchema.nullable(),
  coverage: z.number().nullable()
});

export const opportunitySummarySchema = opportunitySchema.extend({
  documentCount: z.number().int(),
  requirementCount: z.number().int(),
  proposalStatus: proposalStatusSchema.nullable(),
  coverage: z.number().nullable(),
  recommendation: z.enum(["go", "conditional", "no_go"]).nullable()
});

export const dashboardSchema = z.object({
  counts: z.object({
    opportunities: z.number().int(),
    inFlight: z.number().int(),
    awaitingReview: z.number().int(),
    approved: z.number().int(),
    approvedKnowledge: z.number().int(),
    draftKnowledge: z.number().int()
  }),
  upcoming: z.array(opportunitySummarySchema),
  recent: z.array(opportunitySummarySchema),
  activity: z.array(
    z.object({ id: z.string(), action: z.string(), actorName: z.string().nullable(), entityLabel: z.string().nullable(), createdAt: isoDate })
  )
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrganizationRole = z.infer<typeof organizationRoleSchema>;
export type Signup = z.infer<typeof signupSchema>;
export type Login = z.infer<typeof loginSchema>;
export type User = z.infer<typeof userSchema>;
export type Membership = z.infer<typeof membershipSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type InviteMember = z.infer<typeof inviteMemberSchema>;
export type AcceptInvitation = z.infer<typeof acceptInvitationSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;
export type OpportunityStatus = z.infer<typeof opportunityStatusSchema>;
export type CreateOpportunity = z.infer<typeof createOpportunitySchema>;
export type UpdateOpportunity = z.infer<typeof updateOpportunitySchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;
export type OpportunityDetail = z.infer<typeof opportunityDetailSchema>;
export type OpportunitySummary = z.infer<typeof opportunitySummarySchema>;
export type DocumentRecord = z.infer<typeof documentSchema>;
export type DocumentKind = z.infer<typeof documentKindSchema>;
export type PasteDocument = z.infer<typeof pasteDocumentSchema>;
export type DocumentPage = z.infer<typeof documentPageSchema>;
export type KnowledgeKind = z.infer<typeof knowledgeKindSchema>;
export type KnowledgeStatus = z.infer<typeof knowledgeStatusSchema>;
export type CreateKnowledge = z.infer<typeof createKnowledgeSchema>;
export type UpdateKnowledge = z.infer<typeof updateKnowledgeSchema>;
export type KnowledgeAsset = z.infer<typeof knowledgeAssetSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type RequirementCategory = z.infer<typeof requirementCategorySchema>;
export type RequirementStatus = z.infer<typeof requirementStatusSchema>;
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export type Deadline = z.infer<typeof deadlineSchema>;
export type EvaluationCriterion = z.infer<typeof evaluationCriterionSchema>;
export type RfpAnalysis = z.infer<typeof rfpAnalysisSchema>;
export type Qualification = z.infer<typeof qualificationSchema>;
export type QualificationFinding = z.infer<typeof qualificationFindingSchema>;
export type QualificationOverride = z.infer<typeof qualificationOverrideSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type ClaimStatus = z.infer<typeof claimStatusSchema>;
export type ProposalSection = z.infer<typeof proposalSectionSchema>;
export type ComplianceItem = z.infer<typeof complianceItemSchema>;
export type ComplianceReport = z.infer<typeof complianceReportSchema>;
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;
export type CreateReview = z.infer<typeof createReviewSchema>;
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;
export type WorkflowType = z.infer<typeof workflowTypeSchema>;
export type WorkflowStepName = z.infer<typeof workflowStepNameSchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowEvent = z.infer<typeof workflowEventSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type Dashboard = z.infer<typeof dashboardSchema>;

// ---------------------------------------------------------------------------
// Internal orchestration contract (API <-> orchestrator)
// ---------------------------------------------------------------------------

/** Section plan produced by the planner and consumed by writers. */
export const sectionPlanSchema = z.object({
  key: z.string(),
  title: z.string(),
  writer: z.enum(["technical", "management"]),
  requirementIds: z.array(z.string()),
  guidance: z.string()
});

export const proposalPlanSchema = z.object({ sections: z.array(sectionPlanSchema) });

export const retrievalOutputSchema = z.object({
  /** requirementId -> evidence chunk ids ranked best-first */
  byRequirement: z.record(z.string(), z.array(z.string())),
  evidence: z.array(evidenceSchema)
});

export const writtenSectionSchema = z.object({
  key: z.string(),
  title: z.string(),
  writer: z.enum(["technical", "management"]),
  content: z.string(),
  requirementIds: z.array(z.string()),
  evidenceIds: z.array(z.string()),
  claims: z.array(z.object({ text: z.string(), evidenceIds: z.array(z.string()) }))
});

export const writingOutputSchema = z.object({ sections: z.array(writtenSectionSchema) });

export const validationOutputSchema = z.object({
  items: z.array(complianceItemSchema),
  claims: z.array(
    z.object({ sectionKey: z.string(), claimIndex: z.number().int(), status: claimStatusSchema, note: z.string().nullable() })
  )
});

export const internalContextSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  workflowId: z.string(),
  workflowType: workflowTypeSchema,
  status: workflowStatusSchema,
  opportunity: z.object({ id: z.string(), title: z.string(), clientName: z.string(), context: z.string(), deadline: z.string().nullable() }),
  organizationName: z.string(),
  pages: z.array(documentPageSchema),
  completed: z.record(z.string(), z.unknown()),
  revision: z.object({ sectionKeys: z.array(z.string()), feedback: z.string(), currentSections: z.array(writtenSectionSchema) }).nullable()
});

export type SectionPlan = z.infer<typeof sectionPlanSchema>;
export type ProposalPlan = z.infer<typeof proposalPlanSchema>;
export type RetrievalOutput = z.infer<typeof retrievalOutputSchema>;
export type WrittenSection = z.infer<typeof writtenSectionSchema>;
export type WritingOutput = z.infer<typeof writingOutputSchema>;
export type ValidationOutput = z.infer<typeof validationOutputSchema>;
export type InternalContext = z.infer<typeof internalContextSchema>;

/** Analysis step output (rfpAnalysis without human-confirmation flags applied). */
export type AnalysisOutput = RfpAnalysis;
export type QualificationOutput = Qualification;

// ---------------------------------------------------------------------------
// Pure helpers shared by API, orchestrator and web
// ---------------------------------------------------------------------------

/** Coverage = addressed + 0.5 * partial over applicable requirements. */
export function computeCoverage(items: Pick<ComplianceItem, "status">[]): number {
  const applicable = items.filter((item) => item.status !== "not_applicable");
  if (applicable.length === 0) return 1;
  const score = applicable.reduce((total, item) => {
    if (item.status === "addressed") return total + 1;
    if (item.status === "partially_addressed") return total + 0.5;
    return total;
  }, 0);
  return Math.round((score / applicable.length) * 1000) / 1000;
}

/** Deterministic qualification routing from per-requirement findings. */
export function routeQualification(
  findings: Pick<QualificationFinding, "status">[]
): Qualification["recommendation"] {
  if (findings.some((finding) => finding.status === "not_met")) return "no_go";
  if (findings.some((finding) => finding.status === "unknown")) return "conditional";
  return "go";
}

export const ROLE_PERMISSIONS = {
  manageKnowledge: ["owner", "admin", "proposal_manager"],
  approveKnowledge: ["owner", "admin"],
  manageOpportunities: ["owner", "admin", "proposal_manager"],
  editProposal: ["owner", "admin", "proposal_manager", "contributor"],
  review: ["owner", "admin", "reviewer"],
  overrideQualification: ["owner", "admin", "proposal_manager"],
  manageMembers: ["owner", "admin"]
} as const satisfies Record<string, readonly OrganizationRole[]>;

export type Permission = keyof typeof ROLE_PERMISSIONS;

export function can(role: OrganizationRole, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[permission] as readonly OrganizationRole[]).includes(role);
}
