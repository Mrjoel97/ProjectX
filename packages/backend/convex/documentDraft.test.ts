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
import { internal } from "./_generated/api";
import schema from "./schema";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const SMOKE = "SMOKE::route=direct_llm::";

test("draftDocument loads the document-drafter body from the registry (fails closed unseeded)", async () => {
  const t = convexTest(schema, modules);
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
  expect(ok.title).toBe("Smoke Document");
});

// SC7b (Phase 18 / ACTN-04). The `content-drafter` row exists since 18-03 but nothing could LOAD
// it until draftDocument grew a skillName argument — the withheld-tool shape this phase exists to
// avoid. These two rows pin the reach and the fail-closed contract it inherits.
test("draftDocument({ skillName: content-drafter }) reaches the new row (fails closed unseeded)", async () => {
  const t = convexTest(schema, modules);
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
  expect(ok.title).toBe("Smoke Document");
});

// The discriminator: with BOTH rows seeded, archiving ONLY content-drafter must break ONLY the
// skillName call. Under the pre-18-05 hardcoded name this test is red — which is the whole point.
test("skillName selects the row; omitting it still loads document-drafter", async () => {
  const t = convexTest(schema, modules);
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
  expect(ok.title).toBe("Smoke Document");
});

test("SMOKE:: returns a deterministic { title, markdown } offline (no model call), tokenizer-shaped", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.skills.seedSkills, {});
  const res = await t.action(internal.llm.draftDocument, {
    tenantId: "t1",
    safeText: `${SMOKE}goal`,
    safeTextHash: "abc123",
  });
  // Deterministic offline document — a real model would throw/hang without a gateway key.
  expect(res.markdown).toContain("abc123");
  // The markdown feeds markdownToPdf via tokenizeMarkdown → must produce a heading + paragraph.
  const tokens = tokenizeMarkdown(res.markdown);
  expect(tokens[0]).toEqual({ kind: "h1", text: "Smoke Document" });
  expect(tokens.some((tk) => tk.kind === "para")).toBe(true);
});
