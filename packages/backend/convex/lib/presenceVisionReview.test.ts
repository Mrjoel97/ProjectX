import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { sha256Bytes } from "@pikar/core/webRuntime";
import { beforeEach, expect, test, vi } from "vitest";
import { resolveModel } from "./models";
import {
  parsePresenceVisionVerdict,
  presenceContentInventory,
  reviewPresenceVision,
} from "./presenceVisionReview";

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
    authoritativeDocument: {
      kind: "site",
      title: "Customer studio",
      brand: { name: "Customer studio" },
      navigation: [{ label: "Home", path: "/home" }],
      pages: [
        {
          slug: "home",
          title: "Home",
          nodes: [
            { kind: "hero", heading: "Customer-owned heading", body: "Design for local shops." },
          ],
        },
      ],
    },
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
test("actual SDK prompt grounds fidelity in canonical content and separates contrast judgment", async () => {
  const args = input();
  const first = await reviewPresenceVision(args);
  const prompt = JSON.parse(wire[0]!.messages[1].content[0].text);
  expect(prompt.supportedLayoutPlan.version).toBe(2);
  expect(prompt.supportedLayoutPlan.designTokens.footer).toEqual(["light", "dark"]);
  expect(prompt.authoritativeInventory.pages[0].nodes[0].heading).toBe("Customer-owned heading");
  expect(prompt.authoritativeInventory.navigationLabels).toEqual(["Home"]);
  expect(JSON.stringify(prompt.authoritativeInventory)).not.toContain("/home");
  expect(wire[0]!.messages[0].content[0].text).toContain(
    "Never demand or introduce reference-only facts",
  );
  expect(wire[0]!.messages[0].content[0].text).toContain(
    "Judge contrast independently from fidelity",
  );
  args.authoritativeDocument.pages[0]!.nodes[0]!.body =
    "Updated source-authorized business description.";
  const second = await reviewPresenceVision(args);
  expect(second.evidenceHash).not.toBe(first.evidenceHash);
});
test("missing or mismatched content authority refuses before paid admission", async () => {
  for (const document of [undefined, {}, { ...input().authoritativeDocument, pages: [] }]) {
    const args = { ...input(), authoritativeDocument: document };
    await expect(reviewPresenceVision(args)).rejects.toThrow("PRESENCE_VISION_CONTENT_INVALID");
    expect(args.beforeCall).not.toHaveBeenCalled();
    expect((args.ctx as any).runMutation).not.toHaveBeenCalled();
  }
  expect(wire).toHaveLength(0);
});
test("inventory retains nested source content and functional form requirements without routing metadata", () => {
  const document = input().authoritativeDocument;
  const inventory = presenceContentInventory(
    {
      ...document,
      pages: [
        {
          ...document.pages[0],
          nodes: [
            {
              kind: "section",
              id: "practice",
              heading: "Our practice",
              children: [
                { kind: "text", text: "Only source-supported services." },
                {
                  kind: "cta",
                  id: "inquire",
                  label: "Discuss a project",
                  target: { kind: "https", url: "https://example.com/private-destination" },
                },
                {
                  kind: "form",
                  id: "inquiry",
                  fields: ["email", "name"],
                  consent: "I agree to be contacted.",
                  attribution: { campaign: "private-tracking-id" },
                },
              ],
            },
          ],
        },
      ],
    },
    ["home"],
  );
  const serialized = JSON.stringify(inventory);
  expect(serialized).toContain("Only source-supported services.");
  expect(serialized).toContain('"fields":["email","name"]');
  expect(serialized).not.toContain("private-destination");
  expect(serialized).not.toContain("private-tracking-id");
});
test("oversized authoritative inventory refuses without silently dropping source content", async () => {
  const args = input();
  const document = {
    ...args.authoritativeDocument,
    pages: [
      {
        ...args.authoritativeDocument.pages[0],
        nodes: Array.from({ length: 13 }, () => ({ kind: "text", text: "x".repeat(4000) })),
      },
    ],
  };
  await expect(reviewPresenceVision({ ...args, authoritativeDocument: document })).rejects.toThrow(
    "PRESENCE_VISION_CONTENT_LIMIT",
  );
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
