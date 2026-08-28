#!/usr/bin/env node

/**
 * smoke-quickbooks-read — the QuickBooks lane's live evidence producer (28-06, consumed by 28-23).
 *
 * ═══ READ THIS FIRST: ON 2026-08-28 THIS SCRIPT HAS NEVER RUN LIVE. ═══
 *
 * No Intuit credential is loaded in this deployment. The owner ATTESTED on 2026-08-27 that Pikar
 * holds Intuit PRODUCTION credentials; that attestation is not a grant and this repository cannot
 * check it. Everything below is therefore RUNNABLE-ON-CREDENTIALS, proven offline against a stub,
 * and NOT a passed lane. `--self-test` says so in its own output, `--verify-evidence` refuses to
 * call a stub file a live pass, and the `providerGates` lane row stays `parked`.
 *
 * WHAT THE OWNER MUST SET before a live run (all on the DEPLOYMENT, not `.env.local`):
 *
 *   cd packages/backend
 *   npx convex env set QUICKBOOKS_CLIENT_ID      <intuit app client id>
 *   npx convex env set QUICKBOOKS_CLIENT_SECRET  <intuit app client secret>
 *   npx convex env set QUICKBOOKS_REDIRECT_URI   https://<deployment>.convex.site/quickbooks/callback
 *   npx convex env set QUICKBOOKS_HOME_CURRENCY  USD          # optional; ISO 4217 of the books
 *   npx convex env set CONNECTOR_CREDENTIAL_KEY_V1 <base64 32-byte key>   # if not already set
 *
 * The redirect URI must match the one registered on the Intuit app EXACTLY — Intuit refuses the
 * exchange on a mismatch before the browser moves. Then connect a company through the consent
 * flow and re-run this with `--tenant <id>`.
 *
 * IT NEVER WRITES TO QUICKBOOKS. Every read goes through `convex/quickbooks.ts`, whose only
 * transport is `connectorFetch.readPages` — GET, allow-listed, redirect-refusing. That allow-list
 * is the ONLY write boundary that exists: `com.intuit.quickbooks.accounting` is the whole
 * Accounting API and Intuit publishes no read-only accounting scope. The one non-GET the lane can
 * reach is the documented token revoke.
 *
 * IT RESOLVES NOTHING. Clearing `partner-tier-and-poll-budget` is an owner seal on the
 * `providerGates` row and that is 28-23's judgment. This script refuses to emit — and
 * `--verify-evidence` refuses to accept — a file claiming the condition is resolved.
 *
 * FOUR MODES:
 *   (no flags)            live read only. Refuses loudly if nothing is connected. Never revokes.
 *   --revoke              live read + a REAL revoke, recorded as 28-03's 4-state outcome.
 *                         DESTRUCTIVE: the grant is gone and must be re-consented.
 *   --self-test           OFFLINE. Assembles evidence from a STUBBED transcript through the same
 *                         builder the live run uses, then feeds mutated copies through the
 *                         validator and requires every guard to fire.
 *   --verify-evidence F   OFFLINE. Schema, freshness, environment binding, sensitive-field scan,
 *                         and a loud refusal to read a stub as a live pass.
 *
 * WHAT IT RECORDS: entity names, projection states, counts, cap flags, request counts, closed
 * failure labels and timestamps. NOT tokens, NOT client credentials, NOT the REALM ID, NOT any
 * money amount, NOT a customer, NOT one byte of an Intuit payload (CLAUDE.md §4).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const SCHEMA = "quickbooks-read-lane/v1";
const PROVIDER = "quickbooks";
const OPEN_CONDITION = "partner-tier-and-poll-budget";
/** The four members of the closed entity union in `convex/quickbooks.ts`. Nothing else is readable. */
const ENTITIES = ["Invoice", "Payment", "Bill", "Account"];
const MODES = ["live", "self-test"];
const FRESHNESS_MS = 30 * 86_400_000;

