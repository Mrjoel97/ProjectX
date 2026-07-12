// The cockpit body-draft seam (draftCockpit) — DECISION #2 + RESEARCH §6 + CLAUDE.md §5/§4.
//
// draftCockpit lives INSIDE llm.ts (the only "use node" module) and drafts a subject +
// body from ALREADY-REDACTED text. These tests prove the three contracts that matter
// offline (no AI_GATEWAY_API_KEY): (a) the drafter body comes from the registry, not a
// hardcoded string; (b) the SMOKE:: sentinel returns a deterministic draft with NO model
// call; (c) the draft path writes NO raw content to the audit log (redaction-safe).
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

// convex-test discovers Convex modules (and auto-registers components declared in
// convex.config.ts) via import.meta.glob; exclude the tests. Same form as audit.test.ts
// so the auditCounts aggregate component the draft's llm.called write touches is registered.
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const SMOKE = "SMOKE::route=direct_llm::";

test("draftCockpit loads the email-drafter body from the registry (fails closed unseeded)", async () => {
  const t = convexTest(schema, modules);
  // No seedSkills → no active email-drafter row. A registry-backed drafter fails closed
  // (NO_ACTIVE_SKILL); a hardcoded prompt would never consult the registry and would not throw.
  await expect(
    t.action(internal.llm.draftCockpit, {
      tenantId: "t1",
      safeText: `${SMOKE}x`,
      safeTextHash: "h",
    }),
  ).rejects.toThrow();

  // Seeded → the same SMOKE input now succeeds, so the body genuinely came from the registry.
  await t.mutation(internal.skills.seedSkills, {});
  const ok = await t.action(internal.llm.draftCockpit, {
    tenantId: "t1",
    safeText: `${SMOKE}x`,
    safeTextHash: "h",
  });
  expect(ok.subject).toBe("Smoke Subject");
});

test("SMOKE:: returns the deterministic draft offline (no model call)", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.skills.seedSkills, {});
  const res = await t.action(internal.llm.draftCockpit, {
    tenantId: "t1",
    safeText: `${SMOKE}goal`,
    safeTextHash: "abc123",
  });
  // Deterministic offline draft — reaching a real model would throw/hang without a gateway key.
  expect(res.subject).toBe("Smoke Subject");
  expect(res.body).toContain("abc123");
});

test("draft path writes no raw content to any log (redaction-safe by construction)", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.skills.seedSkills, {});
  const MARKER = "RAW_MARKER_should_never_be_logged_9f8e7d";
  const res = await t.action(internal.llm.draftCockpit, {
    tenantId: "t1",
    safeText: `${SMOKE}${MARKER}`,
    safeTextHash: "hashonly",
  });
  // The seam emits NO audit/telemetry itself (the caller owns correlation-scoped logging),
  // so no raw input can ever reach a log from this path — redaction-safe by construction.
  const audit = await t.run((ctx) => ctx.db.query("audit").collect());
  expect(audit).toHaveLength(0);
  // And the returned draft carries no raw input marker back to the caller.
  expect(JSON.stringify(res)).not.toContain(MARKER);
});
