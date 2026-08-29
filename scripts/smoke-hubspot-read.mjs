#!/usr/bin/env node

/**
 * smoke-hubspot-read — the HubSpot lane's live evidence producer (28-05, consumed by 28-22).
 *
 * IT NEVER WRITES TO HUBSPOT. Every call it makes goes through `convex/hubspot.ts`, whose only
 * transport is `connectorFetch.readPages` — GET, allow-listed, redirect-refusing — plus the one
 * documented `POST /oauth/2026-03/token/revoke`, which is a revocation of Pikar's OWN grant and
 * the single most important thing this script exists to observe.
 *
 * WHY IT EXISTS. `docs/connectors/hubspot-suitability.md` admitted HubSpot `approved_production`
 * with exactly one open condition: whether that revoke invalidates already-issued ACCESS tokens.
 * HubSpot documents nothing either way and the legacy `DELETE` it replaced explicitly did NOT
 * cascade. No amount of reading settles it — so `--revoke` drives
 * `hubspotAuth.probeRevocationCascade`, which reads with a token, revokes, and re-reads with the
 * SAME pre-revocation token. What comes back is what actually happened.
 *
 * IT RESOLVES NOTHING. The evidence file is an OBSERVATION. Clearing
 * `revoke-cascades-to-access-tokens` is an owner seal on the `providerGates` row, and that is
 * 28-22's judgment. This script refuses to emit — and `--verify-evidence` refuses to accept — a
 * file that claims the condition is resolved on anything less than an observed cascade.
 *
 * THREE MODES:
 *   (no flags)            live read only. Refuses loudly if nothing is connected. Never revokes.
 *   --revoke              live read + the DESTRUCTIVE cascade probe. Requires a reconnect after.
 *   --self-test           OFFLINE. Feeds mutated evidence through the validator and requires every
 *                         guard to fire. A gate never observed refusing is not a gate.
 *   --verify-evidence F   OFFLINE. Schema, freshness, provider/mode binding, sensitive-field scan.
 *
 * WHAT IT RECORDS: dataset names, projection states, counts, cap flags, closed failure labels,
 * status-shaped outcomes and timestamps. NOT tokens, NOT client credentials, NOT the portal id,
 * NOT provider object ids, NOT one byte of a vendor payload (CLAUDE.md §4).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const SCHEMA = "hubspot-read-lane/v1";
const PROVIDER = "hubspot";
const OPEN_CONDITION = "revoke-cascades-to-access-tokens";
const DATASETS = ["contacts", "companies", "deals", "owners", "dealPipelines"];
const MODES = ["live", "self-test"];
const FRESHNESS_MS = 30 * 86_400_000;

/**
 * Anything whose presence in an evidence file is a leak, checked against the RAW TEXT rather than
 * against known field names — a secret smuggled in under a field nobody thought to ban is still a
 * secret. `hub_id` is here because the portal id is the tenant's own account identifier.
 */
const FORBIDDEN_SUBSTRINGS = [
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "client_secret",
  "clientSecret",
  "client_id",
  "clientId",
  "hub_id",
  "hubId",
  "Bearer ",
  "authorization",
  "Authorization",
];

/** An email anywhere in the file means a person's identity reached it. */
const EMAIL_SHAPED = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// ── The validator (the whole point of `--verify-evidence`) ────────────────────────────────

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Every reason a piece of evidence is not evidence. Returns a list, not a boolean: an operator
 * fixing one problem at a time learns about the next one only after another live run, and a live
 * run costs a real grant.
 */
