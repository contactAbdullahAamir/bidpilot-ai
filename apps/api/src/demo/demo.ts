import { Controller, Get, HttpCode, NotFoundException, Post, Res } from "@nestjs/common";
import type { Dashboard, KnowledgeKind } from "@bidpilot/contracts";
import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { Auth, AuthContext, AuthService, DEMO_EMAIL_DOMAIN, hashPassword, Public, RequirePermission } from "../auth/auth";
import { setSessionCookie } from "../auth/auth.controller";
import { RateLimit } from "../core/security";
import { AuditService, StorageService } from "../core/common";
import { DatabaseService, isoRequired } from "../core/database.service";
import { splitIntoPages } from "../documents/parser";
import { KnowledgeService } from "../knowledge/knowledge";
import { OpportunitiesService } from "../opportunities/opportunities";
import { OrchestratorClient } from "../workflows/orchestrator.client";
import { WorkflowsService } from "../workflows/workflows";


/**
 * Fully synthetic demo scenario from the blueprint: fictional CivicWorks
 * Department RFP and fictional responder Northstar Digital Solutions, which
 * intentionally lacks one requested certification (SOC 2 Type II).
 */
export const DEMO_RFP_TITLE = "City Services Portal Modernization";

export const DEMO_RFP_TEXT = [
  `CIVICWORKS DEPARTMENT - REQUEST FOR PROPOSALS
RFP No. CW-2027-014: City Services Portal Modernization
(SYNTHETIC DEMO DOCUMENT - fictional agency and requirements)

1. Background
The CivicWorks Department operates a legacy resident services website built in 2009. Residents cannot track requests, the site is not mobile friendly, and staff re-key data into the department's CRM. CivicWorks seeks a qualified vendor to design, build, host and support a modern City Services Portal.

2. Schedule of Events
Pre-proposal conference: January 8, 2027 at 10:00 AM (virtual).
Written questions due: January 15, 2027.
Proposals due on or about February 12, 2027 at 2:00 PM local time. The Department may adjust this date as needed.
Anticipated contract award: March 2027.`,
  `3. Mandatory Eligibility Requirements
Proposals that fail any mandatory requirement will be deemed non-responsive.
M-1. The vendor must have at least five (5) years of experience delivering digital services for public-sector clients.
M-2. The vendor must hold a current SOC 2 Type II report covering the proposed hosting and support services.
M-3. The vendor must hold a current ISO/IEC 27001 certification.
M-4. The vendor must maintain professional liability insurance of at least $2,000,000 per occurrence.
M-5. The proposed project manager must hold a current PMP certification.`,
  `4. Functional Requirements
F-1. The portal shall allow residents to submit service requests online 24 hours a day, 7 days a week.
F-2. The portal shall support English and Spanish for all resident-facing content.
F-3. The portal shall provide request status tracking with notifications by email and SMS.
F-4. The portal must conform to WCAG 2.1 Level AA accessibility guidelines.
F-5. The solution shall provide a staff dashboard for triaging, assigning and reporting on requests.`,
  `5. Technical and Security Requirements
T-1. The solution must integrate with the Department's existing Salesforce-based CRM using REST APIs.
T-2. The solution shall be hosted in a FedRAMP-authorized cloud environment or equivalent.
T-3. The vendor shall guarantee 99.9% monthly availability for resident-facing services.
T-4. The solution must scale to support 50,000 concurrent users during peak events such as storms.
S-1. All data must be encrypted at rest using AES-256 and in transit using TLS 1.2 or higher.
S-2. Staff access must use single sign-on via SAML 2.0 with multi-factor authentication.
S-3. The vendor shall notify the Department of any security incident within 24 hours of discovery.`,
  `6. Delivery, Support and Commercial Terms
D-1. The vendor shall deliver a production-ready minimum viable portal within six (6) months of contract award.
D-2. The vendor shall provide training for Department staff and administrators.
D-3. The vendor shall provide twelve (12) months of post-launch support and maintenance.
C-1. Pricing shall be provided as fixed-fee milestones aligned to the delivery plan.
C-2. Invoices will be paid net 30 upon acceptance of each milestone.
Additional integrations with other City systems are TBD and may be requested as needed.`,
  `7. Evaluation Criteria
Proposals will be scored on the following criteria:
Technical approach and solution design - 35%
Relevant public-sector experience - 25%
Project management, staffing and delivery plan - 20%
Price - 20%

8. Submission Instructions
Proposals must be submitted electronically as a single PDF not exceeding 40 pages.
Proposals must include a signed Attachment A (Vendor Certification Form).
Late proposals will not be accepted.`
].join("\f");

