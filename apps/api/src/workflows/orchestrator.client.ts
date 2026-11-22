import { Injectable, Logger } from "@nestjs/common";
import type { AiMode } from "@bidpilot/contracts";
import { internalToken } from "../auth/auth";

/** HTTP client for the AI orchestrator service. */
@Injectable()
export class OrchestratorClient {
  private readonly logger = new Logger("Orchestrator");
  private cachedMode: { value: { mode: AiMode | undefined; model: string | null }; at: number } = { value: { mode: undefined, model: null }, at: 0 };

  get baseUrl(): string {
    return process.env.AI_ORCHESTRATOR_URL ?? "http://localhost:8000";
  }

  async dispatch(workflowId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/v1/workflows/run`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": internalToken() },
      body: JSON.stringify({ workflowId }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`AI orchestrator returned ${response.status}`);
  }

  async cancel(workflowId: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/v1/workflows/${workflowId}/cancel`, {
        method: "POST",
        headers: { "x-internal-token": internalToken() },
        signal: AbortSignal.timeout(3000)
      });
    } catch (error) {
      this.logger.warn(`Cancel signal not delivered: ${(error as Error).message}`);
    }
  }

  /** Which provider the orchestrator is running with (cached for 30s). */
  async mode(): Promise<AiMode | undefined> {
    return (await this.engine()).mode;
  }

  /** Provider mode and model name (cached for 30s). */
  async engine(): Promise<{ mode: AiMode | undefined; model: string | null }> {
    if (Date.now() - this.cachedMode.at < 30_000) return this.cachedMode.value;
    let value: { mode: AiMode | undefined; model: string | null } = { mode: undefined, model: null };
    try {
      const response = await fetch(`${this.baseUrl}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const body = (await response.json()) as { mode?: AiMode; model?: string | null };
        value = { mode: body.mode, model: body.model ?? null };
      }
    } catch {
      /* orchestrator unreachable */
    }
    this.cachedMode = { value, at: Date.now() };
    return value;
  }
}
