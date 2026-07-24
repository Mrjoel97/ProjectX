// SC#4 / CLAUDE.md §4 redaction-boundary scan for the onboarding flow (onboarding.ts).
//
// The profile `text` is vault CONTENT (it lives on the vaultDocuments row + rag chunks by design).
// The GOVERNANCE boundary is the LOG plane: no audit / telemetry / deadLetters row written during a
// commit or an edit may carry profile prose or a field VALUE — those payloads are refs/hashes/ids/
// counts/booleans ONLY. This test drives a real commit + edit with a fixture whose every field is a
// recognizable sentinel, then reads EVERY row of the three log tables and asserts no sentinel (nor the
// serialized profile prose) leaked. Mirrors llmRedaction / auditImmutability: a structural guard, so a
// future edit that starts logging a field value fails here instead of shipping a PII honeypot.
import type { BusinessProfile } from "@pikar/core";
import { serializeProfile } from "@pikar/core";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob("../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workflowModules = import.meta.glob("../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts");

const TENANT = "tenant_redaction";

function setup(): ReturnType<typeof convexTest> {
  process.env.OPENAI_API_KEY = "sk-redaction-test-key";
  const t = convexTest(schema, modules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  return t;
}

const asTenant = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: TENANT });

// Every FREE-TEXT field is a unique sentinel (persona must stay an emittable enum value — it is not
// prose, so it is not a §4 concern). If any sentinel appears in a log payload, redaction failed.
const SENTINELS = [
  "ACME_SENTINEL",
  "DESC_SENTINEL",
  "STAGE_SENTINEL",
  "OFFERING_SENTINEL",
  "CUSTOMER_SENTINEL",
  "GOAL_SENTINEL",
  "CONSTRAINT_SENTINEL",
  "EDITED_OFFERING_SENTINEL",
];

const PROFILE: BusinessProfile = {
  name: "ACME_SENTINEL",
  oneLineDescription: "DESC_SENTINEL",
  persona: "sme",
  stage: "STAGE_SENTINEL",
  offering: "OFFERING_SENTINEL",
  targetCustomer: "CUSTOMER_SENTINEL",
  primaryGoals: ["GOAL_SENTINEL"],
  knownConstraints: ["CONSTRAINT_SENTINEL"],
};

/** Concatenate every row of the three LOG tables (audit / telemetry / deadLetters) as JSON. */
async function logPlaneJson(t: ReturnType<typeof convexTest>): Promise<string> {
  return t.run(async (ctx) => {
    const audit = await ctx.db.query("audit").collect();
    const telemetry = await ctx.db.query("telemetry").collect();
    const deadLetters = await ctx.db.query("deadLetters").collect();
    return JSON.stringify({ audit, telemetry, deadLetters });
  });
}

test("no onboarding audit/telemetry/DLQ row carries profile prose or a field value (SC#4, §4)", async () => {
  const t = setup();
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
  for (const line of serializeProfile(PROFILE).split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length < 8) continue; // skip markdown scaffolding (#, -, blank) — not a leak signal
    expect(logs, `profile prose "${trimmed}" leaked into a log payload`).not.toContain(trimmed);
  }
});

test("the profile CONTENT does live on the vault row (the content plane is not over-redacted)", async () => {
  const t = setup();
  const { vaultDocId } = await asTenant(t).mutation(api.onboarding.commitProfile, {
    profile: PROFILE,
  });
  // Sanity counterweight: §4 redacts the LOG plane, NOT the content plane — the profile text must
  // survive verbatim on the vaultDocuments row (else grounding would have nothing to retrieve).
  const doc = await t.run((ctx) => ctx.db.get(vaultDocId));
  expect(doc?.text).toContain("OFFERING_SENTINEL");
});
