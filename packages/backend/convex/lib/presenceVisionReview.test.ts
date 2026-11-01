import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  APPROVED_FIELDWORK_REFERENCE,
  getApprovedPresenceReferenceIdentity,
} from "@pikar/contracts/approvedPresenceReference";
import { presenceDesignPolicySkillBody } from "@pikar/contracts/skills/presenceDesignPolicy";
import { sha256Bytes } from "@pikar/core/webRuntime";
import { beforeEach, expect, test, vi } from "vitest";
import { loadApprovedPresenceReference } from "./approvedPresenceReference";
import { resolveModel } from "./models";
import {
  parsePresenceVisionVerdict,
  presenceContentInventory,
  reviewPresenceVision,
} from "./presenceVisionReview";

vi.mock("./approvedPresenceReference", () => ({ loadApprovedPresenceReference: vi.fn() }));
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
  vi.mocked(loadApprovedPresenceReference).mockReset();
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
    ctx: {
      runMutation,
      runQuery: vi.fn(async () => ({
        body: presenceDesignPolicySkillBody,
        version: 1,
        skillId: "policy",
      })),
    } as never,
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
  expect(wire[0]!.max_tokens).toBe(4096);
  const parts = wire[0]!.messages[1].content;
  expect(parts.filter((p: any) => p.type === "image_url")).toHaveLength(3);
  expect(parts[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  expect((args.ctx as any).runMutation.mock.calls[0][1]).toMatchObject({
    tenantId: "ordinary-tenant",
    ceilingCents: 424,
    websiteDesign: { revision: 3, purpose: "vision-review" },
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
  expect(prompt.supportedLayoutPlan.version).toBe(3);
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

test("missing registry policy refuses before paid admission or provider generation", async () => {
  const args = input();
  const ctx = args.ctx as unknown as {
    runQuery: ReturnType<typeof vi.fn>;
    runMutation: ReturnType<typeof vi.fn>;
  };
  ctx.runQuery.mockRejectedValueOnce(new Error("NO_ACTIVE_SKILL: presence-design-policy"));
  await expect(reviewPresenceVision(args)).rejects.toThrow("NO_ACTIVE_SKILL");
  expect(ctx.runQuery).toHaveBeenCalledOnce();
  expect(args.beforeCall).not.toHaveBeenCalled();
  expect(ctx.runMutation).not.toHaveBeenCalled();
  expect(wire).toHaveLength(0);
});

test.each([
  "not-json",
  "null",
  "[]",
  JSON.stringify({ vision: "incomplete" }),
  JSON.stringify({ ...JSON.parse(presenceDesignPolicySkillBody), vision: " " }),
])("invalid registry policy refuses before paid generation: %s", async (body) => {
  const args = input();
  const ctx = args.ctx as unknown as {
    runQuery: ReturnType<typeof vi.fn>;
    runMutation: ReturnType<typeof vi.fn>;
  };
  ctx.runQuery.mockResolvedValueOnce({ body, version: 2, skillId: "policy" });
  await expect(reviewPresenceVision(args)).rejects.toThrow("PRESENCE_POLICY_INVALID");
  expect(args.beforeCall).not.toHaveBeenCalled();
  expect(ctx.runMutation).not.toHaveBeenCalled();
  expect(wire).toHaveLength(0);
});

test("v3 review and repair refuse foreign document references without silently dropping them", async () => {
  const args = input();
  const designTokens = {
    colors: {
      paper: "#ffffff",
      card: "#ffffff",
      ink: "#111111",
      muted: "#555555",
      accent: "#222222",
      rule: "#dddddd",
    },
    typography: { heading: "humanist-sans", body: "humanist-sans" },
    spacing: { contentWidth: 1200, sectionGap: 64, copyMeasure: 60, heroMinHeight: 480 },
    footer: "light",
  } as const;
  const valid = { ...plan, version: 3, designTokens, sections: [] } as const;
  const foreign = {
    ...valid,
    sections: [{ pageSlug: "foreign", nodeId: "about", composition: "editorial-lead" }],
  } as const;
  await expect(
    reviewPresenceVision({ ...args, layoutPlan: { ...foreign, sections: [...foreign.sections] } }),
  ).rejects.toThrow("PRESENCE_VISION_INPUT_INVALID");
  expect(wire).toHaveLength(0);
  expect(() =>
    parsePresenceVisionVerdict(
      JSON.stringify({ pages: [page], repair: valid }),
      ["home"],
      args.authoritativeDocument,
    ),
  ).not.toThrow();
  expect(() =>
    parsePresenceVisionVerdict(
      JSON.stringify({ pages: [page], repair: foreign }),
      ["home"],
      args.authoritativeDocument,
    ),
  ).toThrow("PRESENCE_VISION_OUTPUT_INVALID");
  expect(() =>
    parsePresenceVisionVerdict(JSON.stringify({ pages: [page], repair: valid }), ["home"]),
  ).toThrow("PRESENCE_VISION_OUTPUT_INVALID");
});

test("selected reference is independently supplied alongside Stitch and bound into vision evidence", async () => {
  const args = input(),
    identity = getApprovedPresenceReferenceIdentity("fieldwork-v1")!;
  const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  vi.mocked(loadApprovedPresenceReference).mockResolvedValue({
    identity,
    html: "PINNED_APPROVED_REFERENCE",
    desktopImage: {
      bytes: image,
      mimeType: "image/png",
      sha256: APPROVED_FIELDWORK_REFERENCE.desktop.sha256,
    },
    mobileImage: {
      bytes: image,
      mimeType: "image/png",
      sha256: APPROVED_FIELDWORK_REFERENCE.mobile.sha256,
    },
  });
  const ordinary = await reviewPresenceVision(args);
  expect(loadApprovedPresenceReference).not.toHaveBeenCalled();
  const selected = await reviewPresenceVision({
    ...input(),
    approvedDesignReference: {
      manifestHash: identity.manifestHash,
      id: identity.id,
      revision: identity.revision,
    },
  });
  expect(selected.evidenceHash).not.toBe(ordinary.evidenceHash);
  const content = (wire[1]!.messages as any[]).flatMap((message) =>
    Array.isArray(message.content) ? message.content : [],
  );
  expect(JSON.stringify(content)).toContain("PINNED_APPROVED_REFERENCE");
  expect(JSON.stringify(content)).toContain("BOTH");
  expect(content.filter((item: any) => item.type === "image_url")).toHaveLength(5);
});
test("unavailable selected reference blocks visual review before any paid admission", async () => {
  const args = input();
  vi.mocked(loadApprovedPresenceReference).mockRejectedValue(Error("REFERENCE_HASH_MISMATCH"));
  await expect(
    reviewPresenceVision({
      ...args,
      approvedDesignReference: getApprovedPresenceReferenceIdentity("fieldwork-v1")!,
    }),
  ).rejects.toThrow("REFERENCE_HASH_MISMATCH");
  expect(wire).toHaveLength(0);
  expect((args.ctx as any).runMutation).not.toHaveBeenCalled();
});

test("inventory preserves explicit hero heading identities without adding IDs to legacy heroes", () => {
  const document = input().authoritativeDocument;
  const ordinary = presenceContentInventory(document, ["home"]);
  expect(JSON.stringify(ordinary)).not.toContain('"id":"page-hero"');
  const withHeroId = {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      nodes: page.nodes.map((node) => ({ ...node, id: "page-hero" })),
    })),
  };
  const inventory = presenceContentInventory(withHeroId, ["home"]);
  expect(JSON.stringify(inventory)).toContain('"id":"page-hero"');
});
