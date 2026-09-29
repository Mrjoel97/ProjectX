import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import workflowSchema from "../node_modules/@convex-dev/workflow/src/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const workflowModules = import.meta.glob(
  "../node_modules/@convex-dev/workflow/src/component/**/!(*.test).ts",
);
const workpoolModules = import.meta.glob(
  "../node_modules/@convex-dev/workpool/src/component/**/!(*.test).ts",
);

function harness() {
  const t = convexTest(schema, modules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  return t;
}

const attemptId = "abcdef12-1234-4234-8234-123456789abc";
const request = {
  operation: "vaultSmoke:seedCorpus" as const,
  args: { tenantId: "eval-abcdef12", needle: "PRIVATE_NEEDLE_DO_NOT_STORE" },
};

test("same attempt and hash recover one workflow while a changed hash conflicts", async () => {
  const t = harness();
  const input = { attemptId, requestSha256: "a".repeat(64), request };
  const first = await t.mutation(internal.goldenEvalAttempts.start, input);
  const second = await t.mutation(internal.goldenEvalAttempts.start, input);

  expect(first.state).toBe("started");
  expect(second).toEqual({ state: "existing", workflowId: first.workflowId });
  await expect(
    t.mutation(internal.goldenEvalAttempts.start, {
      ...input,
      requestSha256: "b".repeat(64),
    }),
  ).rejects.toThrow("GOLDEN_PAID_ATTEMPT_CONFLICT");

  const rows = await t.run((ctx) => ctx.db.query("goldenEvalAttempts").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    attemptId,
    requestSha256: input.requestSha256,
    operation: request.operation,
    workflowId: first.workflowId,
  });
  expect(JSON.stringify(rows)).not.toContain(request.args.needle);
});

test("the refs-only audit journal has exactly one insert-only writer", () => {
  const source = readFileSync(new URL("./goldenEvalAttempts.ts", import.meta.url), "utf8");
  expect(source.length).toBeGreaterThan(500);
  expect(source).not.toMatch(/db\.patch\(/);
  expect(source).not.toMatch(/db\.replace\(/);
  expect(source).not.toMatch(/db\.delete\(/);
  expect(source.match(/db\.insert\(\s*["']goldenEvalAttempts["']/g)).toHaveLength(1);
});
