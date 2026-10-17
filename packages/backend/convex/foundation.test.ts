import {
  emptyFoundationProfile,
  FOUNDATION_TRANSCRIPT_TTL,
  renderFoundation,
} from "@pikar/core/foundation";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);
const rateModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const TENANT = "foundation_test";
function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateModules);
  return t;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("FOUNDATION_ONBOARDING_ENABLED", "1");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
const profile = {
  ...emptyFoundationProfile(),
  name: "Example",
  oneLineDescription: "We make useful things",
  offering: "Useful things",
};
const slots = {
  oneLineDescription: profile.oneLineDescription,
  headcount: 1,
  paidStaff: 0,
  yearsOperating: 0,
  funding: "bootstrapped" as const,
  revenueStage: "pre-revenue" as const,
};
async function complete(t: ReturnType<typeof setup>) {
  const asT = t.withIdentity({ subject: TENANT });
  await asT.mutation(api.foundation.begin, {});
  await t.mutation(internal.foundation.saveTurn, {
    tenantId: TENANT,
    revision: 0,
    profile,
    slots,
    answer: {
      section: "essentials",
      text: "We make useful things. I work alone, bootstrapped, pre-revenue, zero years.",
      intent: "current",
      eventId: "source_1",
    },
    reply: "Review your foundation.",
  });
  return asT;
}

test("resume is tenant scoped, and stale tabs cannot overwrite a newer draft", async () => {
  const t = setup();
  const a = await complete(t);
  const row = await a.query(api.foundation.get, {});
  expect(await a.mutation(api.foundation.begin, {})).toBe(row?._id);
  expect(await t.withIdentity({ subject: "other" }).query(api.foundation.get, {})).toBeNull();
  await expect(
    a.mutation(api.foundation.edit, { revision: 0, profile, answers: [] }),
  ).rejects.toThrow("STALE_INTERVIEW");
  expect((await a.query(api.foundation.get, {}))?.revision).toBe(1);
});

test("duplicate extraction receipt is idempotent even after revision advances", async () => {
  const t = setup();
  const a = await complete(t);
  const result = await t.mutation(internal.foundation.saveTurn, {
    tenantId: TENANT,
    revision: 0,
    profile,
    slots,
    answer: {
      section: "essentials",
      text: "Repeated transport delivery",
      intent: "current",
      eventId: "source_1",
    },
    reply: "Ignored",
  });
  expect(result).toBe(1);
  expect((await a.query(api.foundation.get, {}))?.answers).toHaveLength(1);
});