/**
 * Anything whose presence in an evidence file is a leak, checked against the RAW TEXT rather than
 * against known field names — a secret smuggled in under a field nobody thought to ban is still a
 * secret. `realmId` is here because the realm is the company's own Intuit account identifier and
 * it is a PATH SEGMENT: a leaked realm plus a leaked token is a read of someone's books.
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
  "realmId",
  "realm_id",
  "Bearer ",
  "authorization",
  "Authorization",
];

/** An email anywhere in the file means a person's identity reached it. */
const EMAIL_SHAPED = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// ── The validator (the whole point of `--verify-evidence`) ────────────────────────────────

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Every reason a piece of evidence is not evidence. Returns a LIST, not a boolean: an operator
 * fixing one problem at a time learns about the next only after another live run, and a live run
 * against QuickBooks spends a real grant and a real slice of an unknown partner-tier call budget.
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
      if (!isPlainObject(read) || !ENTITIES.includes(read.entity)) {
        problems.push("a read names no allow-listed entity");
        continue;
      }
      if (!["ready", "partial", "unavailable"].includes(read.state)) {
        problems.push(`${read.entity}: unknown projection state`);
      }
      if (!Number.isInteger(read.itemCount) || read.itemCount < 0) {
        problems.push(`${read.entity}: itemCount is not a count`);
      }
      // A capped read that calls itself ready is the exact lie the projection contract forbids,
      // and evidence must not be able to assert it either: a prefix of a receivables ledger
      // presented as complete understates what a company is owed.
      if (read.capped === true && read.state === "ready") {
        problems.push(`${read.entity}: a capped read cannot be ready`);
      }
      if (read.state === "partial" && !read.missing) {
        problems.push(`${read.entity}: a partial read must name what is missing`);
      }
      // "Missing history is unknown, never zero." A read that could not happen may not be recorded
      // as an empty-but-successful one.
      if (read.state === "unavailable" && read.itemCount !== 0) {
        problems.push(`${read.entity}: an unavailable read cannot report items`);
      }
    }
  }

  // THE OPEN CONDITION. Evidence may report what was seen; it may never report a verdict the
  // observation does not support, and it may never report resolution at all — that is an owner
  // seal on the gate row (28-23), not a line in a file this script wrote.
  const condition = raw.openCondition;
  if (!isPlainObject(condition) || condition.id !== OPEN_CONDITION) {
    problems.push(`evidence must name the open condition "${OPEN_CONDITION}"`);
  } else if (condition.resolved !== false) {
    problems.push("evidence may not claim the open condition is resolved — 28-23 owns that seal");
  } else if (condition.partnerTier != null && condition.partnerTier !== "unknown") {
    // The App Partner Program tier is an OPEN item. "Builder = 500,000 CorePlus calls per
    // workspace per month" is a documented figure for ONE tier, not this app's entitlement, and a
    // file that names a tier is a file that will be quoted as if Intuit confirmed it.
    problems.push("the App Partner Program tier is unknown — evidence may not assert one");
  }

  if (raw.revocation !== null && raw.revocation !== undefined) {
    const r = raw.revocation;
    if (!isPlainObject(r)) problems.push("revocation is not an object");
    else {
      // 28-03's four states. `confirmed` means Intuit said so; the other three are honest
      // failures and must never be laundered into the first.
      const states = ["confirmed", "attempted_failed", "unsupported", "not_attempted"];
      if (!states.includes(r.upstream)) problems.push("revocation.upstream is not a known state");
      if (r.clearedLocally !== true && r.clearedLocally !== false) {
        problems.push("revocation.clearedLocally must be true or false");
      }
      // Revoke BEFORE local deletion is the ordering invariant. Evidence that records a local
      // clear with no upstream attempt at all is evidence of the wrong order.
      if (r.clearedLocally === true && r.upstream === "not_attempted" && r.hadCredential === true) {
        problems.push("a held credential was cleared locally with no upstream revoke attempted");
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

// ── The builder, shared by the live run and the self-test ─────────────────────────────────

/**
 * Assemble an evidence document. ONE builder for both modes on purpose: a self-test that
 * exercised a second, prettier assembly path would prove nothing about the file a live run writes.
 */
export function buildEvidence({ mode, environment, reads, revocation, requestCount }) {
  return {
    schema: SCHEMA,
    provider: PROVIDER,
    environment,
    mode,
    recordedAt: new Date().toISOString(),
    reads,
    revocation,
    // Raw material for the open condition: how many requests four bounded reads actually cost.
    // A number, not a verdict — the budget it has to fit inside is the unknown.
    requestCount,
    openCondition: {
      id: OPEN_CONDITION,
      // ALWAYS false. The observation goes in `observed`; the verdict is 28-23's.
      resolved: false,
      partnerTier: "unknown",
      observed:
        mode === "self-test"
          ? "NOT OBSERVED — this file came from a stub, no request reached Intuit"
          : `four bounded reads cost ${requestCount} request(s) against an unstated tier budget`,
    },
  };
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
  let requestCount = 0;
  for (const entity of ENTITIES) {
    const r = convexRun("quickbooks:quickbooksReadEvidence", { tenantId, environment, entity });
    reads.push({
      entity: r.entity,
      state: r.state,
      itemCount: r.itemCount,
      capped: r.capped,
      missing: r.missing ?? null,
      rejected: r.rejected ?? 0,
      retrievedAt: r.retrievedAt ?? null,
      // COUNT ONLY. A source ref is an Intuit object id belonging to the company's books.
      refCount: r.refCount ?? 0,
    });
    if (r.state !== "unavailable") requestCount += 1;
  }

  const connected = reads.some((r) => r.state !== "unavailable");
  if (!connected) {
    console.error("LIVE_EVIDENCE_NOT_PRODUCED: no QuickBooks grant is connected for this tenant.");
    console.error("  Connect one first (quickbooksAuth:beginConnect -> Intuit consent -> callback),");
    console.error("  and check the five env names in this file's header are set on the deployment.");
    console.error("  This script does not fake a read. Offline proof of its guards: --self-test");
    process.exit(2);
  }

  let revocation = null;
  if (doRevoke) {
    // Revoke UPSTREAM FIRST; `revokeAndClear` clears the local copy only after Intuit has answered,
    // and records whichever of the four states actually happened.
    const result = convexRun("quickbooksAuth:disconnectForTenant", {
      tenantId,
      environment,
      confirm: "revoke",
    });
    revocation = {
      upstream: result.upstream,
      clearedLocally: result.cleared === true,
      // A status code is a closed label, not a provider message.
      statusCode: result.statusCode ?? null,
      hadCredential: true,
    };
  }

  return buildEvidence({ mode: "live", environment, reads, revocation, requestCount });
}

// ── The self-test ─────────────────────────────────────────────────────────────────────────

/** A STUBBED transcript: what four bounded reads look like when they worked. */
const STUB_READS = [
  {
    entity: "Invoice",
    state: "ready",
    itemCount: 12,
    capped: false,
    missing: null,
    rejected: 0,
    retrievedAt: Date.now(),
    refCount: 12,
  },
  {
    entity: "Payment",
    state: "partial",
    itemCount: 40,
    capped: true,
    missing: "the read stopped at the page cap",
    rejected: 0,
    retrievedAt: Date.now(),
    refCount: 25,
  },
  {
    entity: "Bill",
    state: "ready",
    itemCount: 3,
    capped: false,
    missing: null,
    rejected: 0,
    retrievedAt: Date.now(),
    refCount: 3,
  },
  {
    entity: "Account",
    state: "ready",
    itemCount: 2,
    capped: false,
    missing: null,
    rejected: 0,
    retrievedAt: Date.now(),
    refCount: 2,
  },
];

/** The stub file, built by the SAME builder a live run uses. Must validate clean. */
const GOOD = () =>
  buildEvidence({
    mode: "self-test",
    environment: "sandbox",
    reads: STUB_READS.map((r) => ({ ...r })),
    revocation: {
      upstream: "confirmed",
      clearedLocally: true,
      statusCode: 200,
      hadCredential: true,
    },
    requestCount: 4,
  });

const mutate = (fn) => {
  const doc = GOOD();
  fn(doc);
  return doc;
};

const CASES = [
  ["the stub file this script builds validates", GOOD(), 0],
  ["a wrong schema is refused", mutate((d) => (d.schema = "something/v9")), 1],
  ["a wrong provider is refused", mutate((d) => (d.provider = "hubspot")), 1],
  ["an unknown mode is refused", mutate((d) => (d.mode = "probably")), 1],
  ["a bad environment is refused", mutate((d) => (d.environment = "staging")), 1],
  ["stale evidence is refused", mutate((d) => (d.recordedAt = "2020-01-01T00:00:00.000Z")), 1],
  [
    "future-dated evidence is refused",
    mutate((d) => (d.recordedAt = "2099-01-01T00:00:00.000Z")),
    1,
  ],
  ["evidence with no reads is refused", mutate((d) => (d.reads = [])), 1],
  [
    "an entity outside the allow-list is refused",
    mutate((d) => (d.reads[0].entity = "JournalEntry")),
    1,
  ],
  ["a capped read calling itself ready is refused", mutate((d) => (d.reads[0].capped = true)), 1],
  [
    "a partial read naming nothing missing is refused",
    mutate((d) => (d.reads[1].missing = null)),
    1,
  ],
  [
    "an unavailable read reporting items is refused — missing is unknown, never zero",
    mutate((d) => (d.reads[0].state = "unavailable")),
    1,
  ],
  [
    "an unknown revocation state is refused",
    mutate((d) => (d.revocation.upstream = "probably")),
    1,
  ],
  [
    "a local clear with no upstream attempt is refused — revoke comes first",
    mutate((d) => (d.revocation.upstream = "not_attempted")),
    1,
  ],
  [
    "a missing clearedLocally is refused",
    mutate((d) => delete d.revocation.clearedLocally),
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
  [
    "evidence ASSERTING a partner tier is refused — the tier is an open item",
    mutate((d) => (d.openCondition.partnerTier = "Builder")),
    1,
  ],
  ["a leaked access token is refused", mutate((d) => (d.reads[0].access_token = "x")), 1],
  ["a leaked realm id is refused", mutate((d) => (d.realmId = "9130350000000001")), 1],
  ["a leaked email is refused", mutate((d) => (d.reads[0].note = "owner@example.com")), 1],
  ["a non-object is refused", "nope", 1],
];

function selfTest(outPath) {
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
  console.log("");
  console.log("  THIS IS NOT A LIVE PASS. It proves the builder and the validator against a STUB.");
  console.log("  Nothing here has spoken to Intuit. The lane stays `parked` and");
  console.log(`  the open condition ${OPEN_CONDITION} stays UNRESOLVED.`);
  if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(GOOD(), null, 2)}\n`);
    console.log(`\n  Wrote the stub evidence to ${outPath} (mode "self-test" — not lane evidence).`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────────────────

function main(argv) {
  const flag = (name) => argv.includes(name);
  const value = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };

  if (flag("--self-test")) {
    console.log("smoke-quickbooks-read --self-test (offline, no network, no deployment)\n");
    return selfTest(value("--out", null));
  }

  if (flag("--verify-evidence")) {
    const verifyPath = value("--verify-evidence", null);
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
    if (doc.mode !== "live") {
      // A well-formed stub is still a stub. Saying so here is the difference between a lane that
      // is CONSISTENT and a lane that has PASSED.
      console.log("");
      console.log("  *** THIS FILE IS A STUB, NOT A LIVE PASS. ***");
      console.log("  It is well-formed and it proves the validator. It is not lane evidence and");
      console.log("  28-23 must not seal on it.");
    }
    console.log(`  open condition ${OPEN_CONDITION}: UNRESOLVED (28-23 owns the seal)`);
    return;
  }

  const tenantId = value("--tenant", process.env.QUICKBOOKS_LANE_TENANT_ID ?? "");
  const environment = value("--environment", "production");
  const out = value("--out", "quickbooks-lane-evidence.json");
  if (!tenantId) {
    console.error("LIVE_EVIDENCE_NOT_PRODUCED: no tenant.");
    console.error("  Pass --tenant <id> or set QUICKBOOKS_LANE_TENANT_ID, and connect a company.");
    console.error("  The deployment env names this needs are listed at the top of this file.");
    console.error("  Offline proof of this script's own guards: --self-test");
    process.exit(2);
  }

  const doRevoke = flag("--revoke");
  console.log(
    `smoke-quickbooks-read — ${environment}, ${doRevoke ? "read + REVOKE" : "read only"}`,
  );
  if (doRevoke) {
    console.log("  WARNING: --revoke DESTROYS the grant. Use a disposable sandbox company.");
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
  console.log("  This is an OBSERVATION. 28-23 decides whether it clears the condition.");
}

// Not `import.meta.main` — that is Bun/Deno. This is the portable form.
if (process.argv[1]?.endsWith("smoke-quickbooks-read.mjs")) main(process.argv.slice(2));
