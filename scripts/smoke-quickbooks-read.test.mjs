import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidence, convexRun } from "./smoke-quickbooks-read.mjs";

test("production reads and revokes select production without shell-parsing tenant JSON", () => {
  for (const fn of ["quickbooks:quickbooksReadEvidence", "quickbooksAuth:disconnectForTenant"]) {
    const args = { tenantId: 'tenant "quoted" & $(literal)', environment: "production" };
    const result = convexRun(
      fn,
      args,
      (executable, argv, options) => {
        assert.equal(executable, process.execPath);
        assert.match(
          argv[0],
          /[\\/]packages[\\/]backend[\\/]node_modules[\\/]convex[\\/]bin[\\/]main\.js$/,
        );
        assert.deepEqual(argv.slice(1), ["run", "--prod", fn, JSON.stringify(args)]);
        assert.equal(options.shell, false);
        assert.match(options.cwd, /[\\/]packages[\\/]backend[\\/]?$/);
        return '{"state":"unavailable"}';
      },
      "prod",
    );
    assert.deepEqual(result, { state: "unavailable" });
  }
});

test("provider production environment alone never selects the production deployment", () => {
  convexRun(
    "quickbooks:quickbooksReadEvidence",
    { environment: "production" },
    (_exe, argv) => {
      assert.equal(argv.includes("--prod"), false);
      return "{}";
    },
    "dev",
  );
});

test("legacy requestCount is explicitly entity coverage, never a measured poll cost", () => {
  const evidence = buildEvidence({
    mode: "live",
    environment: "production",
    reads: [],
    revocation: null,
    requestCount: 4,
  });
  assert.equal(evidence.schema, "quickbooks-read-lane/v1");
  assert.equal(evidence.requestCount, 4);
  assert.equal(evidence.openCondition.resolved, false);
  assert.match(evidence.openCondition.observed, /4 entity read\(s\)/);
  assert.match(
    evidence.openCondition.observed,
    /HTTP request count and tier budget are unmeasured/,
  );
});
