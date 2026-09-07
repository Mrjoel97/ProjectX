// The document-drafting seam (draftDocument, CKPT-02) — mirrors cockpitDraft.test.ts.
//
// draftDocument lives INSIDE llm.ts (the only "use node" module) and drafts a { title, markdown }
// from ALREADY-REDACTED text. These offline tests prove: (a) the drafter body comes from the
// registry (fails closed unseeded — no hardcoded prompt, §5); (b) the SMOKE:: sentinel returns a
// deterministic document with NO model call; (c) the returned markdown is tokenizer-shaped.
import { CONTENT_DRAFTER_SKILL } from "@pikar/contracts/skill";
import { tokenizeMarkdown } from "@pikar/core";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const rateLimiterModules = import.meta.glob(
  "../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts",
);
const aggregateModules = import.meta.glob(
  "../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts",
);

// 43-02: `draftDocument` now asks `guardrails.preCall` before it drafts, and preCall reaches the
// rate-limiter component — so every test in this file needs it registered, not only the two that
// assert a refusal. `blueprint.test.ts` is the shipped idiom this copies.
const makeTest = () => {
  const t = convexTest(schema, modules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
};

const SMOKE = "SMOKE::route=direct_llm::";

test("draftDocument loads the document-drafter body from the registry (fails closed unseeded)", async () => {
  const t = makeTest();
  // No seedSkills → no active document-drafter row. A registry-backed drafter fails closed
  // (NO_ACTIVE_SKILL); a hardcoded prompt would never consult the registry and would not throw.
  await expect(
    t.action(internal.llm.draftDocument, {
      tenantId: "t1",
      safeText: `${SMOKE}x`,
      safeTextHash: "h",
    }),
  ).rejects.toThrow();

  // Seeded → the same SMOKE input now succeeds, so the body genuinely came from the registry.
  await t.mutation(internal.skills.seedSkills, {});
  const ok = await t.action(internal.llm.draftDocument, {
    tenantId: "t1",
    safeText: `${SMOKE}x`,
    safeTextHash: "h",
  });
  if (!ok.ok) throw new Error(`draftDocument refused: ${ok.reason}`);
  expect(ok.title).toBe("Smoke Document");
});

// SC7b (Phase 18 / ACTN-04). The `content-drafter` row exists since 18-03 but nothing could LOAD
// it until draftDocument grew a skillName argument — the withheld-tool shape this phase exists to
// avoid. These two rows pin the reach and the fail-closed contract it inherits.
test("draftDocument({ skillName: content-drafter }) reaches the new row (fails closed unseeded)", async () => {
  const t = makeTest();
  await expect(
    t.action(internal.llm.draftDocument, {
      tenantId: "t1",
      safeText: `${SMOKE}x`,
      safeTextHash: "h",
      skillName: CONTENT_DRAFTER_SKILL,
    }),
  ).rejects.toThrow();

  await t.mutation(internal.skills.seedSkills, {});
  const ok = await t.action(internal.llm.draftDocument, {
    tenantId: "t1",
    safeText: `${SMOKE}x`,
    safeTextHash: "h",
    skillName: CONTENT_DRAFTER_SKILL,
  });
  if (!ok.ok) throw new Error(`draftDocument refused: ${ok.reason}`);
  expect(ok.title).toBe("Smoke Document");
});

// The discriminator: with BOTH rows seeded, archiving ONLY content-drafter must break ONLY the
// skillName call. Under the pre-18-05 hardcoded name this test is red — which is the whole point.
test("skillName selects the row; omitting it still loads document-drafter", async () => {
  const t = makeTest();
  await t.mutation(internal.skills.seedSkills, {});
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("skills")
      .withIndex("by_name_status", (q) =>
        q.eq("name", CONTENT_DRAFTER_SKILL).eq("status", "active"),
      )
      .unique();
    await ctx.db.patch(row!._id, { status: "archived" });
  });

  await expect(
    t.action(internal.llm.draftDocument, {
      tenantId: "t1",
      safeText: `${SMOKE}x`,
      safeTextHash: "h",
      skillName: CONTENT_DRAFTER_SKILL,
    }),
  ).rejects.toThrow(/NO_ACTIVE_SKILL: content-drafter/);

  // Default path untouched: document-drafter is still active and still what an argument-less call loads.
  const ok = await t.action(internal.llm.draftDocument, {
    tenantId: "t1",
    safeText: `${SMOKE}x`,
    safeTextHash: "h",
  });
  if (!ok.ok) throw new Error(`draftDocument refused: ${ok.reason}`);
  expect(ok.title).toBe("Smoke Document");
});