const DEMO_KNOWLEDGE: { title: string; kind: KnowledgeKind; tags: string[]; approved: boolean; content: string }[] = [
  {
    title: "Case study: State DMV Online Services Portal",
    kind: "case_study",
    tags: ["public sector", "portal", "accessibility"],
    approved: true,
    content: `Client: State Department of Motor Vehicles (synthetic demo client). Delivered 2022.

Challenge
The DMV needed to move 30 paper and in-person transactions online for 1.2 million residents while meeting strict accessibility and uptime targets.

Solution
Northstar Digital Solutions designed and built a bilingual English and Spanish resident portal conforming to WCAG 2.1 Level AA, verified by an independent accessibility audit. The platform runs on Azure Government (FedRAMP High) and integrates with the DMV's Salesforce CRM through REST APIs and an event bus.

Results
The portal achieved 99.95% measured availability over its first 18 months. Online transaction adoption reached 64% within one year, and average in-person wait times fell by 38%.`
  },
  {
    title: "Case study: Riverside County 311 Modernization",
    kind: "case_study",
    tags: ["311", "service requests", "public sector"],
    approved: true,
    content: `Client: Riverside County (synthetic demo client). Delivered 2024.

Scope
Northstar replaced a legacy 311 system with a resident service request platform. Residents submit and track requests online 24/7 and receive status notifications by email and SMS.

Staff tools
County staff use a triage dashboard to assign, prioritize and report on requests, with saved views per department.

Delivery
The minimum viable product went live five months after contract award. Load testing validated 40,000 concurrent users, and the platform handled a winter storm surge without degradation. Northstar trained 220 county staff and provided 12 months of post-launch support.`
  },
  {
    title: "Technology and delivery profile",
    kind: "capability",
    tags: ["architecture", "cloud", "integration"],
    approved: true,
    content: `Cloud platforms
Northstar deploys public-sector workloads on AWS GovCloud and Azure Government, both FedRAMP High authorized environments. Infrastructure is defined as code and deployed through automated CI/CD pipelines.

Integration
We build REST and event-driven integrations with CRM platforms including Salesforce and Microsoft Dynamics, with contract tests for every integration.

Scalability and reliability
Every release is load tested against peak scenarios. Our standard architecture uses autoscaling container services, a managed PostgreSQL database and a CDN, with a 99.9% availability service level for production.

Identity
Staff applications support single sign-on through SAML 2.0 and OpenID Connect with enforced multi-factor authentication.`
  },
  {
    title: "Information security policy summary",
    kind: "policy",
    tags: ["security", "compliance"],
    approved: true,
    content: `Certifications
Northstar Digital Solutions has held ISO/IEC 27001 certification since 2019; the current certificate is valid through 2028. A SOC 2 Type II audit is planned for 2027; Northstar does not currently hold a SOC 2 Type II report.

Data protection
Customer data is encrypted at rest with AES-256 and in transit with TLS 1.2 or higher. Encryption keys are managed in cloud key management services with rotation.

Incident response
Northstar notifies affected customers of confirmed security incidents within 24 hours of discovery and provides a written root-cause report within 10 business days.`
  },
  {
    title: "Company and team capability statement",
    kind: "team",
    tags: ["company", "staffing", "insurance"],
    approved: true,
    content: `Company
Northstar Digital Solutions (fictional) was founded in 2014 and has delivered digital services for public-sector clients since 2016. The company employs 140 people across product, engineering, design and delivery.

Project management
All Northstar engagement leads hold a current PMP certification. Our delivery model uses two-week sprints, a published product roadmap and monthly steering committee reviews.

Insurance
Northstar maintains professional liability insurance of $5,000,000 per occurrence.

Training and support
Every engagement includes role-based training for staff and administrators, and a 12-month post-launch support period with a 24x7 on-call rotation.`
  },
  {
    title: "Pricing guidelines (draft)",
    kind: "other",
    tags: ["pricing"],
    approved: false,
    content: `Internal draft - not yet approved for proposal use.
Fixed-fee milestone pricing is preferred for public-sector portals. Typical milestone split: discovery 15%, MVP 45%, rollout 25%, hypercare 15%.`
  }
];

