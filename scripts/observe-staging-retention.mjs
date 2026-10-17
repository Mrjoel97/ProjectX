import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

// Read only. Never recreate, shorten, purge or otherwise change the clock fixture.
export function buildObservationQuery(expectedFingerprint) {
  if (!/^[a-f0-9]{64}$/.test(expectedFingerprint ?? "")) throw Error("MISSING_FIXTURE_PIN");
  return `
const interviews = await ctx.db.query("foundationInterviews").take(201);
if (interviews.length > 200) throw Error("INCOMPLETE_INVENTORY");
const fixtures = interviews.filter(row => row.tenantId.startsWith("retention-qualification-"));
if (fixtures.length !== 1) throw Error("AMBIGUOUS_FIXTURE");
const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
  JSON.stringify([fixtures[0]._id, fixtures[0].tenantId, fixtures[0]._creationTime])));
const fixtureFingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
if (fixtureFingerprint !== ${JSON.stringify(expectedFingerprint)}) throw Error("FIXTURE_REPLACED");
const rows = await ctx.db.query("foundationTranscripts")
  .withIndex("by_tenant", q => q.eq("tenantId", fixtures[0].tenantId)).take(2);
if (rows.length > 1) throw Error("DUPLICATE_CHECKPOINT");
const createdAt = Date.parse("2026-10-17T10:18:29.493Z");
const expiresAt = Date.parse("2026-10-24T10:18:29.493Z");
const firstEligibleSweep = Date.parse("2026-10-24T11:15:00Z");
const observedAt = Date.now();
if (rows.length === 1 &&
  (Math.abs(rows[0]._creationTime - createdAt) > 1 ||
   Math.abs(rows[0].expiresAt - expiresAt) > 1)) throw Error("FIXTURE_CHANGED");
if (observedAt < expiresAt && rows.length !== 1) throw Error("EARLY_ABSENCE");
if (observedAt >= firstEligibleSweep && rows.length !== 0) throw Error("PURGE_NOT_OBSERVED");
return { observedAt: new Date(observedAt).toISOString(),
  createdAt: new Date(createdAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(),
  inventoryComplete: true, fixtureUnique: true, checkpointCount: rows.length,
  beforeExpiryPresenceVerified: observedAt < expiresAt,
  elapsedExpiryAbsenceObserved: observedAt >= firstEligibleSweep && rows.length === 0,
  cronAttributionVerified: false,
  nativeLifecycleVerified: false };
`;
}

export function observe() {
  const backend = fileURLToPath(new URL("../packages/backend/", import.meta.url));
  const cli = fileURLToPath(
    new URL("../packages/backend/node_modules/convex/bin/main.js", import.meta.url),
  );
  const run = (args) =>
    execFileSync(process.execPath, [cli, ...args], {
      cwd: backend,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
      maxBuffer: 1048576,
    }).trim();
  if (!process.env.CONVEX_DEPLOY_KEY) throw Error("NO_STAGING_KEY");
  if (
    run(["dashboard", "--no-open"]).match(
      /https:\/\/dashboard\.convex\.dev\/d\/([a-z0-9-]+)/,
    )?.[1] !== "woozy-wren-368"
  ) {
    throw Error("WRONG_TARGET");
  }
  const result = JSON.parse(
    run([
      "run",
      "--inline-query",
      buildObservationQuery(process.env.RETENTION_FIXTURE_FINGERPRINT),
    ]),
  );
  const keys = [
    "observedAt",
    "createdAt",
    "expiresAt",
    "inventoryComplete",
    "fixtureUnique",
    "checkpointCount",
    "beforeExpiryPresenceVerified",
    "elapsedExpiryAbsenceObserved",
    "cronAttributionVerified",
    "nativeLifecycleVerified",
  ];
  if (
    Object.keys(result).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(result, key)) ||
    !Number.isInteger(result.checkpointCount) ||
    ![0, 1].includes(result.checkpointCount) ||
    keys
      .slice(0, 3)
      .some(
        (key) => typeof result[key] !== "string" || !Number.isFinite(Date.parse(result[key])),
      ) ||
    keys
      .slice(3)
      .filter((key) => key !== "checkpointCount")
      .some((key) => typeof result[key] !== "boolean")
  ) {
    throw Error("INVALID_PROOF");
  }
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    observe();
  } catch {
    // CLI failures may contain private query state; expose no raw error or provider body.
    console.log(JSON.stringify({ retentionObservationCompleted: false }));
    process.exitCode = 1;
  }
}