test("SMOKE:: returns a deterministic { title, markdown } offline (no model call), tokenizer-shaped", async () => {
  const t = makeTest();
  await t.mutation(internal.skills.seedSkills, {});
  const res = await t.action(internal.llm.draftDocument, {
    tenantId: "t1",
    safeText: `${SMOKE}goal`,
    safeTextHash: "abc123",
  });
  if (!res.ok) throw new Error(`draftDocument refused: ${res.reason}`);
  // Deterministic offline document — a real model would throw/hang without a gateway key.
  expect(res.markdown).toContain("abc123");
  // The markdown feeds markdownToPdf via tokenizeMarkdown → must produce a heading + paragraph.
  const tokens = tokenizeMarkdown(res.markdown);
  expect(tokens[0]).toEqual({ kind: "h1", text: "Smoke Document" });
  expect(tokens.some((tk) => tk.kind === "para")).toBe(true);
});

// ── 43-02: the money rail ─────────────────────────────────────────────────────────────────────
//
// `draftDocument` ran TWO fully-billed generateObject calls with no `preCall` ahead of them and no
// `recordSpend` after — the last unmetered paid call reachable from the cockpit, about to be
// multiplied by MAX_FAN_OUT by the Phase-43 batch.
//
// The SECOND half of this test is the one that matters. Asserting the kill switch only proves the
// gate is CALLED; asserting the budget proves the gate reads the same window `recordSpend` writes
// to. A guard wired to a window nothing moves is a guard that can never fire.
// SPLIT INTO TWO tests on purpose. Asserting both refusals in one body means the run dies on the
// first `expect` and never reaches the second, so a mutation that neutralises the gate reddens ONE
// assertion and the budget half is never independently proven — a check that cannot fail.
test("draftDocument returns the kill-switch refusal as a governed stop, never a throw", async () => {
  const t = makeTest();
  await t.mutation(internal.skills.seedSkills, {});
  await t.mutation(internal.guardrails.setKillSwitch, { on: true });
  // RESOLVES, never rejects. `createDocument`'s catch turns a throw into "offer to try again" —
  // the one instruction an exhausted rail must never send back to the agent.
  await expect(
    t.action(internal.llm.draftDocument, {
      tenantId: "t1",
      safeText: `${SMOKE}x`,
      safeTextHash: "h",
    }),
  ).resolves.toEqual({ ok: false, reason: "kill_switch" });
});

// THE ONE THAT MATTERS. The kill switch only proves the gate is CALLED; this proves it reads the
// same window `recordSpend` writes to. A guard wired to a window nothing moves can never fire.
test("draftDocument refuses once the tenant's daily budget is spent", async () => {
  const t = makeTest();
  await t.mutation(internal.skills.seedSkills, {});
  await t.mutation(internal.guardrails.recordSpend, { tenantId: "t1", costUsd: 10 });
  await expect(
    t.action(internal.llm.draftDocument, {
      tenantId: "t1",
      safeText: `${SMOKE}x`,
      safeTextHash: "h",
    }),
  ).resolves.toEqual({ ok: false, reason: "daily_budget_exhausted" });
});

// NON-VACUITY for the pair above: an unspent tenant still drafts. Without this, deleting the smoke
// short-circuit (or gating every path) would leave the two refusals green over a dead action.
test("an unspent tenant still drafts offline, so the gate is not refusing everything", async () => {
  const t = makeTest();
  await t.mutation(internal.skills.seedSkills, {});
  const res = await t.action(internal.llm.draftDocument, {
    tenantId: "t1",
    safeText: `${SMOKE}x`,
    safeTextHash: "h",
  });
  expect(res.ok).toBe(true);
});