test("review is read only; explicit publication atomically creates six sources and a non-indexed Blueprint", async () => {
  const t = setup();
  const a = await complete(t);
  const review = await a.query(api.foundation.review, {});
  expect(review?.documents).toHaveLength(6);
  expect(await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toHaveLength(0);
  const published = await a.mutation(api.foundation.publish, {
    revision: 1,
    reviewHash: (await a.query(api.foundation.review, {}))?.reviewHash ?? "stale",
  });
  expect(published.docIds).toHaveLength(6);
  expect(
    await a.mutation(api.foundation.publish, {
      revision: 1,
      reviewHash: (await a.query(api.foundation.review, {}))?.reviewHash ?? "stale",
    }),
  ).toEqual(published);
  const docs = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
  expect(docs).toHaveLength(7);
  const blueprint = docs.find((x) => x.kind === "business_blueprint");
  expect(blueprint?.status).toBe("ready");
  expect(blueprint?.ragEntryId).toBeUndefined();
  const tier = await t.run((ctx) => ctx.db.query("tenantProfiles").first());
  expect(tier?.blueprintSourceDocIds).toEqual(published.docIds);
  expect(await a.query(api.foundation.history, {})).toHaveLength(1);
  await t.run(async (ctx) => {
    for (const id of published.docIds) await ctx.db.patch(id, { status: "failed" });
  });
  expect(await a.query(api.onboarding.status, {})).toEqual({ needsOnboarding: false });
});

test("editing invalidates approval and incomplete essentials cannot publish", async () => {
  const t = setup();
  const a = await complete(t);
  await a.mutation(api.foundation.edit, {
    revision: 1,
    profile: { ...profile, oneLineDescription: "" },
    answers: [],
  });
  await expect(
    a.mutation(api.foundation.publish, {
      revision: 1,
      reviewHash: (await a.query(api.foundation.review, {}))?.reviewHash ?? "stale",
    }),
  ).rejects.toThrow("STALE_INTERVIEW");
  await expect(
    a.mutation(api.foundation.publish, { revision: 2, reviewHash: "stale" }),
  ).rejects.toThrow("INCOMPLETE_ONBOARDING");
  expect(await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toHaveLength(0);
});

test.each([
  "correct",
  "remove",
  "planned",
] as const)("%s essentials clears extracted facts and blocks stale publication until reconfirmed", async (change) => {
  const t = setup();
  const a = await complete(t);
  const before = await a.query(api.foundation.get, {});
  const approval = await a.query(api.foundation.review, {});
  const answers = (before?.answers ?? []).map((answer) => ({
    ...answer,
    ...(change === "correct" ? { text: "We now have five people and three paid staff." } : {}),
    ...(change === "planned" ? { intent: "planned" as const } : {}),
  }));
  await a.mutation(api.foundation.edit, {
    revision: 1,
    profile,
    answers: change === "remove" ? [] : answers,
  });
  const edited = await a.query(api.foundation.get, {});
  expect(edited?.slots).toEqual({ oneLineDescription: profile.oneLineDescription });
  expect(edited?.phase).toBe("essential");
  expect(await a.query(api.foundation.review, {})).toBeNull();
  await expect(
    a.mutation(api.foundation.publish, { revision: 1, reviewHash: approval?.reviewHash ?? "" }),
  ).rejects.toThrow("STALE_INTERVIEW");
  await expect(
    a.mutation(api.foundation.publish, { revision: 2, reviewHash: approval?.reviewHash ?? "" }),
  ).rejects.toThrow("INCOMPLETE_ONBOARDING");
  expect(await t.run((ctx) => ctx.db.query("tenantProfiles").collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toEqual([]);
  await t.mutation(internal.foundation.saveTurn, {
    tenantId: TENANT,
    revision: 2,
    profile,
    slots: { ...slots, headcount: 5, paidStaff: 3 },
    answer: {
      section: "essentials",
      text: "Five people, three paid staff, pre-revenue, bootstrapped, zero years.",
      intent: "current",
      eventId: "reconfirmed",
    },
    reply: "Review the corrected facts.",
  });
  const review = await a.query(api.foundation.review, {});
  expect(review?.revision).toBe(3);
  expect((await a.query(api.foundation.get, {}))?.slots.headcount).toBe(5);
  await a.mutation(api.foundation.publish, { revision: 3, reviewHash: review?.reviewHash ?? "" });
  expect((await t.run((ctx) => ctx.db.query("tenantProfiles").first()))?.headcount).toBe(5);
});

test("editing enrichment preserves unchanged essential facts", async () => {
  const t = setup();
  const a = await complete(t);
  await t.mutation(internal.foundation.saveTurn, {
    tenantId: TENANT,
    revision: 1,
    profile,
    slots,
    answer: { section: "goals", text: "Sell locally", intent: "planned", eventId: "goal" },
    reply: "Saved",
  });
  const row = await a.query(api.foundation.get, {});
  await a.mutation(api.foundation.edit, {
    revision: 2,
    profile: { ...profile, name: "Corrected name" },
    answers: (row?.answers ?? []).map((answer) =>
      answer.section === "goals" ? { ...answer, text: "Sell nationally" } : answer,
    ),
  });
  expect((await a.query(api.foundation.get, {}))?.slots).toEqual(slots);
  expect((await a.query(api.foundation.get, {}))?.phase).toBe("enrichment");
  expect(await a.query(api.foundation.review, {})).not.toBeNull();
});

test.each([
  false,
  true,
])("planned essentials preserve current facts (complete: %s)", async (ready) => {
  const t = setup();
  const a = ready ? await complete(t) : t.withIdentity({ subject: TENANT });
  if (!ready) await a.mutation(api.foundation.begin, {});
  const before = await a.query(api.foundation.get, {});
  // No model configuration or fixture seam: planned statements must never invoke extraction.
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
  vi.stubEnv("PIKAR_OFFLINE_FIXTURES", "");
  const result = await a.action(api.foundation.answer, {
    revision: before?.revision ?? 0,
    eventId: "future_team",
    section: "essentials",
    intent: "planned",
    answer: "Next year we plan to have 100 staff and external funding.",
  });
  const after = await a.query(api.foundation.get, {});
  expect(after?.slots).toEqual(before?.slots);
  expect(after?.profile).toEqual(before?.profile);
  expect(after?.answers.at(-1)).toMatchObject({ eventId: "future_team", intent: "planned" });
  expect(result.complete).toBe(ready);
  expect(await t.run((ctx) => ctx.db.query("spendEvents").collect())).toEqual([]);
  const review = await a.query(api.foundation.review, {});
  if (ready) {
    expect(review?.documents[0]?.text).toContain("Intended future practice [source: future_team]");
    await a.mutation(api.foundation.publish, {
      revision: result.revision,
      reviewHash: review?.reviewHash ?? "",
    });
    expect((await t.run((ctx) => ctx.db.query("tenantProfiles").first()))?.headcount).toBe(1);
  } else {
    expect(review).toBeNull();
    await expect(
      a.mutation(api.foundation.publish, { revision: result.revision, reviewHash: "" }),
    ).rejects.toThrow("INCOMPLETE_ONBOARDING");
  }
});

test("duplicate edited statement IDs cannot hide corrected essentials behind an unchanged copy", async () => {
  const t = setup();
  const a = await complete(t);
  const before = await a.query(api.foundation.get, {});
  const original = before?.answers[0];
  if (!original) throw new Error("Missing test statement");
  await expect(
    a.mutation(api.foundation.edit, {
      revision: 1,
      profile,
      answers: [original, { ...original, text: "Actually we have 100 paid staff." }],
    }),
  ).rejects.toThrow("INVALID_DRAFT");
  expect(await a.query(api.foundation.get, {})).toEqual(before);
  expect(await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toEqual([]);
});

test.each([
  "edit",
  "remove",
  "current",
] as const)("planned essentials %s only invalidate facts when promoted to current", async (change) => {
  const t = setup();
  const a = await complete(t);
  await a.action(api.foundation.answer, {
    revision: 1,
    eventId: "future",
    section: "essentials",
    intent: "planned",
    answer: "We plan to hire 100 people.",
  });
  const before = await a.query(api.foundation.get, {});
  const answers = (before?.answers ?? []).flatMap((answer) => {
    if (answer.eventId !== "future") return [answer];
    if (change === "remove") return [];
    return [
      {
        ...answer,
        text: "We plan to hire 50 people.",
        intent: change === "current" ? ("current" as const) : ("planned" as const),
      },
    ];
  });
  await a.mutation(api.foundation.edit, { revision: 2, profile, answers });
  const after = await a.query(api.foundation.get, {});
  expect(after?.slots).toEqual(
    change === "current" ? { oneLineDescription: profile.oneLineDescription } : slots,
  );
  expect(after?.phase).toBe(change === "current" ? "essential" : "enrichment");
  const review = await a.query(api.foundation.review, {});
  if (change === "current") expect(review).toBeNull();
  else expect(review).not.toBeNull();
});

test("transcript retry cannot extend retention and expiry preserves accepted draft answers", async () => {
  const t = setup();
  const a = await complete(t);
  const now = Date.now();
  await a.mutation(api.foundation.checkpoint, {
    eventId: "turn_1",
    text: "temporary voice text",
    speaker: "user",
  });
  vi.setSystemTime(now + 1000);
  await a.mutation(api.foundation.checkpoint, {
    eventId: "turn_1",
    text: "duplicate",
    speaker: "user",
  });
  const rows = await t.run((ctx) => ctx.db.query("foundationTranscripts").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]?.expiresAt).toBe(now + FOUNDATION_TRANSCRIPT_TTL);
  vi.setSystemTime(now + FOUNDATION_TRANSCRIPT_TTL + 1);
  expect(await t.mutation(internal.foundation.purgeTranscripts, {})).toBe(1);
  expect((await a.query(api.foundation.get, {}))?.answers).toHaveLength(1);
});

test("deterministic documents label plans and preserve unknowns without inventing facts", () => {
  const docs = renderFoundation({ ...profile, persona: "solopreneur" }, [
    {
      section: "operations",
      text: "Hire an assistant next year",
      intent: "planned",
      eventId: "plan_1",
    },
  ]);
  expect(docs).toHaveLength(6);
  expect(docs[2]?.text).toContain("Intended future practice [source: plan_1]");
  expect(docs[3]?.text).toContain("unknown");
  expect(docs[0]?.text).toContain("**Persona:** solopreneur");
});

test("foreign tenant cannot publish or read another foundation via revision number", async () => {
  const t = setup();
  await complete(t);
  const other = t.withIdentity({ subject: "other" });
  await expect(
    other.mutation(api.foundation.publish, { revision: 1, reviewHash: "stale" }),
  ).rejects.toThrow("STALE_INTERVIEW");
  expect(await other.query(api.foundation.history, {})).toEqual([]);
  expect(await other.query(api.foundation.publication, {})).toEqual([]);
});

test("approval rejects an externally changed Blueprint even when interview revision is unchanged", async () => {
  const t = setup();
  const a = await complete(t);
  const review = await a.query(api.foundation.review, {});
  await a.mutation(api.tenantProfile.saveFacts, {
    headcount: 1,
    paidStaff: 0,
    revenueStage: "pre-revenue",
    funding: "bootstrapped",
    yearsOperating: 0,
  });
  await t.run(async (ctx) => {
    const row = await ctx.db.query("tenantProfiles").first();
    if (row) await ctx.db.patch(row._id, { tier: "enterprise", tierSource: "admin" });
  });
  await expect(
    a.mutation(api.foundation.publish, {
      revision: 1,
      reviewHash: review?.reviewHash ?? "missing",
    }),
  ).rejects.toThrow("STALE_REVIEW");
  expect(await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toHaveLength(0);
});

test("discard after publication restores approved sources instead of orphaning or duplicating them", async () => {
  const t = setup();
  const a = await complete(t);
  const review = await a.query(api.foundation.review, {});
  const published = await a.mutation(api.foundation.publish, {
    revision: 1,
    reviewHash: review?.reviewHash ?? "missing",
  });
  await a.mutation(api.foundation.edit, {
    revision: 1,
    profile: { ...profile, name: "Unapproved name" },
    answers: [],
  });
  await a.mutation(api.foundation.discard, { revision: 2 });
  const restored = await a.query(api.foundation.get, {});
  expect(restored?.profile.name).toBe("Example");
  expect(restored?.docIds).toEqual(published.docIds);
  expect(restored?.publishedRevision).toBe(restored?.revision);
  expect(await t.run((ctx) => ctx.db.query("vaultDocuments").collect())).toHaveLength(7);
});

test("enrichment republishes stable document IDs and queues content-versioned cleanup", async () => {
  const t = setup();
  const a = await complete(t);
  const firstReview = await a.query(api.foundation.review, {});
  const first = await a.mutation(api.foundation.publish, {
    revision: 1,
    reviewHash: firstReview?.reviewHash ?? "missing",
  });
  await t.run(async (ctx) => {
    for (const id of first.docIds) await ctx.db.patch(id, { status: "ready" });
  });
  const row = await a.query(api.foundation.get, {});
  await a.mutation(api.foundation.edit, {
    revision: 1,
    profile: { ...profile, offering: "Updated offering" },
    answers: row?.answers ?? [],
  });
  const review = await a.query(api.foundation.review, {});
  const second = await a.mutation(api.foundation.publish, {
    revision: 2,
    reviewHash: review?.reviewHash ?? "missing",
  });
  expect(second.docIds).toEqual(first.docIds);
  const docs = await t.run((ctx) => ctx.db.query("vaultDocuments").collect());
  expect(docs).toHaveLength(7);
  for (const doc of docs.filter((x) => x.kind !== "business_blueprint")) {
    expect(doc.graphCleanupHash).toBe(doc.contentHash);
    expect(doc.status).toBe("processing");
    expect(doc.ragEntryId).toBeUndefined();
  }
  expect(await a.query(api.foundation.history, {})).toHaveLength(2);
  const audits = await t.run((ctx) => ctx.db.query("audit").collect());
  expect(JSON.stringify(audits)).not.toContain("Updated offering");
});

test.each([
  "0",
  undefined,
])("disabled foundation (%s) rejects direct writes and paid work but permits reads and discard", async (flag) => {
  const t = setup();
  const a = await complete(t);
  const before = await a.query(api.foundation.get, {});
  vi.stubEnv("FOUNDATION_ONBOARDING_ENABLED", flag);
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  try {
    expect(await a.query(api.foundation.enabled, {})).toBe(false);
    for (const attempt of [
      () => a.mutation(api.foundation.begin, {}),
      () => a.mutation(api.foundation.edit, { revision: 1, profile, answers: [] }),
      () =>
        a.mutation(api.foundation.checkpoint, { eventId: "off", text: "Private", speaker: "user" }),
      () => a.mutation(api.foundation.publish, { revision: 1, reviewHash: "unused" }),
      () =>
        a.action(api.foundation.answer, {
          revision: 1,
          eventId: "paid_off",
          answer: "More details",
          section: "essentials",
          intent: "current",
        }),
      () =>
        t.mutation(internal.foundation.saveTurn, {
          tenantId: TENANT,
          revision: 1,
          profile,
          slots,
          answer: {
            section: "essentials",
            text: "Late answer",
            intent: "current",
            eventId: "late",
          },
          reply: "Late",
        }),
    ])
      await expect(attempt()).rejects.toThrow("FOUNDATION_ONBOARDING_DISABLED");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await a.query(api.foundation.get, {})).toEqual(before);
    expect(
      await t.run(async (ctx) => (await ctx.db.query("foundationTranscripts").collect()).length),
    ).toBe(0);
    await a.mutation(api.foundation.discard, { revision: 1 });
    expect(await a.query(api.foundation.get, {})).toBeNull();
  } finally {
    fetchSpy.mockRestore();
  }
});