export function validateEvidence(raw, options = {}) {
  const now = options.now ?? Date.now();
  const problems = [];

  if (!isPlainObject(raw)) return ["evidence is not an object"];
  if (raw.schema !== SCHEMA) problems.push(`schema must be "${SCHEMA}"`);
  if (raw.provider !== PROVIDER) problems.push(`provider must be "${PROVIDER}"`);
  if (!MODES.includes(raw.mode)) problems.push(`mode must be one of ${MODES.join(", ")}`);
  if (raw.environment !== "sandbox" && raw.environment !== "production") {
    problems.push("environment must be sandbox or production");
  }

  const recordedAt = Date.parse(raw.recordedAt ?? "");
  if (Number.isNaN(recordedAt)) problems.push("recordedAt is not a date");
  else if (recordedAt > now + 60_000) problems.push("recordedAt is in the future");
  else if (now - recordedAt > FRESHNESS_MS) problems.push("evidence is older than 30 days");

  if (!Array.isArray(raw.reads) || raw.reads.length === 0) {
    problems.push("evidence records no reads");
  } else {
    for (const read of raw.reads) {
      if (!isPlainObject(read) || !DATASETS.includes(read.dataset)) {
        problems.push("a read names no known dataset");
        continue;
      }
      if (!["ready", "partial", "unavailable"].includes(read.state)) {
        problems.push(`${read.dataset}: unknown projection state`);
      }
      if (!Number.isInteger(read.itemCount) || read.itemCount < 0) {
        problems.push(`${read.dataset}: itemCount is not a count`);
      }
      // A capped read that calls itself ready is the exact lie the projection contract forbids,
      // and evidence must not be able to assert it either.
      if (read.capped === true && read.state === "ready") {
        problems.push(`${read.dataset}: a capped read cannot be ready`);
      }
      if (read.state === "partial" && !read.missing) {
        problems.push(`${read.dataset}: a partial read must name what is missing`);
      }
    }
  }

  // THE OPEN CONDITION. Evidence may report what was seen; it may never report a verdict the
  // observation does not support, and it may never report resolution at all — that is an owner
  // seal on the gate row (28-22), not a line in a file this script wrote.
  const condition = raw.openCondition;
  if (!isPlainObject(condition) || condition.id !== OPEN_CONDITION) {
    problems.push(`evidence must name the open condition "${OPEN_CONDITION}"`);
  } else if (condition.resolved !== false) {
    problems.push("evidence may not claim the open condition is resolved — 28-22 owns that seal");
  }

  if (raw.revocation !== null && raw.revocation !== undefined) {
    const r = raw.revocation;
    if (!isPlainObject(r)) problems.push("revocation is not an object");
    else {
      const states = ["confirmed", "attempted_failed", "unsupported", "not_attempted"];
      if (!states.includes(r.upstream)) problems.push("revocation.upstream is not a known state");
      if (![true, false, null].includes(r.cascaded)) {
        problems.push("revocation.cascaded must be true, false or null");
      }
      // A `confirmed` revoke with an unexamined cascade must carry the residual window, or the
      // product would read it as a clean kill nobody proved.
      if (r.upstream === "confirmed" && r.cascaded !== true && r.residualAccessUntil == null) {
        problems.push("a confirmed revoke with no proven cascade must record a residual window");
      }
    }
  }

  const text = JSON.stringify(raw);
  for (const banned of FORBIDDEN_SUBSTRINGS) {
    if (text.includes(banned)) problems.push(`evidence contains a forbidden field: ${banned}`);
  }
  if (EMAIL_SHAPED.test(text)) problems.push("evidence contains an email address");

  return problems;
}

// ── The live run ──────────────────────────────────────────────────────────────────────────

function convexRun(fn, args) {
  const out = execFileSync(
    "npx",
    ["convex", "run", fn, JSON.stringify(args)],
    // The Convex CLI only works from the backend package (a standing repo gotcha).
    { cwd: "packages/backend", encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: true },
  );
  // `convex run` prints the return value as the last JSON-ish block.
  const start = out.indexOf("{");
  if (start < 0) throw new Error(`no result from ${fn}`);
  return JSON.parse(out.slice(start));
}

