import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";
import {
  ANALYSIS_STEPS,
  CONTRACT_VERSION,
  qualificationSchema,
  retrievalOutputSchema,
  reviseSchema,
  REVISION_STEPS,
  rfpAnalysisSchema,
  validationOutputSchema,
  workflowStepNameSchema,
  writingOutputSchema,
  type InternalContext,
  type OpportunityStatus,
  type Qualification,
  type RetrievalOutput,
  type RfpAnalysis,
  type Workflow,
  type WorkflowEvent,
  type WorkflowStatus,
  type WorkflowStep,
  type WorkflowStepName,
  type WorkflowType
} from "@bidpilot/contracts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Auth, AuthContext, InternalGuard, Public, RequirePermission } from "../auth/auth";
import { AuditService } from "../core/common";
import { DatabaseService, iso, isoRequired, json, Queryable } from "../core/database.service";
import { DocumentsService } from "../documents/documents";
import { KnowledgeService } from "../knowledge/knowledge";
import { ProposalsService } from "../proposals/proposals";
import { OrchestratorClient } from "./orchestrator.client";

const STEP_TO_OPPORTUNITY_STATUS: Record<WorkflowStepName, OpportunityStatus> = {
  analysis: "processing",
  qualification: "qualification",
  retrieval: "research",
  planning: "generation",
  writing: "generation",
  validation: "validation"
};

const ACTIVE: WorkflowStatus[] = ["queued", "running"];
const MAX_DISPATCH_ATTEMPTS = 6;

type WorkflowRow = {
  id: string;
  opportunity_id: string;
  organization_id: string;
  type: WorkflowType;
  status: WorkflowStatus;
  current_step: WorkflowStepName | null;
  error: string | null;
  mode: "claude" | "openai" | "heuristic" | null;
  usage: unknown;
  revision: unknown;
  source_workflow_id: string | null;
  dispatch_attempts: number;
  created_at: Date;
  updated_at: Date;
};

type StepRow = {
  step: WorkflowStepName;
  status: WorkflowStep["status"];
  attempts: number;
  output: unknown;
  error: string | null;
  started_at: Date | null;
  completed_at: Date | null;
};

