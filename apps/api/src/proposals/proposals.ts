import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res
} from "@nestjs/common";
import {
  computeCoverage,
  createReviewSchema,
  updateSectionSchema,
  type Claim,
  type ComplianceReport,
  type Evidence,
  type Proposal,
  type ProposalSection,
  type ProposalStatus,
  type Review,
  type RfpAnalysis,
  type ValidationOutput,
  type WritingOutput,
  type WrittenSection
} from "@bidpilot/contracts";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { Auth, AuthContext, RequirePermission } from "../auth/auth";
import { AuditService, canonicalJson, sha256, StorageService } from "../core/common";
import { DatabaseService, iso, isoRequired, json, Queryable } from "../core/database.service";
import { ApprovedSnapshot, PDF_TEMPLATE_VERSION, renderProposalPdf } from "./pdf";

type ProposalRow = {
  id: string;
  organization_id: string;
  opportunity_id: string;
  version: number;
  status: ProposalStatus;
  compliance: unknown;
  evidence: unknown;
  approved_checksum: string | null;
  updated_at: Date;
};

type SectionRow = {
  id: string;
  key: string;
  title: string;
  writer: "technical" | "management";
  position: number;
  content: string;
  requirement_ids: unknown;
  evidence_ids: unknown;
  claims: unknown;
  status: ProposalSection["status"];
  version: number;
  edited_by_human: boolean;
  updated_at: Date;
};

function mapSection(row: SectionRow): ProposalSection {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    writer: row.writer,
    position: Number(row.position),
    content: row.content,
    requirementIds: json<string[]>(row.requirement_ids, []),
    evidenceIds: json<string[]>(row.evidence_ids, []),
    claims: json<Claim[]>(row.claims, []),
    status: row.status,
    version: Number(row.version),
    editedByHuman: Boolean(row.edited_by_human),
    updatedAt: isoRequired(row.updated_at)
  };
}

