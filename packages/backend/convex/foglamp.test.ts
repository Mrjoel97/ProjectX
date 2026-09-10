// @vitest-environment node
import { generateText, jsonSchema, stepCountIs, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { IngestPayload } from "foglamp";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let tracing: typeof import("./lib/foglamp");
let integration: ReturnType<typeof tracing.fogIntegration> | undefined;
let requests: IngestPayload[];
const sentinel = "PRIVATE_PAYLOAD_SENTINEL";
const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};
const response = {
  content: [{ type: "text" as const, text: `${sentinel}_answer` }],
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage,
  warnings: [],
  providerMetadata: { google: { safetyRatings: [{ category: `${sentinel}_rating` }] } },
};

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("FOGLAMP_API_KEY", "offline-test-key");
  vi.stubEnv("FOGLAMP_HUD", "0");
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as IngestPayload);
      return new Response("", { status: 200 });
    }),
  );
  tracing = await import("./lib/foglamp");
});
afterEach(async () => {
  await integration?.shutdown();
  integration = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const spans = () => requests.flatMap((request) => request.traces.flatMap((trace) => trace.spans));
const assertPrivate = () => {
  expect(requests.length).toBeGreaterThan(0);
  const wire = JSON.stringify(requests);
  expect(wire).not.toContain(sentinel);
  expect(wire).not.toContain(Buffer.from(sentinel).toString("base64"));
  for (const span of spans()) {
    expect(span.input).toBeUndefined();
    expect(span.output).toBeUndefined();
    expect(span.toolCatalog).toBeUndefined();
    expect(span.safetyMetadata).toBeUndefined();
    expect(span.sources).toBeUndefined();
  }
};

test("real SDK transport retains refs and usage without prompt, image, tool or provider payloads even with recording enabled", async () => {
  expect(fetch).not.toHaveBeenCalled();
  integration = tracing.fogIntegration({ traceName: "privacy-test", sessionId: "thread-ref" });
  const executed = vi.fn(async () => `${sentinel}_vault_document`);
  const model = new MockLanguageModelV4({
    doGenerate: [
      {
        ...response,
        content: [
          {
            type: "tool-call",
            toolCallId: "call-ref",
            toolName: "searchVault",
            input: JSON.stringify({ query: `${sentinel}_query` }),
          },
        ],
        finishReason: { unified: "tool-calls", raw: "tool-calls" },
      },
      response,
    ],
  });
  await generateText({
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `${sentinel}_prompt` },
          { type: "file", data: new TextEncoder().encode(sentinel), mediaType: "image/png" },
        ],
      },
    ],
    tools: {
      searchVault: tool({
        inputSchema: jsonSchema<{ query: string }>({
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        }),
        execute: executed,
      }),
    },
    stopWhen: stepCountIs(2),
    maxRetries: 0,
    telemetry: { recordInputs: true, recordOutputs: true, integrations: [integration] },
  });
  await tracing.flushTelemetry();
  expect(executed).toHaveBeenCalledOnce();
  assertPrivate();
  expect(requests[0]?.traces[0]).toMatchObject({
    traceName: "privacy-test",
    sessionId: "thread-ref",
  });
  expect(spans()).toContainEqual(
    expect.objectContaining({ spanType: "tool", name: "searchVault", status: "ok" }),
  );
  expect(spans()).toContainEqual(
    expect.objectContaining({ spanType: "llm", usage: expect.any(Object) }),
  );
});

test("provider error trace keeps status and a static code without provider message or cause", async () => {
  integration = tracing.fogIntegration({ traceName: "privacy-error" });
  const failure = new Error(`${sentinel}_provider`, { cause: `${sentinel}_cause` });
  await expect(
    generateText({
      model: new MockLanguageModelV4({
        doGenerate: async () => {
          throw failure;
        },
      }),
      prompt: sentinel,
      maxRetries: 0,
      telemetry: { integrations: [integration] },
    }),
  ).rejects.toBe(failure);
  await tracing.flushTelemetry();
  assertPrivate();
  expect(spans()).toContainEqual(
    expect.objectContaining({ status: "error", errorMessage: "model_call_failed" }),
  );
});