@Injectable()
export class WorkflowsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Workflows");
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly orchestrator: OrchestratorClient,
    private readonly documents: DocumentsService,
    private readonly knowledge: KnowledgeService,
    private readonly proposals: ProposalsService
  ) {}

  onModuleInit(): void {
    if (process.env.DISABLE_RECONCILER === "1") return;
    this.timer = setInterval(() => void this.reconcile().catch((e) => this.logger.warn(`Reconcile failed: ${e.message}`)), 15_000);
    setTimeout(() => void this.reconcile().catch(() => undefined), 3_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  private async load(row: WorkflowRow, afterSequence = 0): Promise<Workflow> {
    const steps = await this.db.query<StepRow>("SELECT * FROM workflow_steps WHERE workflow_id = $1 ORDER BY position", [row.id]);
    const events = await this.db.query<{ sequence: number; step: string | null; level: WorkflowEvent["level"]; message: string; created_at: Date }>(
      "SELECT * FROM workflow_events WHERE workflow_id = $1 AND sequence > $2 ORDER BY sequence LIMIT 500",
      [row.id, afterSequence]
    );
    return {
      id: row.id,
      opportunityId: row.opportunity_id,
      organizationId: row.organization_id,
      type: row.type,
      status: row.status,
      currentStep: row.current_step,
      error: row.error,
      mode: row.mode,
      usage: json(row.usage, { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }),
      steps: steps.map((s) => ({
        step: s.step,
        status: s.status,
        attempts: Number(s.attempts),
        startedAt: iso(s.started_at),
        completedAt: iso(s.completed_at),
        error: s.error
      })),
      events: events.map((e) => ({ sequence: Number(e.sequence), step: e.step, level: e.level, message: e.message, createdAt: isoRequired(e.created_at) })),
      createdAt: isoRequired(row.created_at),
      updatedAt: isoRequired(row.updated_at)
    };
  }

  private async row(id: string, organizationId?: string): Promise<WorkflowRow> {
    const rows = organizationId
      ? await this.db.query<WorkflowRow>("SELECT * FROM workflows WHERE id = $1 AND organization_id = $2", [id, organizationId])
      : await this.db.query<WorkflowRow>("SELECT * FROM workflows WHERE id = $1", [id]);
    if (!rows[0]) throw new NotFoundException("Workflow not found");
    return rows[0];
  }

  async get(organizationId: string, id: string, afterSequence = 0): Promise<Workflow> {
    return this.load(await this.row(id, organizationId), afterSequence);
  }

  async latest(organizationId: string, opportunityId: string): Promise<Workflow | null> {
    const rows = await this.db.query<WorkflowRow>(
      "SELECT * FROM workflows WHERE organization_id = $1 AND opportunity_id = $2 ORDER BY created_at DESC LIMIT 1",
      [organizationId, opportunityId]
    );
    return rows[0] ? this.load(rows[0]) : null;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  async startAnalysis(auth: AuthContext, opportunityId: string): Promise<Workflow> {
    const pages = await this.documents.pagesForOpportunity(auth.organizationId, opportunityId);
    if (pages.length === 0) throw new BadRequestException("Add the RFP document first. We need readable pages to analyze.");
    return this.create(auth, opportunityId, "rfp_analysis", ANALYSIS_STEPS, null, null);
  }

  async startRevision(auth: AuthContext, opportunityId: string, sectionIds: string[], feedback: string): Promise<Workflow> {
    const sections = await this.db.query<{ id: string; key: string }>(
      `SELECT s.id, s.key FROM proposal_sections s JOIN proposals p ON p.id = s.proposal_id
       WHERE p.opportunity_id = $1 AND p.organization_id = $2`,
      [opportunityId, auth.organizationId]
    );
    const keys = sections.filter((s) => sectionIds.includes(s.id)).map((s) => s.key);
    if (keys.length === 0) throw new BadRequestException("Select at least one section to revise.");
    const source = await this.db.query<{ id: string }>(
      `SELECT w.id FROM workflows w WHERE w.organization_id = $1 AND w.opportunity_id = $2 AND w.type = 'rfp_analysis'
         AND EXISTS (SELECT 1 FROM workflow_steps s WHERE s.workflow_id = w.id AND s.step = 'planning' AND s.status = 'completed')
       ORDER BY w.created_at DESC LIMIT 1`,
      [auth.organizationId, opportunityId]
    );
    if (!source[0]) throw new BadRequestException("Run a full analysis before requesting revisions.");
    return this.create(auth, opportunityId, "revision", REVISION_STEPS, { sectionKeys: keys, feedback }, source[0].id);
  }

  private async create(
    auth: AuthContext,
    opportunityId: string,
    type: WorkflowType,
    steps: readonly WorkflowStepName[],
    revision: { sectionKeys: string[]; feedback: string } | null,
    sourceWorkflowId: string | null
  ): Promise<Workflow> {
    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      const opp = await tx.query<{ title: string }>("SELECT title FROM opportunities WHERE id = $1 AND organization_id = $2", [opportunityId, auth.organizationId]);
      if (!opp[0]) throw new NotFoundException("Opportunity not found");
      const active = await tx.query("SELECT 1 FROM workflows WHERE opportunity_id = $1 AND status = ANY($2::text[])", [opportunityId, `{${ACTIVE.join(",")}}`]);
      if (active.length) throw new ConflictException("A workflow is already running for this opportunity.");
      await tx.query(
        `INSERT INTO workflows (id, opportunity_id, organization_id, type, status, revision, source_workflow_id, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'queued',$5,$6,$7,now(),now())`,
        [id, opportunityId, auth.organizationId, type, revision, sourceWorkflowId, auth.userId]
      );
      for (const [position, step] of steps.entries()) {
        await tx.query("INSERT INTO workflow_steps (workflow_id, step, position, status) VALUES ($1,$2,$3,'pending')", [id, step, position]);
      }
      await tx.query("UPDATE opportunities SET status = 'processing', updated_at = now() WHERE id = $1", [opportunityId]);
      await this.addEvent(tx, id, null, "info", type === "revision" ? `Revision requested for ${revision!.sectionKeys.length} section(s)` : "Analysis queued");
      await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: `workflow.${type}.started`, entityType: "opportunity", entityId: opportunityId, entityLabel: opp[0].title }, tx);
    });
    await this.dispatch(id);
    return this.get(auth.organizationId, id);
  }

  async cancel(auth: AuthContext, id: string): Promise<Workflow> {
    const row = await this.row(id, auth.organizationId);
    if (!ACTIVE.includes(row.status)) throw new ConflictException("Only queued or running workflows can be cancelled.");
    await this.db.transaction(async (tx) => {
      await tx.query("UPDATE workflows SET status = 'cancelled', updated_at = now() WHERE id = $1", [id]);
      await tx.query("UPDATE workflow_steps SET status = 'skipped' WHERE workflow_id = $1 AND status IN ('pending','running')", [id]);
      await tx.query("UPDATE opportunities SET status = $2, updated_at = now() WHERE id = $1", [row.opportunity_id, await this.restingStatus(tx, row.opportunity_id)]);
      await this.addEvent(tx, id, null, "warning", `Cancelled by ${auth.userName}`);
    });
    await this.orchestrator.cancel(id);
    return this.get(auth.organizationId, id);
  }

  async retry(auth: AuthContext, id: string): Promise<Workflow> {
    const row = await this.row(id, auth.organizationId);
    if (!["failed", "cancelled"].includes(row.status)) throw new ConflictException("Only failed or cancelled workflows can be retried.");
    await this.db.transaction(async (tx) => {
      const active = await tx.query("SELECT 1 FROM workflows WHERE opportunity_id = $1 AND status IN ('queued','running')", [row.opportunity_id]);
      if (active.length) throw new ConflictException("Another workflow is already running for this opportunity.");
      await tx.query("UPDATE workflows SET status = 'queued', error = NULL, dispatch_attempts = 0, updated_at = now() WHERE id = $1", [id]);
      await tx.query("UPDATE workflow_steps SET status = 'pending', error = NULL WHERE workflow_id = $1 AND status <> 'completed'", [id]);
      await tx.query("UPDATE opportunities SET status = 'processing', updated_at = now() WHERE id = $1", [row.opportunity_id]);
      await this.addEvent(tx, id, null, "info", `Retry requested by ${auth.userName}. Completed steps will be reused.`);
    });
    await this.dispatch(id);
    return this.get(auth.organizationId, id);
  }

  /** Where an opportunity rests when no workflow is active. */
  private async restingStatus(tx: Queryable, opportunityId: string): Promise<OpportunityStatus> {
    const proposal = await tx.query<{ status: string }>("SELECT status FROM proposals WHERE opportunity_id = $1", [opportunityId]);
    if (proposal[0]?.status === "approved") return "completed";
    if (proposal[0]) return "human_review";
    return "draft";
  }

  async dispatch(id: string): Promise<void> {
    try {
      await this.orchestrator.dispatch(id);
      await this.db.query("UPDATE workflows SET dispatch_attempts = dispatch_attempts + 1, updated_at = now() WHERE id = $1", [id]);
    } catch (error) {
      const rows = await this.db.query<{ dispatch_attempts: number; opportunity_id: string }>(
        "UPDATE workflows SET dispatch_attempts = dispatch_attempts + 1, updated_at = now() WHERE id = $1 RETURNING dispatch_attempts, opportunity_id",
        [id]
      );
      const attempts = Number(rows[0]?.dispatch_attempts ?? 0);
      this.logger.warn(`Dispatch of ${id} failed (attempt ${attempts}): ${(error as Error).message}`);
      if (attempts === 1) {
        await this.addEvent(this.db, id, null, "warning", "The AI orchestrator isn't reachable yet. We'll keep retrying automatically.");
      }
      if (attempts >= MAX_DISPATCH_ATTEMPTS) {
        await this.fail(id, "The AI orchestrator is unavailable. Start it and press Retry.");
      }
    }
  }

  private async fail(id: string, message: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = await tx.query<{ opportunity_id: string }>(
        "UPDATE workflows SET status = 'failed', error = $2, updated_at = now() WHERE id = $1 AND status IN ('queued','running') RETURNING opportunity_id",
        [id, message]
      );
      if (!rows[0]) return;
      await tx.query("UPDATE workflow_steps SET status = 'failed', error = COALESCE(error, $2) WHERE workflow_id = $1 AND status = 'running'", [id, message]);
      await tx.query("UPDATE opportunities SET status = 'failed', updated_at = now() WHERE id = $1", [rows[0].opportunity_id]);
      await this.addEvent(tx, id, null, "error", message);
    });
  }

  /**
   * Reconciles workflows after restarts: re-dispatches queued work and
   * running work whose orchestrator heartbeat went stale. The orchestrator
   * de-duplicates in-flight runs and skips completed steps, so re-dispatch
   * is idempotent.
   */
  async reconcile(): Promise<void> {
    const stale = await this.db.query<{ id: string }>(
      `SELECT id FROM workflows
       WHERE (status = 'queued' AND updated_at < now() - interval '20 seconds')
          OR (status = 'running' AND updated_at < now() - interval '4 minutes')
       ORDER BY created_at LIMIT 10`
    );
    for (const { id } of stale) await this.dispatch(id);
  }

  async addEvent(tx: Queryable, workflowId: string, step: string | null, level: WorkflowEvent["level"], message: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const rows = await tx.query(
        `INSERT INTO workflow_events (workflow_id, sequence, step, level, message, created_at)
         SELECT $1, COALESCE(MAX(sequence), 0) + 1, $2, $3, $4, now() FROM workflow_events WHERE workflow_id = $1
         ON CONFLICT DO NOTHING RETURNING sequence`,
        [workflowId, step, level, message.slice(0, 1000)]
      );
      if (rows.length) return;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal (orchestrator) API
  // ---------------------------------------------------------------------------

  async internalContext(id: string): Promise<InternalContext> {
    const row = await this.row(id);
    const opp = await this.db.query<{ id: string; title: string; client_name: string; context: string; deadline: Date | null; analysis: unknown; qualification: unknown }>(
      "SELECT * FROM opportunities WHERE id = $1",
      [row.opportunity_id]
    );
    const org = await this.db.query<{ name: string }>("SELECT name FROM organizations WHERE id = $1", [row.organization_id]);
    const completed: Record<string, unknown> = {};
    if (row.type === "revision" && row.source_workflow_id) {
      const sourceSteps = await this.db.query<{ step: string; output: unknown }>(
        "SELECT step, output FROM workflow_steps WHERE workflow_id = $1 AND status = 'completed' AND step IN ('retrieval','planning')",
        [row.source_workflow_id]
      );
      for (const s of sourceSteps) completed[s.step] = json(s.output, null);
      completed.analysis = json(opp[0].analysis, null);
      completed.qualification = json(opp[0].qualification, null);
    }
    const ownSteps = await this.db.query<{ step: string; output: unknown }>("SELECT step, output FROM workflow_steps WHERE workflow_id = $1 AND status = 'completed'", [id]);
    for (const s of ownSteps) completed[s.step] = json(s.output, null);

    let revision: InternalContext["revision"] = null;
    if (row.type === "revision") {
      const spec = json<{ sectionKeys: string[]; feedback: string }>(row.revision, { sectionKeys: [], feedback: "" });
      revision = { ...spec, currentSections: await this.proposals.currentWrittenSections(row.organization_id, row.opportunity_id) };
    }
    return {
      contractVersion: CONTRACT_VERSION,
      workflowId: id,
      workflowType: row.type,
      status: row.status,
      opportunity: {
        id: opp[0].id,
        title: opp[0].title,
        clientName: opp[0].client_name,
        context: opp[0].context,
        deadline: iso(opp[0].deadline)
      },
      organizationName: org[0]?.name ?? "Your company",
      pages: row.type === "revision" ? [] : await this.documents.pagesForOpportunity(row.organization_id, row.opportunity_id),
      completed,
      revision
    };
  }

  async internalStep(
    id: string,
    stepName: string,
    body: { status: "running" | "completed" | "failed"; output?: unknown; error?: string; usage?: { inputTokens: number; outputTokens: number; estimatedCostUsd: number }; mode?: "claude" | "openai" | "heuristic" }
  ): Promise<{ accepted: boolean }> {
    const step = workflowStepNameSchema.parse(stepName);
    const row = await this.row(id);
    if (!ACTIVE.includes(row.status)) return { accepted: false };

    // Validate outputs at the boundary before anything is persisted.
    let output: unknown = null;
    if (body.status === "completed") output = this.validateOutput(step, body.output);

    await this.db.transaction(async (tx) => {
      const usage = json(row.usage, { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 });
      if (body.usage) {
        usage.inputTokens += body.usage.inputTokens;
        usage.outputTokens += body.usage.outputTokens;
        usage.estimatedCostUsd = Math.round((usage.estimatedCostUsd + body.usage.estimatedCostUsd) * 10000) / 10000;
      }
      await tx.query(
        "UPDATE workflows SET status = 'running', current_step = $2, usage = $3, mode = COALESCE($4, mode), updated_at = now() WHERE id = $1",
        [id, step, usage, body.mode ?? null]
      );
      if (body.status === "running") {
        await tx.query("UPDATE workflow_steps SET status = 'running', attempts = attempts + 1, started_at = now(), error = NULL WHERE workflow_id = $1 AND step = $2", [id, step]);
        await tx.query("UPDATE opportunities SET status = $2, updated_at = now() WHERE id = $1", [row.opportunity_id, STEP_TO_OPPORTUNITY_STATUS[step]]);
      } else if (body.status === "failed") {
        await tx.query("UPDATE workflow_steps SET status = 'failed', error = $3 WHERE workflow_id = $1 AND step = $2", [id, step, body.error ?? "Step failed"]);
      } else {
        await tx.query("UPDATE workflow_steps SET status = 'completed', output = $3, completed_at = now(), error = NULL WHERE workflow_id = $1 AND step = $2", [id, step, output]);
        await this.applyStepOutput(tx, row, step, output);
      }
    });
    return { accepted: true };
  }

  private validateOutput(step: WorkflowStepName, output: unknown): unknown {
    switch (step) {
      case "analysis":
        return rfpAnalysisSchema.parse(output);
      case "qualification":
        return qualificationSchema.parse(output);
      case "retrieval":
        return retrievalOutputSchema.parse(output);
      case "planning":
        return z.object({ sections: z.array(z.any()) }).parse(output);
      case "writing":
        return writingOutputSchema.parse(output);
      case "validation":
        return validationOutputSchema.parse(output);
    }
  }

  private async applyStepOutput(tx: Queryable, row: WorkflowRow, step: WorkflowStepName, output: unknown): Promise<void> {
    if (step === "analysis") {
      await tx.query("UPDATE opportunities SET analysis = $2, updated_at = now() WHERE id = $1", [row.opportunity_id, output]);
    } else if (step === "qualification") {
      await tx.query("UPDATE opportunities SET qualification = $2, updated_at = now() WHERE id = $1", [row.opportunity_id, output as Qualification]);
    } else if (step === "writing") {
      const retrievalWorkflow = row.type === "revision" ? row.source_workflow_id! : row.id;
      const retrieval = await tx.query<{ output: unknown }>("SELECT output FROM workflow_steps WHERE workflow_id = $1 AND step = 'retrieval'", [retrievalWorkflow]);
      const evidence = json<RetrievalOutput | null>(retrieval[0]?.output, null)?.evidence ?? [];
      await this.proposals.applyWriting(tx, row.organization_id, row.opportunity_id, writingOutputSchema.parse(output), evidence, row.type === "revision");
    } else if (step === "validation") {
      const result = validationOutputSchema.parse(output);
      await this.proposals.applyValidation(tx, row.organization_id, row.opportunity_id, result);
      const opp = await tx.query<{ analysis: unknown }>("SELECT analysis FROM opportunities WHERE id = $1", [row.opportunity_id]);
      const analysis = json<RfpAnalysis | null>(opp[0]?.analysis, null);
      if (analysis) {
        const byId = new Map(result.items.map((item) => [item.requirementId, item.status]));
        for (const requirement of analysis.requirements) {
          if (requirement.status === "not_applicable") continue;
          requirement.status = byId.get(requirement.id) ?? requirement.status;
        }
        await tx.query("UPDATE opportunities SET analysis = $2 WHERE id = $1", [row.opportunity_id, analysis]);
      }
    }
  }

  async internalFinish(id: string, body: { status: "waiting_review" | "failed"; error?: string }): Promise<{ accepted: boolean }> {
    const row = await this.row(id);
    if (!ACTIVE.includes(row.status)) return { accepted: false };
    if (body.status === "failed") {
      await this.fail(id, body.error ?? "The workflow failed.");
      return { accepted: true };
    }
    await this.db.transaction(async (tx) => {
      await tx.query("UPDATE workflows SET status = 'waiting_review', current_step = NULL, updated_at = now() WHERE id = $1", [id]);
      await tx.query("UPDATE opportunities SET status = 'human_review', updated_at = now() WHERE id = $1", [row.opportunity_id]);
      await this.addEvent(tx, id, null, "success", "Draft ready for human review");
    });
    return { accepted: true };
  }

  async internalSearch(id: string, query: string, limit: number) {
    const row = await this.row(id);
    return this.knowledge.search(row.organization_id, query, Math.min(Math.max(limit, 1), 10));
  }

  async internalEvent(id: string, body: { step?: string | null; level?: WorkflowEvent["level"]; message: string }): Promise<{ accepted: boolean }> {
    const row = await this.row(id);
    if (!ACTIVE.includes(row.status)) return { accepted: false };
    await this.addEvent(this.db, id, body.step ?? null, body.level ?? "info", String(body.message ?? ""));
    await this.db.query("UPDATE workflows SET updated_at = now() WHERE id = $1", [id]);
    return { accepted: true };
  }
}

