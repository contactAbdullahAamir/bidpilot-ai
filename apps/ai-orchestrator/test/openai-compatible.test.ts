import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenAICompatibleProvider, openAICompatibleConfig, parseJson } from "../src/providers/openai-compatible";
import { NonRetryableError } from "../src/providers/types";

function fakeFetch(responses: { status: number; body: unknown }[], seen: unknown[] = []): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    seen.push(JSON.parse(String(init.body)));
    const next = responses.shift()!;
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

const config = () => openAICompatibleConfig({ GEMINI_API_KEY: "test-key" })!;

test("config: picks a preset from whichever free key is set", () => {
  assert.equal(openAICompatibleConfig({}), null);
  const gemini = config();
  assert.equal(gemini.preset, "gemini");
  assert.match(gemini.baseUrl, /generativelanguage/);
  const groq = openAICompatibleConfig({ GROQ_API_KEY: "k", LLM_MODEL: "custom-model" })!;
  assert.equal(groq.model, "custom-model");
  assert.equal(groq.responseFormat, "json_object");
  assert.equal(openAICompatibleConfig({ LLM_PROVIDER: "ollama" })!.apiKey, "");
});

test("eligibility: parses and validates JSON output, reports usage", async () => {
  const seen: any[] = [];
  const provider = new OpenAICompatibleProvider(
    config(),
    fakeFetch([{ status: 200, body: { choices: [{ message: { content: '```json\n{"status":"met","evidenceLabels":["E1"],"note":"ok"}\n```' }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } } }], seen)
  );
  const result = await provider.assessEligibility({
    organizationName: "Northstar",
    requirement: { id: "r1", code: "M-1", description: "ISO 27001", category: "eligibility", mandatory: true } as any,
    evidence: []
  });
  assert.deepEqual(result.value, { status: "met", evidenceLabels: ["E1"], note: "ok" });
  assert.equal(result.usage.inputTokens, 10);
  assert.equal(seen[0].response_format.type, "json_schema");
});

test("falls back to json_object when the server rejects the schema; bad keys are non-retryable", async () => {
  const seen: any[] = [];
  const ok = { choices: [{ message: { content: '{"status":"unknown","evidenceLabels":[],"note":"n"}' } }] };
  const provider = new OpenAICompatibleProvider(config(), fakeFetch([{ status: 400, body: { error: { message: "bad schema" } } }, { status: 200, body: ok }], seen));
  const input = { organizationName: "X", requirement: { code: "M", description: "d" } as any, evidence: [] };
  assert.equal((await provider.assessEligibility(input)).value.status, "unknown");
  assert.equal(seen[1].response_format.type, "json_object");

  const denied = new OpenAICompatibleProvider(config(), fakeFetch([{ status: 401, body: { error: { message: "invalid key" } } }]));
  await assert.rejects(denied.assessEligibility(input), NonRetryableError);

  const invalid = new OpenAICompatibleProvider(config(), fakeFetch([{ status: 200, body: { choices: [{ message: { content: '{"status":"maybe"}' } }] } }]));
  await assert.rejects(invalid.assessEligibility(input), (e: Error) => !(e instanceof NonRetryableError) && /schema/.test(e.message));
});

test("parseJson tolerates surrounding text", () => {
  assert.deepEqual(parseJson('Here you go: {"a":1} thanks'), { a: 1 });
  assert.equal(parseJson("nope"), undefined);
});
