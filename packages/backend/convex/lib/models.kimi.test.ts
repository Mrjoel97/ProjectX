import { generateText, jsonSchema, stepCountIs, tool } from "ai";
import { afterEach, expect, test, vi } from "vitest";
import { resolveModel } from "./models";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test.each([
  true,
  false,
])("Kimi SDK tool continuation: signed reasoning retained=%s; unsigned details are not proof of preservation", async (signed) => {
  vi.stubEnv("OPENROUTER_API_KEY", "offline-test-key");
  const requests: Record<string, any>[] = [];
  const reasoning = [
    {
      type: "reasoning.text",
      text: "Read the approved product fixture.",
      index: 0,
      ...(signed ? { signature: "offline-fixture-signature" } : {}),
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
      const request = JSON.parse(String(init.body));
      requests.push(request);
      expect(request.model).toBe("moonshotai/kimi-k3.1-pro");
      return new Response(
        JSON.stringify({
          id: `offline-${requests.length}`,
          model: request.model,
          created: 1,
          object: "chat.completion",
          choices: [
            {
              index: 0,
              finish_reason: requests.length === 1 ? "tool_calls" : "stop",
              message:
                requests.length === 1
                  ? {
                      role: "assistant",
                      content: null,
                      reasoning_details: reasoning,
                      tool_calls: [
                        {
                          id: "call_fixture",
                          type: "function",
                          function: { name: "searchVault", arguments: '{"query":"FORMA"}' },
                        },
                      ],
                    }
                  : {
                      role: "assistant",
                      content: "Use the approved black FORMA bottle, preserving its silhouette.",
                    },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  let reads = 0;
  const result = await generateText({
    model: resolveModel("or/moonshotai/kimi-k3.1-pro"),
    prompt: "Read the approved fixture, then describe the product.",
    tools: {
      searchVault: tool({
        description: "Read the approved fixture.",
        inputSchema: jsonSchema<{ query: string }>({
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false,
        }),
        execute: async () => {
          reads++;
          return { product: "black FORMA bottle", approvedRevision: 1 };
        },
      }),
    },
    // Moonshot's public endpoint supports required/auto/none, but not named-function selection.
    prepareStep: ({ stepNumber }) => ({ toolChoice: stepNumber === 0 ? "required" : "none" }),
    stopWhen: stepCountIs(2),
    maxOutputTokens: 8000,
    maxRetries: 0,
  });
  expect(reads).toBe(1);
  expect(requests).toHaveLength(2);
  expect(requests[0]?.tool_choice).toBe("required");
  expect(requests[0]?.tools[0].function.parameters).toEqual({
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  });
  const assistant = requests[1]?.messages.find(
    (message: { role: string }) => message.role === "assistant",
  );
  expect(assistant.reasoning_details).toEqual(signed ? reasoning : []);
  expect(requests[1]?.messages.some((message: { role: string }) => message.role === "tool")).toBe(
    true,
  );
  expect(result.text).toContain("approved black FORMA");
});
