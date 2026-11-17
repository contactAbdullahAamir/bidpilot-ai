import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AuthController, OrganizationController } from "./auth/auth.controller";
import { AuthService, InternalGuard, SessionGuard } from "./auth/auth";
import { ApiExceptionFilter, AuditService, StorageService } from "./core/common";
import { DatabaseService } from "./core/database.service";
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
    AuthService,
    InternalGuard,
    OrchestratorClient,
    DocumentsService,
    KnowledgeService,
    ProposalsService,
    WorkflowsService,
    OpportunitiesService,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter }
  ]
})
export class AppModule {}
