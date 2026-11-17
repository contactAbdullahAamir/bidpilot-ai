import type { Evidence, InternalContext, WorkflowEvent, WorkflowStepName } from "@bidpilot/contracts";
import type { Usage } from "./providers/types";

export class CancelledError extends Error {
  constructor() {
    super("Workflow is no longer active");
  }
}

/** Client for the API's internal workflow endpoints (the API owns all writes). */
export class ApiClient {
  constructor(
    private readonly baseUrl = process.env.API_INTERNAL_URL ?? "http://localhost:3001/api/v1",
    private readonly token = process.env.INTERNAL_SERVICE_TOKEN ?? "bidpilot-dev-internal-token"
  ) {}

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}/internal/workflows/${path}`, {
      method,
      headers: { "content-type": "application/json", "x-internal-token": this.token },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`API ${method} ${path} failed with ${response.status}: ${text.slice(0, 300)}`);
    }
    return (await response.json()) as T;
  }

  context(id: string): Promise<InternalContext> {
    return this.request("GET", `${id}/context`);
  }

  async step(
    id: string,
    step: WorkflowStepName,
    body: { status: "running" | "completed" | "failed"; output?: unknown; error?: string; usage?: Usage; mode?: string }
  ): Promise<void> {
    const result = await this.request<{ accepted: boolean }>("POST", `${id}/steps/${step}`, body);
    if (!result.accepted) throw new CancelledError();
  }

  async event(id: string, step: string | null, level: WorkflowEvent["level"], message: string): Promise<void> {
    const result = await this.request<{ accepted: boolean }>("POST", `${id}/events`, { step, level, message });
    if (!result.accepted) throw new CancelledError();
  }

  search(id: string, query: string, limit: number): Promise<Evidence[]> {
    return this.request("POST", `${id}/search`, { query, limit });
  }

  async finish(id: string, body: { status: "waiting_review" | "failed"; error?: string }): Promise<void> {
    await this.request("POST", `${id}/finish`, body);
  }
}