function liveRun({ environment, tenantId, doRevoke }) {
  const reads = [];
  for (const dataset of DATASETS) {
    const r = convexRun("hubspot:hubspotReadEvidence", { tenantId, environment, dataset });
    reads.push({
      dataset: r.dataset,
      state: r.state,
      itemCount: r.itemCount,
      capped: r.capped,
      missing: r.missing ?? null,
      retrievedAt: r.retrievedAt ?? null,
      // COUNT ONLY. The refs themselves are opaque provider ids and still do not belong in a file
      // that gets pasted into a plan.
      sampleRefCount: Array.isArray(r.sampleRefs) ? r.sampleRefs.length : 0,
    });
  }

  const connected = reads.some((r) => r.state !== "unavailable");
  if (!connected) {
    console.error("LIVE_EVIDENCE_NOT_PRODUCED: no HubSpot grant is connected for this tenant.");
    console.error("  Connect one first (hubspotAuth.hubspotConnectUrl -> consent -> callback),");
    console.error("  then re-run. This script does not fake a read.");
    process.exit(2);
  }

  let revocation = null;
  if (doRevoke) {
    const probe = convexRun("hubspotAuth:probeRevocationCascade", {
      tenantId,
      environment,
      confirm: "revoke",
    });
    revocation = {
      upstream: probe.upstream,
      before: probe.before,
      after: probe.after,
      cascaded: probe.cascaded,
      // Read back from the client-safe projection so the file records what the PRODUCT will say.
      residualAccessUntil: null,
    };
    const statuses = convexRun("connectorCredentials:connectorStatuses", {});
    const row = Array.isArray(statuses)
      ? statuses.find((s) => s.provider === PROVIDER && s.environment === environment)
      : null;
    revocation.residualAccessUntil = row?.revocation?.residualAccessUntil ?? null;
  }

  return {
    schema: SCHEMA,
    provider: PROVIDER,
    environment,
    mode: "live",
    recordedAt: new Date().toISOString(),
    reads,
    revocation,
    openCondition: {
      id: OPEN_CONDITION,
      // ALWAYS false. The observation goes in `observed`; the verdict is 28-22's.
      resolved: false,
      observed:
        revocation === null
          ? "not probed — re-run with --revoke against a disposable grant"
          : revocation.cascaded === true
            ? "the pre-revocation access token was REJECTED after revoke — the cascade held"
            : revocation.cascaded === false
              ? "the pre-revocation access token STILL WORKED after revoke — no cascade"
              : "inconclusive — the post-revoke read failed for an unrelated reason",
    },
  };
}

// ── The self-test ─────────────────────────────────────────────────────────────────────────

/** A file that must validate clean. Every case below is this, minus exactly one thing. */
const GOOD = () => ({
  schema: SCHEMA,
  provider: PROVIDER,
  environment: "production",
  mode: "live",
  recordedAt: new Date().toISOString(),
  reads: [
    {
      dataset: "deals",
      state: "ready",
      itemCount: 4,
      capped: false,
      missing: null,
      retrievedAt: Date.now(),
      sampleRefCount: 3,
    },
  ],
  revocation: {
    upstream: "confirmed",
    before: "ok",
    after: "ok",
    cascaded: false,
    residualAccessUntil: Date.now() + 1_800_000,
  },
  openCondition: { id: OPEN_CONDITION, resolved: false, observed: "no cascade" },
});

const mutate = (fn) => {
  const doc = GOOD();
  fn(doc);
  return doc;
};

const CASES = [
  ["a clean file validates", GOOD(), 0],
  ["a wrong schema is refused", mutate((d) => (d.schema = "something/v9")), 1],
  ["a wrong provider is refused", mutate((d) => (d.provider = "quickbooks")), 1],
  ["an unknown mode is refused", mutate((d) => (d.mode = "probably")), 1],
  ["a bad environment is refused", mutate((d) => (d.environment = "staging")), 1],
  ["stale evidence is refused", mutate((d) => (d.recordedAt = "2020-01-01T00:00:00.000Z")), 1],
  [
    "future-dated evidence is refused",
    mutate((d) => (d.recordedAt = "2099-01-01T00:00:00.000Z")),
    1,
  ],
  ["evidence with no reads is refused", mutate((d) => (d.reads = [])), 1],
  ["an unknown dataset is refused", mutate((d) => (d.reads[0].dataset = "tickets")), 1],
  ["a capped read calling itself ready is refused", mutate((d) => (d.reads[0].capped = true)), 1],
  [
    "a partial read naming nothing missing is refused",
    mutate((d) => {
      d.reads[0].state = "partial";
      d.reads[0].missing = null;
    }),
    1,
  ],
  [
    "a confirmed revoke with no proven cascade and no residual window is refused",
    mutate((d) => (d.revocation.residualAccessUntil = null)),
    1,
  ],
  [
    "an unknown revocation state is refused",
    mutate((d) => (d.revocation.upstream = "probably")),
    1,
  ],
  [
    "a cascade verdict that is not true/false/null is refused",
    mutate((d) => (d.revocation.cascaded = "yes")),
    1,
  ],
  [
    "evidence CLAIMING the open condition is resolved is refused",
    mutate((d) => (d.openCondition.resolved = true)),
    1,
  ],
  [
    "evidence naming the wrong open condition is refused",
    mutate((d) => (d.openCondition.id = "something-else")),
    1,
  ],
  ["a leaked access token is refused", mutate((d) => (d.reads[0].access_token = "x")), 1],
  ["a leaked portal id is refused", mutate((d) => (d.hub_id = 12345)), 1],
  ["a leaked email is refused", mutate((d) => (d.reads[0].note = "rep@example.com")), 1],
  ["a non-object is refused", "nope", 1],
];

