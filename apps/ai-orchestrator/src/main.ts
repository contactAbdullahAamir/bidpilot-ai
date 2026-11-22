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
import { ClaudeProvider } from "./providers/claude";
import { HeuristicProvider } from "./providers/heuristic";
import { OpenAICompatibleProvider, openAICompatibleConfig } from "./providers/openai-compatible";
import type { ModelProvider } from "./providers/types";
import { WorkflowRunner } from "./runner";

/**
 * Provider selection:
 * 1. BIDPILOT_AI_MODE forces "claude", "openai" (any OpenAI-compatible API) or "heuristic".
 * 2. Otherwise Claude when Anthropic credentials are configured,
 * 3. then an OpenAI-compatible API (Gemini, Groq, OpenRouter, Ollama...) when LLM_* or a preset key is set,
 * 4. else the deterministic heuristic provider so the product works end-to-end offline.
 */
export function selectProvider(env: NodeJS.ProcessEnv = process.env): ModelProvider {
  const forced = env.BIDPILOT_AI_MODE;
  if (forced === "heuristic") return new HeuristicProvider();
  if (forced === "claude" || (!forced && (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN))) return new ClaudeProvider();
  const compatible = openAICompatibleConfig(env);
  if (compatible) return new OpenAICompatibleProvider(compatible);
  if (forced === "openai") throw new Error("BIDPILOT_AI_MODE=openai needs LLM_PROVIDER/LLM_BASE_URL and an API key (e.g. GEMINI_API_KEY).");
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
      model: provider.model ?? null,
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
  Logger.log(`AI orchestrator on :${port} using ${provider.model ? `${provider.mode} (${provider.model})` : "heuristic provider (set an AI API key in .env to use a real model)"}`, "Bootstrap");
}

if (require.main === module) void bootstrap();