@Controller()
export class DemoController {
  constructor(
    private readonly db: DatabaseService,
    private readonly knowledge: KnowledgeService,
    private readonly opportunities: OpportunitiesService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly orchestrator: OrchestratorClient,
    private readonly workflows: WorkflowsService,
    private readonly auth: AuthService
  ) {}

  @Public()
  @Get("health")
  async health() {
    let database = "ok";
    try {
      await this.db.query("SELECT 1");
    } catch {
      database = "unavailable";
    }
    return { status: database === "ok" ? "ok" : "degraded", service: "api", database, databaseKind: this.db.kind, aiMode: (await this.orchestrator.mode()) ?? "unreachable" };
  }

  @Post("demo/seed")
  @RequirePermission("manageOpportunities")
  seed(@Auth() auth: AuthContext) {
    return this.seedWorkspace(auth);
  }

  /**
   * One-click live demo for visitors (portfolio / sales demos): creates a
   * private throwaway workspace, loads the sample RFP and knowledge, starts
   * the AI analysis and signs the visitor in. Disable with DEMO_ENABLED=false.
   */
  @Public()
  @Post("demo/start")
  @HttpCode(200)
  @RateLimit({ name: "demo-start", limit: 5, windowMs: 60 * 60_000 })
  async start(@Res({ passthrough: true }) response: Response) {
    if (process.env.DEMO_ENABLED === "false") throw new NotFoundException("The live demo is turned off on this server.");
    const userId = randomUUID();
    const organizationId = `org_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const email = `visitor-${userId.slice(0, 8)}@${DEMO_EMAIL_DOMAIN}`;
    const auth: AuthContext = { userId, userName: "Demo Visitor", email, organizationId, role: "owner" };
    await this.db.transaction(async (tx) => {
      // Random unusable password: demo accounts can only be entered through this endpoint.
      await tx.query("INSERT INTO users (id, email, name, password_hash, email_verified_at) VALUES ($1,$2,$3,$4, now())", [userId, email, auth.userName, await hashPassword(randomUUID())]);
      await tx.query("INSERT INTO organizations (id, name) VALUES ($1,$2)", [organizationId, "Northstar Digital Solutions (demo)"]);
      await tx.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,'owner')", [organizationId, userId]);
    });
    const { opportunityId } = await this.seedWorkspace(auth);
    await this.workflows.startAnalysis(auth, opportunityId);
    setSessionCookie(response, await this.auth.createSession(userId));
    return { opportunityId, organizationId };
  }

  private async seedWorkspace(auth: AuthContext): Promise<{ opportunityId: string; createdAssets: number }> {
    const existingAssets = await this.db.query<{ title: string }>("SELECT title FROM knowledge_assets WHERE organization_id = $1", [auth.organizationId]);
    const titles = new Set(existingAssets.map((a) => a.title));
    let createdAssets = 0;
    for (const asset of DEMO_KNOWLEDGE) {
      if (titles.has(asset.title)) continue;
      const created = await this.knowledge.create(auth, { title: asset.title, kind: asset.kind, content: asset.content, tags: [...asset.tags, "demo"] });
      if (asset.approved) await this.knowledge.setStatus(auth, created.id, "approved");
      createdAssets += 1;
    }

    const existing = await this.db.query<{ id: string }>("SELECT id FROM opportunities WHERE organization_id = $1 AND title = $2", [auth.organizationId, DEMO_RFP_TITLE]);
    let opportunityId = existing[0]?.id;
    if (!opportunityId) {
      const opportunity = await this.opportunities.create(auth, {
        clientName: "CivicWorks Department",
        title: DEMO_RFP_TITLE,
        deadline: "2027-02-12T14:00:00.000Z",
        context: "Synthetic demo opportunity. Public-sector resident portal; strong fit with our DMV and 311 work. Watch the SOC 2 requirement."
      });
      opportunityId = opportunity.id;
      const bytes = Buffer.from(DEMO_RFP_TEXT, "utf8");
      const stored = await this.storage.put(auth.organizationId, bytes, ".txt");
      const pages = splitIntoPages(DEMO_RFP_TEXT);
      const documentId = randomUUID();
      await this.db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO documents (id, organization_id, opportunity_id, filename, mime_type, size_bytes, sha256, storage_key, kind, status, page_count, empty_pages, error, created_at)
           VALUES ($1,$2,$3,'CW-2027-014 City Services Portal RFP.txt','text/plain',$4,$5,$6,'rfp','parsed',$7,'[]',NULL,now())`,
          [documentId, auth.organizationId, opportunityId, bytes.length, stored.sha256, stored.key, pages.length]
        );
        for (const [index, text] of pages.entries()) {
          await tx.query("INSERT INTO document_pages (document_id, organization_id, page_number, text) VALUES ($1,$2,$3,$4)", [documentId, auth.organizationId, index + 1, text]);
        }
      });
      await this.audit.log({ organizationId: auth.organizationId, actorId: auth.userId, action: "demo.seeded", entityType: "opportunity", entityId: opportunityId, entityLabel: DEMO_RFP_TITLE });
    }
    return { opportunityId, createdAssets };
  }

  @Get("dashboard")
  async dashboard(@Auth() auth: AuthContext): Promise<Dashboard> {
    const opportunities = await this.opportunities.list(auth.organizationId);
    const knowledge = await this.db.query<{ status: string; count: number }>(
      "SELECT status, count(*)::int AS count FROM knowledge_assets WHERE organization_id = $1 GROUP BY status",
      [auth.organizationId]
    );
    const activity = await this.db.query<{ id: string; action: string; name: string | null; entity_label: string | null; created_at: Date }>(
      `SELECT a.id, a.action, u.name, a.entity_label, a.created_at FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.organization_id = $1 ORDER BY a.created_at DESC LIMIT 12`,
      [auth.organizationId]
    );
    const now = Date.now();
    const knowledgeCount = (status: string) => Number(knowledge.find((k) => k.status === status)?.count ?? 0);
    return {
      counts: {
        opportunities: opportunities.length,
        inFlight: opportunities.filter((o) => ["processing", "qualification", "research", "generation", "validation"].includes(o.status)).length,
        awaitingReview: opportunities.filter((o) => o.status === "human_review").length,
        approved: opportunities.filter((o) => o.proposalStatus === "approved").length,
        approvedKnowledge: knowledgeCount("approved"),
        draftKnowledge: knowledgeCount("draft")
      },
      upcoming: opportunities
        .filter((o) => o.deadline && new Date(o.deadline).getTime() > now && o.status !== "completed")
        .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime())
        .slice(0, 5),
      recent: opportunities.slice(0, 6),
      activity: activity.map((a) => ({ id: a.id, action: a.action, actorName: a.name, entityLabel: a.entity_label, createdAt: isoRequired(a.created_at) }))
    };
  }
}