@Injectable()
export class ProposalsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: StorageService
  ) {}

  private async proposalRow(organizationId: string, opportunityId: string, tx: Queryable = this.db): Promise<ProposalRow | null> {
    const rows = await tx.query<ProposalRow>("SELECT * FROM proposals WHERE opportunity_id = $1 AND organization_id = $2", [opportunityId, organizationId]);
    return rows[0] ?? null;
  }

  private async sections(proposalId: string, tx: Queryable = this.db): Promise<ProposalSection[]> {
    return (await tx.query<SectionRow>("SELECT * FROM proposal_sections WHERE proposal_id = $1 ORDER BY position", [proposalId])).map(mapSection);
  }

  async get(organizationId: string, opportunityId: string): Promise<Proposal | null> {
    const row = await this.proposalRow(organizationId, opportunityId);
    if (!row) return null;
    const reviews = await this.db.query<{
      id: string; proposal_version: number; decision: Review["decision"]; rationale: string; reviewer_role: Review["reviewerRole"]; checksum: string | null; created_at: Date; name: string;
    }>(
      `SELECT r.*, u.name FROM reviews r JOIN users u ON u.id = r.reviewer_id WHERE r.proposal_id = $1 ORDER BY r.created_at DESC`,
      [row.id]
    );
    return {
      id: row.id,
      opportunityId: row.opportunity_id,
      version: Number(row.version),
      status: row.status,
      sections: await this.sections(row.id),
      compliance: json<ComplianceReport | null>(row.compliance, null),
      evidence: json<Evidence[]>(row.evidence, []),
      reviews: reviews.map((r) => ({
        id: r.id,
        proposalVersion: Number(r.proposal_version),
        decision: r.decision,
        rationale: r.rationale,
        reviewerName: r.name,
        reviewerRole: r.reviewer_role,
        checksum: r.checksum,
        createdAt: isoRequired(r.created_at)
      })),
      approvedChecksum: row.approved_checksum,
      updatedAt: isoRequired(row.updated_at)
    };
  }

  async currentWrittenSections(organizationId: string, opportunityId: string): Promise<WrittenSection[]> {
    const row = await this.proposalRow(organizationId, opportunityId);
    if (!row) return [];
    return (await this.sections(row.id)).map((s) => ({
      key: s.key,
      title: s.title,
      writer: s.writer,
      content: s.content,
      requirementIds: s.requirementIds,
      evidenceIds: s.evidenceIds,
      claims: s.claims.map((c) => ({ text: c.text, evidenceIds: c.evidenceIds }))
    }));
  }

  /** Persist writer output. Full runs replace the section set; revisions update only the sections they rewrote. */
  async applyWriting(tx: Queryable, organizationId: string, opportunityId: string, output: WritingOutput, evidence: Evidence[], isRevision: boolean): Promise<void> {
    let proposal = await this.proposalRow(organizationId, opportunityId, tx);
    if (!proposal) {
      const id = randomUUID();
      await tx.query(
        "INSERT INTO proposals (id, organization_id, opportunity_id, version, status, evidence, created_at, updated_at) VALUES ($1,$2,$3,0,'draft',$4,now(),now())",
        [id, organizationId, opportunityId, evidence]
      );
      proposal = (await this.proposalRow(organizationId, opportunityId, tx))!;
    }
    const existing = new Map((await this.sections(proposal.id, tx)).map((s) => [s.key, s]));
    const knownEvidence = new Set(evidence.map((e) => e.id));

    for (const [position, section] of output.sections.entries()) {
      const claims: Claim[] = section.claims.map((claim) => ({
        id: randomUUID(),
        text: claim.text,
        evidenceIds: claim.evidenceIds.filter((id) => knownEvidence.has(id)),
        verificationStatus: "needs_confirmation",
        note: null
      }));
      const evidenceIds = section.evidenceIds.filter((id) => knownEvidence.has(id));
      const current = existing.get(section.key);
      if (current) {
        await tx.query(
          `UPDATE proposal_sections SET title = $2, writer = $3, content = $4, requirement_ids = $5, evidence_ids = $6, claims = $7,
             status = 'draft', version = version + 1, edited_by_human = false, updated_at = now() ${isRevision ? "" : ", position = $8"}
           WHERE id = $1`,
          isRevision
            ? [current.id, section.title, section.writer, section.content, section.requirementIds, evidenceIds, claims]
            : [current.id, section.title, section.writer, section.content, section.requirementIds, evidenceIds, claims, position]
        );
      } else {
        await tx.query(
          `INSERT INTO proposal_sections (id, organization_id, proposal_id, key, title, writer, position, content, requirement_ids, evidence_ids, claims, status, version, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',1,now())`,
          [randomUUID(), organizationId, proposal.id, section.key, section.title, section.writer, position, section.content, section.requirementIds, evidenceIds, claims]
        );
      }
    }
    if (!isRevision) {
      const keep = output.sections.map((s) => s.key);
      for (const [key, section] of existing) if (!keep.includes(key)) await tx.query("DELETE FROM proposal_sections WHERE id = $1", [section.id]);
    }
    await tx.query(
      `UPDATE proposals SET version = version + 1, status = 'draft', approved_checksum = NULL, updated_at = now()
         ${isRevision ? "" : ", evidence = $2, compliance = NULL"} WHERE id = $1`,
      isRevision ? [proposal.id] : [proposal.id, evidence]
    );
  }

  async applyValidation(tx: Queryable, organizationId: string, opportunityId: string, result: ValidationOutput): Promise<void> {
    const proposal = await this.proposalRow(organizationId, opportunityId, tx);
    if (!proposal) return;
    const sections = await this.sections(proposal.id, tx);
    const keyToId = new Map(sections.map((s) => [s.key, s.id]));
    const statusByRequirement = new Map(result.items.map((i) => [i.requirementId, i.status]));

    for (const section of sections) {
      const claims = section.claims.map((claim, index) => {
        const verdict = result.claims.find((c) => c.sectionKey === section.key && c.claimIndex === index);
        return verdict ? { ...claim, verificationStatus: verdict.status, note: verdict.note } : claim;
      });
      const claimsOk = claims.every((c) => c.verificationStatus === "supported");
      const requirementsOk = section.requirementIds.every((id) => ["addressed", "not_applicable", undefined].includes(statusByRequirement.get(id)));
      await tx.query("UPDATE proposal_sections SET claims = $2, status = $3 WHERE id = $1", [section.id, claims, claimsOk && requirementsOk ? "validated" : "needs_revision"]);
    }

    const opp = await tx.query<{ analysis: unknown }>("SELECT analysis FROM opportunities WHERE id = $1", [opportunityId]);
    const analysis = json<RfpAnalysis | null>(opp[0]?.analysis, null);
    const mandatory = new Set((analysis?.requirements ?? []).filter((r) => r.mandatory && r.status !== "not_applicable").map((r) => r.id));
    const items = result.items.map((item) => ({
      ...item,
      sectionIds: item.sectionIds.map((key) => keyToId.get(key)).filter((id): id is string => Boolean(id))
    }));
    const refreshed = await this.sections(proposal.id, tx);
    const report: ComplianceReport = {
      coverage: computeCoverage(items),
      mandatoryGaps: items.filter((i) => mandatory.has(i.requirementId) && (i.status === "unaddressed" || i.status === "needs_clarification")).length,
      unsupportedClaims: refreshed.flatMap((s) => s.claims).filter((c) => c.verificationStatus !== "supported").length,
      items,
      checkedAt: new Date().toISOString()
    };
    await tx.query("UPDATE proposals SET compliance = $2, updated_at = now() WHERE id = $1", [proposal.id, report]);
  }

  async updateSection(auth: AuthContext, opportunityId: string, sectionId: string, content: string): Promise<ProposalSection> {
    return this.db.transaction(async (tx) => {
      const proposal = await this.proposalRow(auth.organizationId, opportunityId, tx);
      if (!proposal) throw new NotFoundException("Proposal not found");
      const rows = await tx.query<SectionRow>("SELECT * FROM proposal_sections WHERE id = $1 AND proposal_id = $2", [sectionId, proposal.id]);
      if (!rows[0]) throw new NotFoundException("Section not found");
      const section = mapSection(rows[0]);
      if (section.content === content) return section;
      // Claims whose wording no longer appears need re-verification.
      const claims = section.claims
        .filter((claim) => content.includes(claim.text.slice(0, Math.min(40, claim.text.length))))
        .map((claim) => claim);
      const updated = await tx.query<SectionRow>(
        `UPDATE proposal_sections SET content = $2, claims = $3, status = 'draft', version = version + 1, edited_by_human = true, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [sectionId, content, claims]
      );
      // Any edit invalidates a prior approval and creates a new proposal version.
      await tx.query("UPDATE proposals SET version = version + 1, status = 'draft', approved_checksum = NULL, updated_at = now() WHERE id = $1", [proposal.id]);
      if (proposal.status === "approved") await tx.query("UPDATE opportunities SET status = 'human_review', updated_at = now() WHERE id = $1", [opportunityId]);
      await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: "section.edited", entityType: "proposal_section", entityId: sectionId, entityLabel: section.title, data: { version: section.version + 1 } }, tx);
      return mapSection(updated[0]);
    });
  }

  async submitForReview(auth: AuthContext, opportunityId: string): Promise<Proposal> {
    const proposal = await this.proposalRow(auth.organizationId, opportunityId);
    if (!proposal) throw new NotFoundException("Proposal not found");
    if (proposal.status !== "draft" && proposal.status !== "rejected") throw new ConflictException("This proposal is already in review or approved.");
    if (!json(proposal.compliance, null)) throw new BadRequestException("Validation hasn't run on this version yet.");
    await this.db.query("UPDATE proposals SET status = 'in_review', updated_at = now() WHERE id = $1", [proposal.id]);
    await this.db.query("UPDATE opportunities SET status = 'human_review', updated_at = now() WHERE id = $1", [opportunityId]);
    await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: "proposal.submitted", entityType: "proposal", entityId: proposal.id, data: { version: proposal.version } });
    return (await this.get(auth.organizationId, opportunityId))!;
  }

  async review(auth: AuthContext, opportunityId: string, decision: Review["decision"], rationale: string): Promise<Proposal> {
    await this.db.transaction(async (tx) => {
      const proposal = await this.proposalRow(auth.organizationId, opportunityId, tx);
      if (!proposal) throw new NotFoundException("Proposal not found");
      if (proposal.status !== "in_review") throw new ConflictException("Submit the proposal for review first.");
      const active = await tx.query("SELECT 1 FROM workflows WHERE opportunity_id = $1 AND status IN ('queued','running')", [opportunityId]);
      if (active.length) throw new ConflictException("Wait for the running workflow to finish before reviewing.");
      const compliance = json<ComplianceReport | null>(proposal.compliance, null);
      if (decision !== "approve" && rationale.trim().length < 3) throw new BadRequestException("Tell the team what needs to change.");
      if (decision === "approve" && compliance && (compliance.mandatoryGaps > 0 || compliance.unsupportedClaims > 0) && rationale.trim().length < 10) {
        throw new BadRequestException("This version still has open gaps or unverified claims. Add a rationale (10+ characters) to approve anyway.");
      }

      let checksum: string | null = null;
      let snapshot: ApprovedSnapshot | null = null;
      if (decision === "approve") {
        const opp = await tx.query<{ title: string; client_name: string; deadline: Date | null }>("SELECT title, client_name, deadline FROM opportunities WHERE id = $1", [opportunityId]);
        const org = await tx.query<{ name: string }>("SELECT name FROM organizations WHERE id = $1", [auth.organizationId]);
        const sections = await this.sections(proposal.id, tx);
        snapshot = {
          proposalVersion: Number(proposal.version),
          organizationName: org[0].name,
          opportunity: { title: opp[0].title, clientName: opp[0].client_name, deadline: iso(opp[0].deadline) },
          sections: sections.map((s) => ({ title: s.title, content: s.content })),
          evidence: json<Evidence[]>(proposal.evidence, []),
          approvedBy: auth.userName,
          approvedAt: new Date().toISOString()
        };
        checksum = sha256(canonicalJson(snapshot));
        await tx.query("UPDATE proposal_sections SET status = 'approved' WHERE proposal_id = $1", [proposal.id]);
      }
      const nextStatus: ProposalStatus = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "draft";
      await tx.query(
        `INSERT INTO reviews (id, organization_id, proposal_id, proposal_version, decision, rationale, reviewer_id, reviewer_role, checksum, snapshot, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`,
        [randomUUID(), auth.organizationId, proposal.id, proposal.version, decision, rationale.trim(), auth.userId, auth.role, checksum, snapshot]
      );
      await tx.query("UPDATE proposals SET status = $2, approved_checksum = $3, updated_at = now() WHERE id = $1", [proposal.id, nextStatus, checksum]);
      await tx.query("UPDATE opportunities SET status = $2, updated_at = now() WHERE id = $1", [opportunityId, decision === "approve" ? "completed" : "human_review"]);
      await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: `proposal.${decision}`, entityType: "proposal", entityId: proposal.id, entityLabel: snapshot?.opportunity.title ?? null, data: { version: proposal.version, rationale, checksum } }, tx);
    });
    return (await this.get(auth.organizationId, opportunityId))!;
  }

  /** Render (or reuse) the PDF for the approved version only. Idempotent per approval. */
  async exportPdf(auth: AuthContext, opportunityId: string): Promise<{ bytes: Buffer; filename: string }> {
    const proposal = await this.proposalRow(auth.organizationId, opportunityId);
    if (!proposal) throw new NotFoundException("Proposal not found");
    if (proposal.status !== "approved" || !proposal.approved_checksum) throw new ConflictException("Only an approved proposal version can be exported.");
    const reviews = await this.db.query<{ id: string; snapshot: unknown; checksum: string }>(
      "SELECT id, snapshot, checksum FROM reviews WHERE proposal_id = $1 AND decision = 'approve' AND proposal_version = $2 AND checksum = $3 ORDER BY created_at DESC LIMIT 1",
      [proposal.id, proposal.version, proposal.approved_checksum]
    );
    const review = reviews[0];
    if (!review) throw new ConflictException("No approval record matches this version.");
    const snapshot = json<ApprovedSnapshot>(review.snapshot, null as unknown as ApprovedSnapshot);
    if (sha256(canonicalJson(snapshot)) !== review.checksum) throw new ConflictException("Approved snapshot failed its integrity check.");

    const filename = `${snapshot.opportunity.title.replace(/[^\w-]+/g, "_").slice(0, 60)}_v${snapshot.proposalVersion}.pdf`;
    const existing = await this.db.query<{ storage_key: string }>("SELECT storage_key FROM exports WHERE review_id = $1", [review.id]);
    if (existing[0]) return { bytes: await this.storage.get(existing[0].storage_key), filename };

    const { bytes, pageCount } = await renderProposalPdf(snapshot, review.checksum);
    if (pageCount < 2 || bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("PDF rendering produced an invalid document");
    const stored = await this.storage.put(auth.organizationId, bytes, ".pdf");
    await this.db.query(
      "INSERT INTO exports (id, organization_id, review_id, storage_key, sha256, page_count, template_version, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT (review_id) DO NOTHING",
      [randomUUID(), auth.organizationId, review.id, stored.key, stored.sha256, pageCount, PDF_TEMPLATE_VERSION]
    );
    await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: "proposal.exported", entityType: "proposal", entityId: proposal.id, entityLabel: snapshot.opportunity.title, data: { pageCount, sha256: stored.sha256 } });
    return { bytes, filename };
  }
}

@Controller("opportunities/:id/proposal")
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get()
  async get(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return (await this.proposals.get(auth.organizationId, id)) ?? { empty: true };
  }

  @Patch("sections/:sectionId")
  @RequirePermission("editProposal")
  updateSection(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Param("sectionId", ParseUUIDPipe) sectionId: string, @Body() body: unknown) {
    return this.proposals.updateSection(auth, id, sectionId, updateSectionSchema.parse(body).content);
  }

  @Post("submit")
  @RequirePermission("editProposal")
  submit(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.proposals.submitForReview(auth, id);
  }

  @Post("reviews")
  @RequirePermission("review")
  review(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = createReviewSchema.parse(body);
    return this.proposals.review(auth, id, input.decision, input.rationale);
  }

  @Get("export.pdf")
  async export(@Auth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Res() response: Response) {
    const { bytes, filename } = await this.proposals.exportPdf(auth, id);
    response.setHeader("content-type", "application/pdf");
    response.setHeader("content-disposition", `attachment; filename="${filename}"`);
    response.send(bytes);
  }
}
