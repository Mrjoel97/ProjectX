import { test } from "node:test";
import assert from "node:assert/strict";
import { bakePresenceBrowserSnapshot, BROWSER_BAKE_TIMEOUT_MS, BROWSER_SNAPSHOT_TTL_MS } from "./bake-presence-browser-snapshot.mjs";

test("tenant-free bake pins dependencies, bounds lifetime and verifies browser before snapshot", async () => {
  const calls = []; let stopped = false, options;
  const result = await bakePresenceBrowserSnapshot({ log: () => {}, createSandbox: async (value) => {
    options = value;
    return { runCommand: async (command) => { calls.push(command); return { exitCode: 0 }; }, snapshot: async (settings) => { assert.equal(calls.at(-1).cmd, "node"); assert.match(calls.at(-1).args[1], /page.screenshot/); assert.equal(settings.expiration, BROWSER_SNAPSHOT_TTL_MS); return { snapshotId: "snapshot-verified" }; }, stop: async () => { stopped = true; } };
  } });
  assert.equal(options.timeout, BROWSER_BAKE_TIMEOUT_MS); assert.equal(options.persistent, false);
  assert.equal(options.snapshotExpiration, 30 * 24 * 60 * 60 * 1000);
  assert.equal(options.networkPolicy, "allow-all"); assert.equal(stopped, true);
  assert.equal(result.snapshotId, "snapshot-verified");
  assert.match(JSON.stringify(calls), /1\.61\.1/); assert.match(JSON.stringify(calls), /registry\.npmjs\.org/);
  assert.equal(calls.some((command) => command.args.includes("--with-deps")), false);
});
test("failed installation never snapshots and always releases the VM", async () => {
  let snapshots = 0, stops = 0;
  await assert.rejects(bakePresenceBrowserSnapshot({ log: () => {}, createSandbox: async () => ({ runCommand: async () => ({ exitCode: 1 }), snapshot: async () => { snapshots++; }, stop: async () => { stops++; } }) }), /BROWSER_BAKE_FAILED/);
  assert.equal(snapshots, 0); assert.equal(stops, 1);
});