@Controller()
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get("workflows/:id")
  get(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Query("after") after?: string) {
    return this.workflows.get(auth.organizationId, id, Number(after ?? 0) || 0);
  }

  @Post("workflows/:id/cancel")
  @RequirePermission("editProposal")
  cancel(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.workflows.cancel(auth, id);
  }

  @Post("workflows/:id/retry")
  @RequirePermission("editProposal")
  retry(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.workflows.retry(auth, id);
  }

  @Post("opportunities/:id/revise")
  @RequirePermission("editProposal")
  revise(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = reviseSchema.parse(body);
    return this.workflows.startRevision(auth, id, input.sectionIds, input.feedback);
  }
}

/** Service-to-service endpoints used by the AI orchestrator. */
@Public()
@UseGuards(InternalGuard)
@Controller("internal/workflows")
export class InternalWorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get(":id/context")
  context(@Param("id", ParseUUIDPipe) id: string) {
    return this.workflows.internalContext(id);
  }

  @Post(":id/steps/:step")
  @HttpCode(200)
  step(@Param("id", ParseUUIDPipe) id: string, @Param("step") step: string, @Body() body: Parameters<WorkflowsService["internalStep"]>[2]) {
    return this.workflows.internalStep(id, step, body);
  }

  @Post(":id/events")
  @HttpCode(200)
  event(@Param("id", ParseUUIDPipe) id: string, @Body() body: { step?: string; level?: WorkflowEvent["level"]; message: string }) {
    return this.workflows.internalEvent(id, body);
  }

  @Post(":id/search")
  @HttpCode(200)
  search(@Param("id", ParseUUIDPipe) id: string, @Body() body: { query: string; limit?: number }) {
    return this.workflows.internalSearch(id, String(body?.query ?? ""), Number(body?.limit ?? 5));
  }

  @Post(":id/finish")
  @HttpCode(200)
  finish(@Param("id", ParseUUIDPipe) id: string, @Body() body: { status: "waiting_review" | "failed"; error?: string }) {
    return this.workflows.internalFinish(id, body);
  }
}
