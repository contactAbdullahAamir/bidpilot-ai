import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import {
  AnalysisSchema,
  DraftSchema,
  EligibilitySchema,
  PlanSchema,
  SYSTEM,
  ValidationSchema,
  analysisPrompt,
  eligibilityPrompt,
  planPrompt,
  validationPrompt,
  writeSectionPrompt
} from "./prompts";
import {
  EligibilityVerdict,
  ModelProvider,
  NonRetryableError,
  RawAnalysis,
  RawPlanSection,
  RawValidation,
  Result,
  SectionDraft,
  SectionDraftInput,
  Usage,
  ValidationInput
} from "./types";

/** Model routing and pricing live in configuration, not business logic. */
export const MODEL_CONFIG = {
  model: process.env.BIDPILOT_MODEL ?? "claude-opus-5-5",
  // USD per million tokens; used for cost estimates shown to users.
  pricing: { input: Number(process.env.BIDPILOT_PRICE_INPUT ?? 4), output: Number(process.env.BIDPILOT_PRICE_OUTPUT ?? 20) },
  effort: {
    analysis: "high",
    eligibility: "medium",
    planning: "medium",
    writing: "medium",
    validation: "high"
  } as Record<string, "low" | "medium" | "high" | "xhigh" | "max">
};

export class ClaudeProvider implements ModelProvider {
  readonly mode = "claude" as const;
  readonly model = MODEL_CONFIG.model;
  private readonly client = new Anthropic({ maxRetries: 3, timeout: 10 * 60 * 1000 });

  private async call<T>(task: string, schema: z.ZodType<T>, user: string, maxTokens = 16000): Promise<Result<T>> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: MODEL_CONFIG.model,
        max_tokens: maxTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: MODEL_CONFIG.effort[task] ?? "medium", format: betaZodOutputFormat(schema) },
        system: SYSTEM,
        messages: [{ role: "user", content: user }]
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new NonRetryableError("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.");
      }
      if (error instanceof Anthropic.BadRequestError) throw new NonRetryableError(`Model request rejected: ${error.message}`);
      throw error; // 429/5xx/network: retried by the step runner
    }
    const usage = this.usage(response.usage);
    if (response.stop_reason === "refusal") {
      throw new NonRetryableError("The model declined this request. Review the document content or proceed manually.");
    }
    if (response.stop_reason === "max_tokens") throw new Error(`The ${task} output was cut off; retrying.`);
    if (!response.parsed_output) throw new Error(`The ${task} output did not match the expected schema; retrying.`);
    return { value: response.parsed_output as T, usage };
  }

  private usage(raw: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): Usage {
    const input = raw.input_tokens + (raw.cache_creation_input_tokens ?? 0) + (raw.cache_read_input_tokens ?? 0);
    const cost = (input * MODEL_CONFIG.pricing.input + raw.output_tokens * MODEL_CONFIG.pricing.output) / 1_000_000;
    return { inputTokens: input, outputTokens: raw.output_tokens, estimatedCostUsd: Math.round(cost * 10000) / 10000 };
  }

  analyze(input: Parameters<ModelProvider["analyze"]>[0]): Promise<Result<RawAnalysis>> {
    return this.call("analysis", AnalysisSchema, analysisPrompt(input), 32000);
  }

  assessEligibility(input: Parameters<ModelProvider["assessEligibility"]>[0]): Promise<Result<EligibilityVerdict>> {
    return this.call("eligibility", EligibilitySchema, eligibilityPrompt(input));
  }

  async plan(input: Parameters<ModelProvider["plan"]>[0]): Promise<Result<RawPlanSection[]>> {
    const result = await this.call("planning", PlanSchema, planPrompt(input));
    return { value: result.value.sections, usage: result.usage };
  }

  writeSection(input: SectionDraftInput): Promise<Result<SectionDraft>> {
    return this.call("writing", DraftSchema, writeSectionPrompt(input));
  }

  validate(input: ValidationInput): Promise<Result<RawValidation>> {
    return this.call("validation", ValidationSchema, validationPrompt(input));
  }
}
