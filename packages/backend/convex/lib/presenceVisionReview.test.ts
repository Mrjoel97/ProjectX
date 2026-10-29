import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { sha256Bytes } from "@pikar/core/webRuntime";
import { beforeEach, expect, test, vi } from "vitest";
import { resolveModel } from "./models";
import { parsePresenceVisionVerdict, reviewPresenceVision } from "./presenceVisionReview";

vi.mock("./models", () => ({ resolveModel: vi.fn() }));
const plan = {
  version: 1,
  hero: "split",
  sectionLayout: "stacked",
  services: "rows",
  gallery: "grid",
  spacing: "relaxed",
  headingScale: "balanced",
  motion: "subtle",
} as const;
const page = { pageSlug: "home", fidelity: "pass", contrast: "pass", issues: [] };
const bytes = new Uint8Array([255, 216, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
let wire: Record<string, any>[];
let reply: unknown;
let cost: number | undefined;
let responseModel: string;
let finishReason: string;
beforeEach(() => {
  wire = [];
  reply = { pages: [page] };
  cost = 0.02;
  responseModel = "moonshotai/kimi-k3.1-pro";
  finishReason = "stop";
  vi.mocked(resolveModel).mockReturnValue(
    createOpenRouter({
      apiKey: "offline",
      fetch: async (_url, init) => {
        wire.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            id: "offline",
            model: responseModel,
            object: "chat.completion",
            created: 1,
            choices: [
              {
                index: 0,
                finish_reason: finishReason,
                message: { role: "assistant", content: JSON.stringify(reply) },
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
              cost,
              is_byok: false,
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    }).chat("moonshotai/kimi-k3.1-pro"),
  );
});
function input() {
  const runMutation = vi.fn(async (_f, a) =>
    a.reservationId ? { breached: false } : "reservation",
  );
  return {
    ctx: { runMutation } as never,
    tenantId: "ordinary-tenant",
    planId: "plan" as never,
    revision: 3,
    runRef: "1234567890abcdef",
    beforeCall: vi.fn(async () => {}),
    referenceImage: { bytes, mimeType: "image/jpeg" },
    screenshots: [1440, 390].map((viewportWidth) => ({
      pageSlug: "home",
      viewportWidth,
      reducedMotion: false,
      bytes,
      mimeType: "image/jpeg",
      sha256: sha256Bytes(bytes),
    })),
    pageSlugs: ["home"],
    layoutPlan: plan,
  };
}
test("observed alternate model is settled but never approves or retries", async () => {
  responseModel = "moonshotai/kimi-k3";
  const args = input();
  await expect(reviewPresenceVision(args)).rejects.toThrow("PRESENCE_VISION_MODEL_MISMATCH");
  expect(wire).toHaveLength(1);
  expect((args.ctx as any).runMutation).toHaveBeenCalledTimes(2);
});
test("truncated response cannot approve even when it contains complete valid JSON", async () => {
  finishReason = "length";
  const args = input();
  await expect(reviewPresenceVision(args)).rejects.toThrow("PRESENCE_VISION_OUTPUT_INCOMPLETE");
  expect(wire).toHaveLength(1);
  expect((args.ctx as any).runMutation).toHaveBeenCalledTimes(2);
});
test("real SDK serializes byte images through scoped paid admission and returns bound evidence", async () => {
  const args = input();
  const result = await reviewPresenceVision(args);
  expect(result.passed).toBe(true);
  expect(result.costUsd).toBe(0.02);
  expect(result.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  expect(args.beforeCall).toHaveBeenCalledOnce();
  expect(wire).toHaveLength(1);
  expect(wire[0]!.model).toBe("moonshotai/kimi-k3.1-pro");
  const parts = wire[0]!.messages[1].content;
  expect(parts.filter((p: any) => p.type === "image_url")).toHaveLength(3);
  expect(parts[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  expect((args.ctx as any).runMutation.mock.calls[0][1]).toMatchObject({
    tenantId: "ordinary-tenant",
    ceilingCents: 428,
    websiteDesign: { revision: 3 },
  });
  reply = { pages: [{ ...page, contrast: "uncertain", issues: ["Unreadable overlay"] }] };
  const uncertain = await reviewPresenceVision(input());
  expect(uncertain.passed).toBe(false);
  expect(uncertain.evidenceHash).not.toBe(result.evidenceHash);
});
test("missing, stale or duplicate screenshot evidence refuses before spending", async () => {
  for (const alter of [
    (a: ReturnType<typeof input>) => {
      a.screenshots.pop();
    },
    (a: ReturnType<typeof input>) => {
      a.screenshots[0]!.sha256 = "0".repeat(64);
    },
    (a: ReturnType<typeof input>) => {
      a.screenshots[1]!.viewportWidth = 1440;
    },
  ]) {
    const args = input();
    alter(args);
    await expect(reviewPresenceVision(args)).rejects.toThrow();
    expect(args.beforeCall).not.toHaveBeenCalled();
  }
  expect(wire).toHaveLength(0);
});
test("stale context and unknown paid cost never produce a pass or retry", async () => {
  const stale = input();
  stale.beforeCall.mockRejectedValue(new Error("stale"));
  await expect(reviewPresenceVision(stale)).rejects.toThrow("stale");
  expect(wire).toHaveLength(0);
  cost = undefined;
  const args = input();
  await expect(reviewPresenceVision(args)).rejects.toThrow("PAID_COST_UNKNOWN");
  expect(wire).toHaveLength(1);
  expect((args.ctx as any).runMutation).toHaveBeenCalledTimes(1);
});
test("closed verdict refuses omitted pages, invented fields and false passes", () => {
  for (const value of [
    { pages: [] },
    { pages: [page, page] },
    { pages: [{ ...page, contrast: "maybe" }] },
    { pages: [{ ...page, issues: ["defect"] }] },
    { pages: [{ ...page, fidelity: "fail" }] },
    { pages: [page], html: "unsafe" },
    { pages: [page], repair: { ...plan, css: "bad" } },
  ])
    expect(() => parsePresenceVisionVerdict(JSON.stringify(value), ["home"])).toThrow();
});
test("repair is a recommendation only and cannot approve the existing artifact", async () => {
  reply = { pages: [page], repair: { ...plan, hero: "overlay-left" } };
  const result = await reviewPresenceVision(input());
  expect(result.passed).toBe(false);
  expect(result.fidelityMatched).toBe(false);
});
