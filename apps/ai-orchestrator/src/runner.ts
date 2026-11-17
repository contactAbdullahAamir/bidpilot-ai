import { ANALYSIS_STEPS, REVISION_STEPS, type WorkflowStepName } from "@bidpilot/contracts";
import { Logger } from "@nestjs/common";
import { ApiClient, CancelledError } from "./api-client";
import { ModelProvider, NonRetryableError } from "./providers/types";
import { STEP_LABELS, STEP_RUNNERS, STEP_TIMEOUTS, StepContext } from "./steps";
import { sleep } from "./text";

const MAX_ATTEMPTS = 2;

/**
 * Executes persisted workflow steps in order. Completed steps are skipped,
 * so a re-dispatch after a crash resumes from the last checkpoint. One run
 * per workflow id at a time.
 */
export class WorkflowRunner {
  private readonly logger = new Logger("Runner");
  private readonly running = new Map<string, { cancelled: boolean }>();

  constructor(private readonly provider: ModelProvider, private readonly api = new ApiClient()) {}

  get activeCount(): number {
    return this.running.size;
  }

  start(workflowId: string): "started" | "already_running" {
    if (this.running.has(workflowId)) return "already_running";
    const state = { cancelled: false };
    this.running.set(workflowId, state);
    void this.run(workflowId, state)
      .catch((error) => this.logger.error(`Workflow ${workflowId} crashed: ${(error as Error).message}`))
      .finally(() => this.running.delete(workflowId));
    return "started";
  }

  cancel(workflowId: string): void {
    const state = this.running.get(workflowId);
    if (state) state.cancelled = true;
  }

  async run(workflowId: string, state: { cancelled: boolean }): Promise<void> {
    const context = await this.api.context(workflowId);
    if (!["queued", "running"].includes(context.status)) return;
    const steps: readonly WorkflowStepName[] = context.workflowType === "revision" ? REVISION_STEPS : ANALYSIS_STEPS;
    try {
      for (const step of steps) {
        // Checkpoint: outputs already persisted by the API are reused, not recomputed.
        // (Revision runs inherit analysis/planning outputs but only run writing + validation.)
        if (context.completed[step]) continue;
        if (state.cancelled) throw new CancelledError();

        await this.api.step(workflowId, step, { status: "running", mode: this.provider.mode });
        const ctx: StepContext = {
          workflowId,
          context,
          provider: this.provider,
          api: this.api,
          log: (message, level = "info") => this.api.event(workflowId, step, level, message)
        };

        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
          try {
            const result = await withTimeout(STEP_RUNNERS[step](ctx), STEP_TIMEOUTS[step] * 1000, STEP_LABELS[step]);
            if (state.cancelled) throw new CancelledError();
            await this.api.step(workflowId, step, { status: "completed", output: result.output, usage: result.usage, mode: this.provider.mode });
            await this.api.event(workflowId, step, "success", result.summary);
            context.completed[step] = result.output;
            lastError = null;
            break;
          } catch (error) {
            if (error instanceof CancelledError) throw error;
            lastError = error as Error;
            this.logger.warn(`${step} attempt ${attempt} failed: ${lastError.message}`);
            if (error instanceof NonRetryableError || attempt === MAX_ATTEMPTS) break;
            const delay = 1000 * 2 ** attempt + Math.random() * 1000;
            await this.api.event(workflowId, step, "warning", `${STEP_LABELS[step]} hit a problem (${lastError.message}). Retrying in ${Math.round(delay / 1000)}s.`);
            await sleep(delay);
          }
        }
        if (lastError) {
          await this.api.step(workflowId, step, { status: "failed", error: lastError.message });
          await this.api.finish(workflowId, { status: "failed", error: `${STEP_LABELS[step]} failed: ${lastError.message}` });
          return;
        }
      }
      await this.api.finish(workflowId, { status: "waiting_review" });
    } catch (error) {
      if (error instanceof CancelledError) {
        this.logger.log(`Workflow ${workflowId} stopped (no longer active)`);
        return;
      }
      throw error;
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    })
  ]);
}
