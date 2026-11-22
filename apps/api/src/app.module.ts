import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AuthController, OrganizationController } from "./auth/auth.controller";
import { AuthService, InternalGuard, SessionGuard } from "./auth/auth";
import { ApiExceptionFilter, AuditService, StorageService } from "./core/common";
import { DatabaseService } from "./core/database.service";
import { MailService } from "./core/mail";
import { RateLimitGuard } from "./core/security";
import { InvitationsService } from "./auth/invitations";
import { DemoController } from "./demo/demo";
import { DocumentsController, DocumentsService } from "./documents/documents";
import { KnowledgeController, KnowledgeService } from "./knowledge/knowledge";
import { OpportunitiesController, OpportunitiesService } from "./opportunities/opportunities";
import { ProposalsController, ProposalsService } from "./proposals/proposals";
import { OrchestratorClient } from "./workflows/orchestrator.client";
import { InternalWorkflowsController, WorkflowsController, WorkflowsService } from "./workflows/workflows";

@Module({
  controllers: [
    AuthController,
    OrganizationController,
    DemoController,
    DocumentsController,
    KnowledgeController,
    OpportunitiesController,
    ProposalsController,
    WorkflowsController,
    InternalWorkflowsController
  ],
  providers: [
    {
      provide: DatabaseService,
      useFactory: async () => {
        const db = new DatabaseService();
        await db.init();
        return db;
      }
    },
    AuditService,
    StorageService,
    MailService,
    AuthService,
    InvitationsService,
    InternalGuard,
    OrchestratorClient,
    DocumentsService,
    KnowledgeService,
    ProposalsService,
    WorkflowsService,
    OpportunitiesService,
    // Guards run in order: throttle before doing any session lookups.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter }
  ]
})
export class AppModule {}
