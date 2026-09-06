// SC#4 / CLAUDE.md §4 redaction-boundary scan for the onboarding flow (onboarding.ts).
//
// The profile `text` is vault CONTENT (it lives on the vaultDocuments row + rag chunks by design).
// The GOVERNANCE boundary is the LOG plane: no audit / telemetry / deadLetters row written during a
// commit or an edit may carry profile prose or a field VALUE — those payloads are refs/hashes/ids/
// counts/booleans ONLY. This test drives a real commit + edit with a fixture whose every field is a
// recognizable sentinel, then reads EVERY row of the three log tables and asserts no sentinel (nor the
// serialized profile prose) leaked. Mirrors llmRedaction / auditImmutability: a structural guard, so a
// future edit that starts logging a field value fails here instead of shipping a PII honeypot.
import type { ProfileInput } from "@pikar/core";
import { serializeProfile } from "@pikar/core";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { api } from "./_generated/api";
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

const TENANT = "tenant_redaction";

// 36-01: a stub, not a raw assignment — the raw form leaked the key into later files in the worker,
// and a leaked key now closes every `SMOKE::` gate downstream (`fixtureSeamFor`).
afterEach(() => vi.unstubAllEnvs());

function setup(): TestConvex<typeof schema> {
  vi.stubEnv("OPENAI_API_KEY", "sk-redaction-test-key");
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  return t;
}

const asTenant = (t: TestConvex<typeof schema>) => t.withIdentity({ subject: TENANT });

// Every FREE-TEXT field is a unique sentinel. If any sentinel appears in a log payload, redaction
// failed. Phase 15.1 (SC#4b) adds the TIER FACTS: `agentName` is free text, and `revenueStage` /
// `funding` are business-sensitive closed enums — a tenant's staffing and revenue posture is
// precisely what §4 exists to keep out of the log.
const SENTINELS = [
  "ACME_SENTINEL",
  "DESC_SENTINEL",
  "STAGE_SENTINEL",
  "OFFERING_SENTINEL",
  "CUSTOMER_SENTINEL",
  "GOAL_SENTINEL",
  "CONSTRAINT_SENTINEL",
  "EDITED_OFFERING_SENTINEL",
  "AGENTNAME_SENTINEL",
  "steady-revenue",
  "bootstrapped",
];

// The NUMERIC tier facts. Deliberately all > 8 so they cannot collide with a legitimate payload
// count (`fieldCount` maxes at 7, `factsChanged` at 5) — a needle that a truthful payload could
// carry would make the assertion untestable rather than strict.
const FACT_NUMBERS = [137, 41, 29];

const PROFILE: ProfileInput = {
  name: "ACME_SENTINEL",
  oneLineDescription: "DESC_SENTINEL",
  stage: "STAGE_SENTINEL",
  offering: "OFFERING_SENTINEL",
  targetCustomer: "CUSTOMER_SENTINEL",
  primaryGoals: ["GOAL_SENTINEL"],
  knownConstraints: ["CONSTRAINT_SENTINEL"],
};

/** The tier row every commit path now requires — every fact a recognizable sentinel (SC#4b). */
const seedFacts = (t: TestConvex<typeof schema>) =>
  t.run((ctx) =>
    ctx.db.insert("tenantProfiles", {
      tenantId: TENANT,
      headcount: 137,
      paidStaff: 41,
      yearsOperating: 29,
      revenueStage: "steady-revenue",
      funding: "bootstrapped",
      agentName: "AGENTNAME_SENTINEL",
      tier: "sme",
      tierSource: "derived",
      derivedAt: Date.now(),
    }),
  );

/** Concatenate every row of the three LOG tables (audit / telemetry / deadLetters) as JSON. */
async function logPlaneJson(t: TestConvex<typeof schema>): Promise<string> {
  return t.run(async (ctx) => {
    const audit = await ctx.db.query("audit").collect();
    const telemetry = await ctx.db.query("telemetry").collect();
    const deadLetters = await ctx.db.query("deadLetters").collect();
    return JSON.stringify({ audit, telemetry, deadLetters });
  });
}

/**
 * Every numeric leaf of every `audit.payload` / `deadLetters.payload` — the two objects CLAUDE.md §4
 * governs by name. (`telemetry` has no `payload` column at all; its structured fields are covered by
 * the string sweep above, and it is structurally incapable of carrying a fact.)
 *
 * Payloads, not whole rows (the 15.1-02 refinement): a row carries `ts` / `_creationTime` — 13-digit
 * epoch millis — so a substring scan for a 2-3 digit needle fails a large fraction of runs for
 * reasons having nothing to do with redaction, and a real leak would be indistinguishable from that
 * noise. Comparing NUMBERS, not substrings, removes the last of it: `137` can appear inside a Convex
 * document id, but a payload whose numeric leaf EQUALS 137 is a genuine fact leak.
 */
async function payloadNumbers(t: TestConvex<typeof schema>): Promise<number[]> {
  const payloads = await t.run(async (ctx) => {
    const audit = await ctx.db.query("audit").collect();
    const deadLetters = await ctx.db.query("deadLetters").collect();
    return [...audit, ...deadLetters].map((r) => r.payload as unknown);
  });
  const out: number[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "number") out.push(v);
    else if (Array.isArray(v)) for (const x of v) walk(x);
    else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
  };
  for (const p of payloads) walk(p);
  return out;
}

test("no onboarding audit/telemetry/DLQ row carries profile prose or a field value (SC#4, §4)", async () => {
  const t = setup();
  await seedFacts(t);
  const asT = asTenant(t);

  // A full onboarding commit + a subsequent edit — both audit paths, sentinels in every field.
  await asT.mutation(api.onboarding.commitProfile, { profile: PROFILE });
  await asT.mutation(api.onboarding.updateProfile, {
    profile: { ...PROFILE, offering: "EDITED_OFFERING_SENTINEL" },
  });

  const logs = await logPlaneJson(t);

  // The commit audit DID land (proving we are scanning a populated log plane, not an empty one).
  expect(logs).toContain("onboarding.profile_committed");

  // …yet NO sentinel — nor any serialized profile prose — appears in any log payload.
  for (const sentinel of SENTINELS) {
    expect(logs, `sentinel "${sentinel}" leaked into a log payload`).not.toContain(sentinel);
  }
  for (const line of serializeProfile({ ...PROFILE, persona: "sme" }).split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length < 8) continue; // skip markdown scaffolding (#, -, blank) — not a leak signal
    expect(logs, `profile prose "${trimmed}" leaked into a log payload`).not.toContain(trimmed);
  }

  // SC#4b: no NUMERIC tier fact reached a log payload either.
  const numbers = await payloadNumbers(t);
  expect(numbers.length, "scanning an empty set of payloads would pass vacuously").toBeGreaterThan(
    0,
  );
  for (const fact of FACT_NUMBERS) {
    expect(numbers, `tier fact ${fact} leaked into a log payload`).not.toContain(fact);
  }
});

test("the profile CONTENT does live on the vault row (the content plane is not over-redacted)", async () => {
  const t = setup();
  await seedFacts(t);
  const { vaultDocId } = await asTenant(t).mutation(api.onboarding.commitProfile, {
    profile: PROFILE,
  });
  // Sanity counterweight: §4 redacts the LOG plane, NOT the content plane — the profile text must
  // survive verbatim on the vaultDocuments row (else grounding would have nothing to retrieve).
  const doc = await t.run((ctx) => ctx.db.get(vaultDocId));
  expect(doc?.text).toContain("OFFERING_SENTINEL");
});
