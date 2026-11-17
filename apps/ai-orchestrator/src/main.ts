import "./env";
import "reflect-metadata";
import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  Logger,
  Module,
  Param,
  Post,
  UnauthorizedException,
  UseGuards
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ClaudeProvider, MODEL_CONFIG } from "./providers/claude";
import { HeuristicProvider } from "./providers/heuristic";
import type { ModelProvider } from "./providers/types";
import { WorkflowRunner } from "./runner";

/**
 * Provider selection: Claude when Anthropic credentials are configured
 * (or BIDPILOT_AI_MODE=claude), otherwise the deterministic heuristic
 * provider so the product works end-to-end offline.
 */
export function selectProvider(): ModelProvider {
  const forced = process.env.BIDPILOT_AI_MODE;
  if (forced === "heuristic") return new HeuristicProvider();
  if (forced === "claude" || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return new ClaudeProvider();
  return new HeuristicProvider();
}

const provider = selectProvider();
const runner = new WorkflowRunner(provider);

@Injectable()
class InternalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expected = Buffer.from(process.env.INTERNAL_SERVICE_TOKEN ?? "bidpilot-dev-internal-token");
    const actual = Buffer.from(request.header("x-internal-token") ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new UnauthorizedException("Invalid service token");
    return true;
  }
}

const runSchema = z.object({ workflowId: z.string().uuid() });

@Controller("v1/workflows")
@UseGuards(InternalGuard)
class WorkflowController {
  @Post("run")
  @HttpCode(202)
  run(@Body() body: unknown) {
    const { workflowId } = runSchema.parse(body);
    return { workflowId, status: runner.start(workflowId) };
  }

  @Post(":id/cancel")
  @HttpCode(202)
  cancel(@Param("id") id: string) {
    runner.cancel(id);
    return { workflowId: id, status: "cancelling" };
  }
}

@Controller("health")
class HealthController {
  @Get()
  health() {
    return {
      status: "ok",
      service: "ai-orchestrator",
      mode: provider.mode,
      model: provider.mode === "claude" ? MODEL_CONFIG.model : null,
      activeWorkflows: runner.activeCount
    };
  }
}

@Module({ controllers: [HealthController, WorkflowController], providers: [InternalGuard] })
class AppModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  const port = Number(process.env.PORT ?? 8000);
  await app.listen(port);
  Logger.log(`AI orchestrator on :${port} using ${provider.mode === "claude" ? `Claude (${MODEL_CONFIG.model})` : "heuristic provider (set ANTHROPIC_API_KEY for Claude)"}`, "Bootstrap");
}

if (require.main === module) void bootstrap();