test("ambient traced scope drains safe traces and propagates its original exception without serializing it", async () => {
  integration = tracing.fogIntegration({ traceName: "privacy-ambient" });
  const bound = integration;
  const failure = new Error(`${sentinel}_ambient`, { cause: `${sentinel}_ambient_cause` });
  await expect(
    tracing.traced({ agentName: "privacy-agent", sessionId: "ambient-thread-ref" }, async () => {
      await generateText({
        model: new MockLanguageModelV4({ doGenerate: response }),
        prompt: sentinel,
        telemetry: { integrations: [bound] },
        maxRetries: 0,
      });
      throw failure;
    }),
  ).rejects.toBe(failure);
  // No explicit flush: the production wrapper's finally must drain the safe completed model trace.
  assertPrivate();
  expect(requests[0]?.traces[0]).toMatchObject({
    agentName: "privacy-agent",
    sessionId: "ambient-thread-ref",
  });
});

test("tool error trace keeps failure attribution without exception content", async () => {
  integration = tracing.fogIntegration({ traceName: "privacy-tool-error" });
  await generateText({
    model: new MockLanguageModelV4({
      doGenerate: {
        ...response,
        content: [
          {
            type: "tool-call",
            toolCallId: "failed-call-ref",
            toolName: "searchVault",
            input: "{}",
          },
        ],
        finishReason: { unified: "tool-calls", raw: "tool-calls" },
      },
    }),
    prompt: sentinel,
    maxRetries: 0,
    tools: {
      searchVault: tool({
        inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
        execute: async (): Promise<string> => {
          throw new Error(`${sentinel}_tool_error`);
        },
      }),
    },
    telemetry: { integrations: [integration] },
  });
  await tracing.flushTelemetry();
  assertPrivate();
  expect(spans()).toContainEqual(
    expect.objectContaining({
      spanType: "tool",
      status: "error",
      errorMessage: "tool_execution_failed",
    }),
  );
});

test("abort trace strips arbitrary reasons before native transport serialization", async () => {
  integration = tracing.fogIntegration({ traceName: "privacy-abort" });
  const nativeStart = integration.onStart;
  const bound = integration;
  integration.onStart = async (event) => {
    await nativeStart(event);
    await bound.onAbort({
      callId: event.callId,
      reason: new Error(`${sentinel}_abort`),
    } as Parameters<typeof bound.onAbort>[0]);
  };
  await generateText({
    model: new MockLanguageModelV4({ doGenerate: response }),
    prompt: sentinel,
    telemetry: { integrations: [integration] },
    maxRetries: 0,
  });
  await tracing.flushTelemetry();
  assertPrivate();
  expect(spans()).toContainEqual(
    expect.objectContaining({ status: "aborted", errorMessage: "aborted" }),
  );
});

test("provider tool ids become local refs while start and end keep the same timing correlation", async () => {
  let now = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  integration = tracing.fogIntegration({ traceName: "privacy-tool-refs" });
  const providerId = `${sentinel}_provider_tool_id`;
  await generateText({
    model: new MockLanguageModelV4({
      doGenerate: {
        ...response,
        content: [
          { type: "tool-call", toolCallId: providerId, toolName: "searchVault", input: "{}" },
        ],
        finishReason: { unified: "tool-calls", raw: "tool-calls" },
      },
    }),
    prompt: sentinel,
    maxRetries: 0,
    tools: {
      searchVault: tool({
        inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
        execute: async () => {
          now = 2000;
          return `${sentinel}_result`;
        },
      }),
    },
    telemetry: { integrations: [integration] },
  });
  await tracing.flushTelemetry();
  assertPrivate();
  const toolSpan = spans().find((span) => span.spanType === "tool");
  expect(toolSpan).toMatchObject({
    startTime: 1000,
    endTime: 2000,
    status: "ok",
    name: "searchVault",
  });
  expect(toolSpan?.spanId).toMatch(/:tool:tool-1$/);
});

test("unknown model-authored tool names produce no exported tool attributes", async () => {
  integration = tracing.fogIntegration({ traceName: "privacy-unknown-tool" });
  await generateText({
    model: new MockLanguageModelV4({
      doGenerate: {
        ...response,
        content: [
          {
            type: "tool-call",
            toolCallId: `${sentinel}_id`,
            toolName: `${sentinel}_name`,
            input: "{}",
          },
        ],
        finishReason: { unified: "tool-calls", raw: "tool-calls" },
      },
    }),
    prompt: sentinel,
    maxRetries: 0,
    tools: {
      searchVault: tool({
        inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
        execute: async () => "unused",
      }),
    },
    telemetry: { integrations: [integration] },
  });
  await tracing.flushTelemetry();
  assertPrivate();
  expect(spans().filter((span) => span.spanType === "tool")).toHaveLength(0);
});
