// @vitest-environment node
//
// convex-test coverage for the backend intake spine (INTK-02/03). This file starts with the
// Wave-0 seed helper (04-VALIDATION.md): registers every component the intake spine's merge
// seam (sendCockpitMessage) touches offline — "agent" (the thread message store), "rateLimiter"
// (guardrails.preCall/recordSpend), "auditCounts" (the aggregate audit.log maintains on every
// insert) — plus a placeholder round-trip test proving the seed helper works end-to-end. The
// full spine coverage (extract/redact/audit/merge/fail-closed/dictation) lands in 04-04 Task 3.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import agentSchema from "../node_modules/@convex-dev/agent/src/component/schema.js";
import rateLimiterSchema from "../node_modules/@convex-dev/rate-limiter/src/component/schema.js";
import aggregateSchema from "../node_modules/@convex-dev/aggregate/src/component/schema.js";

// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const agentModules = import.meta.glob("../node_modules/@convex-dev/agent/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const rateLimiterModules = import.meta.glob("../node_modules/@convex-dev/rate-limiter/src/component/**/!(*.test).ts");
// @ts-expect-error import.meta.glob is provided by Vite/vitest at runtime.
const aggregateModules = import.meta.glob("../node_modules/@convex-dev/aggregate/src/component/**/!(*.test).ts");

const TENANT = "tenant_intake";
type T = ReturnType<typeof convexTest>;

/** The seed helper (Wave-0 gap): registers every component the intake spine's merge seam
 *  (sendCockpitMessage) touches offline, so attachToThread/dictateToThread run end-to-end. */
function setup(): T {
  const t = convexTest(schema, modules);
  t.registerComponent("agent", agentSchema, agentModules);
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
  t.registerComponent("auditCounts", aggregateSchema, aggregateModules);
  return t;
}

describe("intakeDb round-trip (Wave-0 seed check)", () => {
  test("generateUploadUrl + insertArtifact round-trip", async () => {
    const t = setup();
    const asT = t.withIdentity({ subject: TENANT });

    const url = await asT.mutation(api.intakeDb.generateUploadUrl, {});
    expect(url).toBeTruthy();

    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["hello"])));
    const artifactId = await t.mutation(internal.intakeDb.insertArtifact, {
      tenantId: TENANT,
      threadId: "thread_x",
      storageId,
      filename: "a.txt",
      mimeType: "text/plain",
      size: 5,
      kind: "document",
    });

    const row = await t.run((ctx) => ctx.db.get(artifactId));
    expect(row).toMatchObject({ tenantId: TENANT, status: "uploaded", filename: "a.txt", kind: "document" });
  });
});
