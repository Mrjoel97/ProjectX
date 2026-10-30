import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  assertPresenceDesignStage,
  STITCH_INCLUDED_CREDITS_DECLARATION,
} from "./presenceDesignProbe";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const stage = () => {
  vi.stubEnv("CONVEX_CLOUD_URL", "https://third-gecko-977.convex.cloud");
  vi.stubEnv("CONVEX_SITE_URL", "https://third-gecko-977.convex.site");
};
describe("dedicated-stage Stitch preflight", () => {
  test("both deployment hosts must match; missing, production and suffix attacks refuse", () => {
    stage();
    expect(() => assertPresenceDesignStage()).not.toThrow();
    for (const host of [
      "",
      "https://production.convex.cloud",
      "https://third-gecko-977.convex.cloud.attacker.test",
    ]) {
      vi.stubEnv("CONVEX_CLOUD_URL", host);
      expect(() => assertPresenceDesignStage()).toThrow("DEDICATED_STAGE_REQUIRED");
    }
    stage();
    vi.stubEnv("CONVEX_SITE_URL", "https://other.convex.site");
    expect(() => assertPresenceDesignStage()).toThrow("DEDICATED_STAGE_REQUIRED");
  });
  test("actual internal action lists tools read-only and exposes no key, raw catalogue or generation prompt", async () => {
    stage();
    vi.stubEnv("STITCH_API_KEY", "synthetic_stitch_key");
    const methods: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const message = JSON.parse(String(init?.body));
      methods.push(message.method);
      expect(String(init?.body)).not.toContain("pikar-stitch-read-only");
      if (message.method === "notifications/initialized")
        return new Response(null, { status: 202 });
      const tools = [
        {
          name: "create_project",
          inputSchema: { type: "object", properties: { title: { type: "string" } } },
        },
        {
          name: "generate_screen_from_text",
          inputSchema: {
            type: "object",
            properties: {
              projectId: { type: "string" },
              prompt: { type: "string" },
              deviceType: { type: "string" },
            },
          },
        },
        {
          name: "get_screen",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
            },
            required: ["name"],
          },
        },
        { name: "private_account_list", inputSchema: { type: "object" } },
      ];
      return Response.json({
        jsonrpc: "2.0",
        id: message.id,
        result:
          message.method === "initialize"
            ? { protocolVersion: "2025-06-18", capabilities: { tools: {} } }
            : { tools },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const t = convexTest(schema, modules),
      result = await t.action(makeFunctionReference<"action">("presenceDesignProbe:preflight"), {
        billingBasis: STITCH_INCLUDED_CREDITS_DECLARATION,
      });
    if (result.result.status !== "complete") throw Error(result.result.reason);
    expect(result.result).toMatchObject({
      status: "complete",
      generationPerformed: false,
      evidence: { providerGeneration: "not_started", costStatus: "not_reported" },
    });
    expect(result.billing).toEqual({
      basis: STITCH_INCLUDED_CREDITS_DECLARATION,
      providerActualCost: "not_reported",
    });
    expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    expect(JSON.stringify(result)).not.toContain("synthetic_stitch_key");
    expect(JSON.stringify(result)).not.toContain("private_account_list");
  });
  test("wrong deployment refuses before any network request", async () => {
    stage();
    vi.stubEnv("CONVEX_CLOUD_URL", "https://production.convex.cloud");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const t = convexTest(schema, modules);
    await expect(
      t.action(makeFunctionReference<"action">("presenceDesignProbe:preflight"), {
        billingBasis: STITCH_INCLUDED_CREDITS_DECLARATION,
      }),
    ).rejects.toThrow("DEDICATED_STAGE_REQUIRED");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
