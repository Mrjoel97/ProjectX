import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { convexSpawnOptions } from "./smokeRun.mjs";

test("Convex child options carry a finite timeout and deterministic termination signal", () => {
  assert.deepEqual(convexSpawnOptions(20_000), {
    encoding: "utf8",
    timeout: 20_000,
    killSignal: "SIGTERM",
  });
});

test("unbounded and malformed Convex child timeouts are rejected", () => {
  for (const value of [undefined, null, 0, -1, Number.POSITIVE_INFINITY]) {
    assert.throws(() => convexSpawnOptions(value), /CONVEX_TIMEOUT_INVALID/);
  }
});

test("the bounded child options terminate a non-responsive local process", () => {
  const result = spawnSync(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    ...convexSpawnOptions(100),
  });
  assert.equal(result.error?.code, "ETIMEDOUT");
  assert.equal(result.status, null);
});
