// A cockpit thread the tenant OWNS but whose threadId is not an agent-component thread id must
// DEGRADE, exactly like a thread it does not own — never throw.
//
// Found during the 26-05 Approvals UAT. `plans.threadId` is a plain `v.string()`, and rows exist
// whose threadId was never minted by the agent component (`smoke:seedCockpitPlan` writes
// `smoke-attach-<uuid>`; legacy rows predate the agent thread). `listThreadMessages` guarded
// AUTHORIZATION (a plans row for this tenant) and then assumed EXISTENCE, handing the raw string to
// `listMessages`, whose validator is `v.id("threads")`. The resulting ArgumentValidationError is
// uncaught in the browser and takes down the ENTIRE cockpit page — reachable from the `?thread=`
// URL parameter, i.e. from user input.
//
// The asymmetry is the bug: an UNOWNED thread returns an empty page, an OWNED-but-nonexistent one
// exploded. Both are "there are no messages to show".

import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import agentSchema from "../node_modules/@convex-dev/agent/src/component/schema.js";
import { api } from "./_generated/api";
import { isNonAgentThreadIdError } from "./cockpit";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const agentModules = import.meta.glob(
  "../node_modules/@convex-dev/agent/src/component/**/!(*.test).ts",
);

const TENANT = "tenant-thread-degrade";
const EMPTY = { page: [], isDone: true, continueCursor: "" };
const PAGE = { cursor: null, numItems: 10 };

function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("agent", agentSchema, agentModules);
  return t;
}

// THE HARNESS IS NOT PRODUCTION. The first fix matched only convex-test's wording, passed the
// integration test below, and STILL crashed the live cockpit — the deployed runtime words the same
// rejection differently. Both messages are pinned VERBATIM (the live one captured from a real
// browser console during the 26-05 UAT) so this cannot regress to proving the harness again.
const CONVEX_TEST_MESSAGE =
  'Validator error: Expected ID for table "threads", got `smoke-attach-1c11e0d9-e7af-4892-90dc-ff2d3cabe458`';
const LIVE_DEPLOYMENT_MESSAGE = `ArgumentValidationError: Value does not match validator.
Path: .threadId
Value: "smoke-attach-2a0d38db-018f-4ceb-a9a2-bba3eaad9f50"
Validator: v.id("threads")`;

test("recognises the non-agent-thread rejection from BOTH the harness and the live runtime", () => {
  expect(isNonAgentThreadIdError(new Error(CONVEX_TEST_MESSAGE))).toBe(true);
  expect(isNonAgentThreadIdError(new Error(LIVE_DEPLOYMENT_MESSAGE))).toBe(true);
});

test("does not swallow unrelated failures", () => {
  expect(isNonAgentThreadIdError(new Error("Uncaught Error: read timed out"))).toBe(false);
  // A validator rejection on a DIFFERENT table is somebody else's bug — it must still throw.
  expect(
    isNonAgentThreadIdError(
      new Error(
        'ArgumentValidationError: Value does not match validator.\nPath: .planId\nValue: "x"\nValidator: v.id("plans")',
      ),
    ),
  ).toBe(false);
  expect(isNonAgentThreadIdError("not an error")).toBe(false);
});

test("an owned plan whose threadId is not an agent thread degrades instead of throwing", async () => {
  const t = setup();
  // The exact shape smoke:seedCockpitPlan writes — an owned plans row, a non-Id threadId.
  const threadId = "smoke-attach-1c11e0d9-e7af-4892-90dc-ff2d3cabe458";
  await t.run(async (ctx) => {
    await ctx.db.insert("plans", {
      tenantId: TENANT,
      threadId,
      status: "proposed",
      createdAt: Date.now(),
    });
  });

  await expect(
    t
      .withIdentity({ subject: TENANT })
      .query(api.cockpit.listThreadMessages, { threadId, paginationOpts: PAGE }),
  ).resolves.toEqual(EMPTY);
});

test("a thread the tenant does not own still degrades the same way", async () => {
  const t = setup();
  await expect(
    t.withIdentity({ subject: TENANT }).query(api.cockpit.listThreadMessages, {
      threadId: "smoke-attach-not-mine",
      paginationOpts: PAGE,
    }),
  ).resolves.toEqual(EMPTY);
});
