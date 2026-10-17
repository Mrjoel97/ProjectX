// @vitest-environment node
import { internalMutationGeneric, makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { withPausedScheduler } from "../test/pausedScheduler";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const nativeTimeout = globalThis.setTimeout;
const tick = () => new Promise<void>((resolve) => nativeTimeout(resolve, 0));
const write = makeFunctionReference<"mutation">("__pausedProof:write");
function setup() {
  return convexTest(schema, {
    ...modules,
    "./__pausedProof.ts": async () => ({
      write: internalMutationGeneric({
        args: {},
        handler: async (ctx) => {
          await ctx.db.insert("users", { name: "scheduled sentinel" });
        },
      }),
    }),
  });
}

test.each([
  false,
  true,
])("paused scheduling assertions discard real Convex callbacks even on failure (%s)", async (fail) => {
  const t = setup();
  const sentinel = new Error("assertion failed");
  const run = withPausedScheduler(async () => {
    const id = await t.run((ctx) => ctx.scheduler.runAfter(0, write, {}));
    expect((await t.run((ctx) => ctx.db.system.get(id)))?.state.kind).toBe("pending");
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    if (fail) throw sentinel;
  });
  if (fail) await expect(run).rejects.toBe(sentinel);
  else await run;
  expect(vi.isFakeTimers()).toBe(false);
  expect(globalThis.setTimeout).toBe(nativeTimeout);
  await tick();
  await t.finishInProgressScheduledFunctions();
  expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);

  // Positive control: with the real scheduler restored, the same mutation actually executes.
  await t.run((ctx) => ctx.scheduler.runAfter(0, write, {}));
  await tick();
  await t.finishInProgressScheduledFunctions();
  expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(1);
});
