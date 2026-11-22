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

/**
 * Presets for providers that expose an OpenAI-compatible Chat Completions API.
 * Several have free tiers, which makes them useful for development and testing.
 */
export const OPENAI_COMPATIBLE_PRESETS: Record<string, { baseUrl: string; model: string; keyEnv: string }> = {
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-flash-latest", keyEnv: "GEMINI_API_KEY" },
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", keyEnv: "GROQ_API_KEY" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/free", keyEnv: "OPENROUTER_API_KEY" },
  ollama: { baseUrl: "http://localhost:11434/v1", model: "llama3.1", keyEnv: "OLLAMA_API_KEY" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", keyEnv: "OPENAI_API_KEY" }
};

export type OpenAICompatibleConfig = {
  preset: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** "json_schema" asks the server to enforce the schema; "json_object" only forces valid JSON. */
  responseFormat: "json_schema" | "json_object";
  pricing: { input: number; output: number };
};

/** Resolve configuration from LLM_PROVIDER / LLM_BASE_URL / LLM_MODEL / LLM_API_KEY and preset key variables. */
export function openAICompatibleConfig(env: NodeJS.ProcessEnv = process.env): OpenAICompatibleConfig | null {
  const presetName = (env.LLM_PROVIDER ?? "").trim().toLowerCase() || Object.keys(OPENAI_COMPATIBLE_PRESETS).find((name) => env[OPENAI_COMPATIBLE_PRESETS[name].keyEnv]);
  if (!presetName && !env.LLM_BASE_URL) return null;
  const preset = presetName ? OPENAI_COMPATIBLE_PRESETS[presetName] : undefined;
  const baseUrl = (env.LLM_BASE_URL || preset?.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error(`Unknown LLM_PROVIDER "${presetName}". Use one of ${Object.keys(OPENAI_COMPATIBLE_PRESETS).join(", ")} or set LLM_BASE_URL.`);
  const apiKey = env.LLM_API_KEY || (preset ? env[preset.keyEnv] : "") || "";
  if (!apiKey && presetName !== "ollama") return null;
  const format = env.LLM_RESPONSE_FORMAT === "json_object" ? "json_object" : "json_schema";
  return {
    preset: presetName || "custom",
    baseUrl,
    apiKey,
    model: env.LLM_MODEL || preset?.model || "",
    responseFormat: presetName === "groq" && !env.LLM_RESPONSE_FORMAT ? "json_object" : format,
    pricing: { input: Number(env.LLM_PRICE_INPUT ?? 0), output: Number(env.LLM_PRICE_OUTPUT ?? 0) }
  };
}

type ChatResponse = {
  choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

/**
 * Provider for any OpenAI-compatible Chat Completions endpoint (Gemini, Groq,
 * OpenRouter, Ollama, OpenAI, vLLM, LM Studio...). Uses the same prompts and
 * schemas as the Claude provider; output is always validated with Zod, so a
 * model that ignores the schema causes a retry, never bad data.
 */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly mode = "openai" as const;
  readonly model: string;

  constructor(private readonly config: OpenAICompatibleConfig, private readonly fetchImpl: typeof fetch = fetch) {
    if (!config.model) throw new Error("LLM_MODEL is required for a custom OpenAI-compatible endpoint.");
    this.model = config.model;
  }

  private async call<T>(task: string, schema: z.ZodType<T>, user: string, maxTokens = 8192): Promise<Result<T>> {
    const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
    delete jsonSchema.$schema;
    const system = `${SYSTEM}\n\nRespond with a single JSON object only, no prose and no code fences. It must match this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
    const response_format =
      this.config.responseFormat === "json_schema"
        ? { type: "json_schema", json_schema: { name: `bidpilot_${task}`, schema: jsonSchema } }
        : { type: "json_object" };

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
          "x-title": "BidPilot AI"
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: maxTokens,
          temperature: 0.2,
          response_format,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        }),
        signal: AbortSignal.timeout(5 * 60 * 1000)
      });
    } catch (error) {
      throw new Error(`Could not reach ${this.config.baseUrl}: ${(error as Error).message}`);
    }

    const body = (await res.json().catch(() => ({}))) as ChatResponse;
    if (!res.ok) {
      const message = body.error?.message ?? res.statusText;
      if (res.status === 400 && this.config.responseFormat === "json_schema") {
        // Some servers reject parts of JSON Schema; fall back to plain JSON mode (output is still Zod-validated).
        this.config.responseFormat = "json_object";
        return this.call(task, schema, user, maxTokens);
      }
      if (res.status === 401 || res.status === 403) throw new NonRetryableError(`The ${this.config.preset} API key was rejected: ${message}`);
      if (res.status === 400 || res.status === 404 || res.status === 422) throw new NonRetryableError(`Model request rejected (${res.status}): ${message}`);
      throw new Error(`Model API error ${res.status}: ${message}`); // 429/5xx: retried by the step runner
    }

    const usage = this.usage(body.usage);
    const choice = body.choices?.[0];
    if (choice?.message?.refusal) throw new NonRetryableError("The model declined this request. Review the document content or proceed manually.");
    if (choice?.finish_reason === "length") throw new Error(`The ${task} output was cut off; retrying.`);
    const parsed = schema.safeParse(parseJson(choice?.message?.content ?? ""));
    if (!parsed.success) throw new Error(`The ${task} output did not match the expected schema; retrying.`);
    return { value: parsed.data, usage };
  }

  private usage(raw: ChatResponse["usage"]): Usage {
    const input = raw?.prompt_tokens ?? 0;
    const output = raw?.completion_tokens ?? 0;
    const cost = (input * this.config.pricing.input + output * this.config.pricing.output) / 1_000_000;
    return { inputTokens: input, outputTokens: output, estimatedCostUsd: Math.round(cost * 10000) / 10000 };
  }

  analyze(input: Parameters<ModelProvider["analyze"]>[0]): Promise<Result<RawAnalysis>> {
    return this.call("analysis", AnalysisSchema, analysisPrompt(input), 16000);
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
    return this.call("validation", ValidationSchema, validationPrompt(input), 16000);
  }
}

/** Accept raw JSON, or JSON wrapped in a code fence / surrounded by stray text. */
export function parseJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced?.[1] ?? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  }
}