function selfTest() {
  let failures = 0;
  for (const [name, doc, expectProblems] of CASES) {
    const problems = validateEvidence(doc);
    const got = problems.length > 0 ? 1 : 0;
    const ok = got === expectProblems;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? "OK  " : "FAIL"}  ${name}${problems.length > 0 ? ` — ${problems[0]}` : ""}`,
    );
  }
  console.log("");
  if (failures > 0) {
    console.error(`SELF-TEST FAILED: ${failures} guard(s) did not behave as required.`);
    process.exit(1);
  }
  console.log(`SELF-TEST PASSED: ${CASES.length} cases, every guard observed refusing.`);
  console.log("This proves the VALIDATOR. It proves nothing about HubSpot — see --revoke.");
}

// ── Entry point ───────────────────────────────────────────────────────────────────────────

function main(argv) {
  const flag = (name) => argv.includes(name);
  const value = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };

  if (flag("--self-test")) {
    console.log("smoke-hubspot-read --self-test (offline, no network, no deployment)\n");
    return selfTest();
  }

  const verifyPath = value("--verify-evidence", null);
  if (flag("--verify-evidence")) {
    if (!verifyPath) {
      console.error("--verify-evidence needs a file path.");
      process.exit(1);
    }
    let doc;
    try {
      doc = JSON.parse(readFileSync(verifyPath, "utf8"));
    } catch (error) {
      console.error(`Could not read evidence: ${error.message}`);
      process.exit(1);
    }
    const problems = validateEvidence(doc);
    if (problems.length > 0) {
      console.error(`EVIDENCE REJECTED (${problems.length}):`);
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log(`EVIDENCE OK: ${verifyPath}`);
    console.log(`  ${doc.reads.length} read(s), mode ${doc.mode}, recorded ${doc.recordedAt}`);
    console.log(`  open condition ${OPEN_CONDITION}: UNRESOLVED (28-22 owns the seal)`);
    return;
  }

  const tenantId = value("--tenant", process.env.HUBSPOT_LANE_TENANT_ID ?? "");
  const environment = value("--environment", "production");
  const out = value("--out", "hubspot-lane-evidence.json");
  if (!tenantId) {
    console.error("LIVE_EVIDENCE_NOT_PRODUCED: no tenant.");
    console.error("  Pass --tenant <id> or set HUBSPOT_LANE_TENANT_ID, and connect a grant first.");
    console.error("  Offline proof of this script's own guards: --self-test");
    process.exit(2);
  }

  const doRevoke = flag("--revoke");
  console.log(
    `smoke-hubspot-read — ${environment}, ${doRevoke ? "read + REVOKE probe" : "read only"}`,
  );
  if (doRevoke) {
    console.log("  WARNING: --revoke DESTROYS the grant. Use a disposable test portal.");
  }
  const evidence = liveRun({ environment, tenantId, doRevoke });
  const problems = validateEvidence(evidence);
  if (problems.length > 0) {
    console.error("REFUSING TO WRITE EVIDENCE THIS SCRIPT'S OWN VALIDATOR REJECTS:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\nWrote ${out}`);
  console.log(`  open condition ${OPEN_CONDITION}: ${evidence.openCondition.observed}`);
  console.log("  This is an OBSERVATION. 28-22 decides whether it clears the condition.");
}

// Not `import.meta.main` — that is Bun/Deno. This is the portable form.
if (process.argv[1]?.endsWith("smoke-hubspot-read.mjs")) main(process.argv.slice(2));
