import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post
} from "@nestjs/common";
import {
  confirmDeadlineSchema,
  createOpportunitySchema,
  qualificationOverrideSchema,
  updateOpportunitySchema,
  updateRequirementSchema,
  type CreateOpportunity,
  type Opportunity,
  type OpportunityDetail,
  type OpportunitySummary,
  type ProposalStatus,
  type Qualification,
  type RfpAnalysis,
  type UpdateOpportunity
} from "@bidpilot/contracts";
import { randomUUID } from "node:crypto";
import { Auth, AuthContext, RequirePermission } from "../auth/auth";
import { AuditService } from "../core/common";
import { DatabaseService, iso, isoRequired, json, Queryable } from "../core/database.service";
import { DocumentsService } from "../documents/documents";
import { WorkflowsService } from "../workflows/workflows";

type OpportunityRow = {
  id: string;
  organization_id: string;
  client_name: string;
  title: string;
  deadline: Date | null;
  context: string;
  status: Opportunity["status"];
  analysis: unknown;
  qualification: unknown;
  created_at: Date;
  updated_at: Date;
};

export function mapOpportunity(row: OpportunityRow): Opportunity {
  return {
    id: row.id,
    organizationId: row.organization_id,
    clientName: row.client_name,
    title: row.title,
    deadline: iso(row.deadline),
    context: row.context,
    status: row.status,
    createdAt: isoRequired(row.created_at),
    updatedAt: isoRequired(row.updated_at)
  };
}

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly workflows: WorkflowsService
  ) {}

  async list(organizationId: string): Promise<OpportunitySummary[]> {
    const rows = await this.db.query<OpportunityRow & { document_count: number; proposal_status: ProposalStatus | null; compliance: unknown }>(
      `SELECT o.*, p.status AS proposal_status, p.compliance,
         (SELECT count(*)::int FROM documents d WHERE d.opportunity_id = o.id) AS document_count
       FROM opportunities o LEFT JOIN proposals p ON p.opportunity_id = o.id
       WHERE o.organization_id = $1 ORDER BY o.updated_at DESC`,
      [organizationId]
    );
    return rows.map((row) => {
      const analysis = json<RfpAnalysis | null>(row.analysis, null);
      const qualification = json<Qualification | null>(row.qualification, null);
      const compliance = json<{ coverage: number } | null>(row.compliance, null);
      return {
        ...mapOpportunity(row),
        documentCount: Number(row.document_count),
        requirementCount: analysis?.requirements.length ?? 0,
        proposalStatus: row.proposal_status,
        coverage: compliance?.coverage ?? null,
        recommendation: qualification ? qualification.override?.recommendation ?? qualification.recommendation : null
      };
    });
  }

  async row(organizationId: string, id: string, tx: Queryable = this.db): Promise<OpportunityRow> {
    const rows = await tx.query<OpportunityRow>("SELECT * FROM opportunities WHERE id = $1 AND organization_id = $2", [id, organizationId]);
    if (!rows[0]) throw new NotFoundException("Opportunity not found");
    return rows[0];
  }

  async detail(organizationId: string, id: string): Promise<OpportunityDetail> {
    const row = await this.row(organizationId, id);
    const proposal = await this.db.query<{ status: ProposalStatus; compliance: unknown }>(
      "SELECT status, compliance FROM proposals WHERE opportunity_id = $1 AND organization_id = $2",
      [id, organizationId]
    );
    return {
      ...mapOpportunity(row),
      documents: await this.documents.list(organizationId, id),
      analysis: json<RfpAnalysis | null>(row.analysis, null),
      qualification: json<Qualification | null>(row.qualification, null),
      latestWorkflow: await this.workflows.latest(organizationId, id),
      proposalStatus: proposal[0]?.status ?? null,
      coverage: json<{ coverage: number } | null>(proposal[0]?.compliance, null)?.coverage ?? null
    };
  }

  async create(auth: AuthContext, input: CreateOpportunity): Promise<Opportunity> {
    const id = randomUUID();
    const rows = await this.db.query<OpportunityRow>(
      `INSERT INTO opportunities (id, organization_id, client_name, title, deadline, context, status, owner_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,now(),now()) RETURNING *`,
      [id, auth.organizationId, input.clientName, input.title, input.deadline ?? null, input.context ?? "", auth.userId]
    );
    await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: "opportunity.created", entityType: "opportunity", entityId: id, entityLabel: input.title });
    return mapOpportunity(rows[0]);
  }

  async update(auth: AuthContext, id: string, input: UpdateOpportunity): Promise<Opportunity> {
    const current = mapOpportunity(await this.row(auth.organizationId, id));
    const rows = await this.db.query<OpportunityRow>(
      `UPDATE opportunities SET client_name = $3, title = $4, deadline = $5, context = $6, updated_at = now()
       WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [
        id,
        auth.organizationId,
        input.clientName ?? current.clientName,
        input.title ?? current.title,
        input.deadline === undefined ? current.deadline : input.deadline,
        input.context === undefined ? current.context : input.context
      ]
    );
    return mapOpportunity(rows[0]);
  }

  async remove(auth: AuthContext, id: string): Promise<void> {
    const rows = await this.db.query<{ title: string }>("DELETE FROM opportunities WHERE id = $1 AND organization_id = $2 RETURNING title", [id, auth.organizationId]);
    if (!rows[0]) throw new NotFoundException("Opportunity not found");
    await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: "opportunity.deleted", entityType: "opportunity", entityId: id, entityLabel: rows[0].title });
  }

  private async mutateAnalysis(auth: AuthContext, id: string, mutate: (analysis: RfpAnalysis) => string): Promise<RfpAnalysis> {
    return this.db.transaction(async (tx) => {
      const row = await this.row(auth.organizationId, id, tx);
      const analysis = json<RfpAnalysis | null>(row.analysis, null);
      if (!analysis) throw new NotFoundException("Run an analysis first.");
      const label = mutate(analysis);
      await tx.query("UPDATE opportunities SET analysis = $3, updated_at = now() WHERE id = $1 AND organization_id = $2", [id, auth.organizationId, analysis]);
      await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: label, entityType: "opportunity", entityId: id, entityLabel: row.title }, tx);
      return analysis;
    });
  }

  updateRequirement(auth: AuthContext, id: string, requirementId: string, status: RfpAnalysis["requirements"][number]["status"]) {
    return this.mutateAnalysis(auth, id, (analysis) => {
      const requirement = analysis.requirements.find((r) => r.id === requirementId);
      if (!requirement) throw new NotFoundException("Requirement not found");
      requirement.status = status;
      return `requirement.${status}`;
    });
  }

  confirmDeadline(auth: AuthContext, id: string, deadlineId: string, date: string) {
    return this.mutateAnalysis(auth, id, (analysis) => {
      const deadline = analysis.deadlines.find((d) => d.id === deadlineId);
      if (!deadline) throw new NotFoundException("Deadline not found");
      deadline.date = date;
      deadline.confirmed = true;
      return "deadline.confirmed";
    });
  }

  async overrideQualification(auth: AuthContext, id: string, recommendation: Qualification["recommendation"], reason: string): Promise<Qualification> {
    return this.db.transaction(async (tx) => {
      const row = await this.row(auth.organizationId, id, tx);
      const qualification = json<Qualification | null>(row.qualification, null);
      if (!qualification) throw new NotFoundException("Qualification has not run yet.");
      qualification.override = { recommendation, reason, actorName: auth.userName, at: new Date().toISOString() };
      await tx.query("UPDATE opportunities SET qualification = $3, updated_at = now() WHERE id = $1 AND organization_id = $2", [id, auth.organizationId, qualification]);
      await this.audit.log(
        { organizationId: auth.organizationId, actorId: auth.userId, action: "qualification.overridden", entityType: "opportunity", entityId: id, entityLabel: row.title, data: { from: qualification.recommendation, to: recommendation, reason } },
        tx
      );
      return qualification;
    });
  }
}

@Controller("opportunities")
export class OpportunitiesController {
  constructor(private readonly service: OpportunitiesService, private readonly workflows: WorkflowsService) {}

  @Get()
  list(@Auth() auth: AuthContext) {
    return this.service.list(auth.organizationId);
  }

  @Get(":id")
  get(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.detail(auth.organizationId, id);
  }

  @Post()
  @RequirePermission("manageOpportunities")
  create(@Auth() auth: AuthContext, @Body() body: unknown) {
    return this.service.create(auth, createOpportunitySchema.parse(body));
  }

  @Patch(":id")
  @RequirePermission("manageOpportunities")
  update(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.update(auth, id, updateOpportunitySchema.parse(body));
  }

  @Delete(":id")
  @RequirePermission("manageOpportunities")
  async remove(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.service.remove(auth, id);
  }

  @Post(":id/analyze")
  @RequirePermission("editProposal")
  analyze(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.workflows.startAnalysis(auth, id);
  }

  @Patch(":id/requirements/:requirementId")
  @RequirePermission("editProposal")
  updateRequirement(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Param("requirementId") requirementId: string, @Body() body: unknown) {
    return this.service.updateRequirement(auth, id, requirementId, updateRequirementSchema.parse(body).status);
  }

  @Post(":id/deadlines/:deadlineId/confirm")
  @RequirePermission("manageOpportunities")
  confirmDeadline(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Param("deadlineId") deadlineId: string, @Body() body: unknown) {
    return this.service.confirmDeadline(auth, id, deadlineId, confirmDeadlineSchema.parse(body).date);
  }

  @Post(":id/qualification/override")
  @RequirePermission("overrideQualification")
  override(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = qualificationOverrideSchema.parse(body);
    return this.service.overrideQualification(auth, id, input.recommendation, input.reason);
  }
}
