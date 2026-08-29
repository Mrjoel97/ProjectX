#!/usr/bin/env node

/**
 * smoke-stripe-read — the Stripe lane's live evidence producer (28-07, consumed by 28-24).
 *
 * ═══ READ THIS FIRST: ON 2026-08-28 THIS SCRIPT HAS NEVER RUN LIVE. ═══
 *
 * There is no Stripe App credential in this deployment. Nothing below has spoken to Stripe.
 * Everything here is RUNNABLE-ON-CREDENTIALS, proven offline against a stub, and NOT a passed lane.
 * `--self-test` says so in its own output, `--verify-evidence` refuses to call a stub file a live
 * pass, and the `providerGates` lane row stays `parked`.
 *
 * ═══ AND THE ADMISSION BEHIND IT IS AN OWNER OVERRIDE, NOT A FINDING ═══
 *
 * Stripe was recorded `approved_production` on 2026-08-27 **against** the prepared evidence, which
 * said production was not supportable because platform-initiated revocation for Stripe Apps is
 * undocumented. The owner was shown that and approved anyway. Do not read the marker as
 * evidence-backed, and do not let this script's output imply that it is.
 *
 * ═══ WHAT "DISCONNECT" MEANS ON THIS ROUTE, AND WHY THE VALIDATOR PINS IT ═══
 *
 * Stripe documents NO platform-initiated revoke or uninstall for Stripe Apps. Only the USER can
 * uninstall (Settings -> Installed Apps), and `account.application.deauthorized` reports it
 * afterwards. Connect's deauthorize endpoint belongs to the OTHER flow; no documentation says it
 * applies to app installs, so pointing a revoke at it and recording the 200 would be recording a
 * confirmed revocation of a grant that is still live.
 *
 * So `--revoke` here performs a LOCAL CLEAR and nothing else, and the validator REFUSES any
 * evidence whose `revocation.upstream` is not `unsupported`. `confirmed` and `attempted_failed`
 * are both fabrications on this route: there is no endpoint that could have succeeded or failed.
 *
 * ═══ WHAT THE OWNER MUST SET before a live run (all on the DEPLOYMENT, not `.env.local`) ═══
 *
 *   cd packages/backend
 *   npx convex env set STRIPE_APP_CLIENT_ID      <stripe app oauth client id>
 *   npx convex env set STRIPE_APP_SECRET_KEY     <the APP developer's sk_... secret key>
 *   npx convex env set STRIPE_APP_REDIRECT_URI   https://<deployment>.convex.site/stripe/callback
 *   npx convex env set STRIPE_APP_API_VERSION    <a dated Stripe API version, e.g. 2024-06-20>
 *   npx convex env set CONNECTOR_CREDENTIAL_KEY_V1 <base64 32-byte key>   # if not already set
 *
 * `STRIPE_APP_SECRET_KEY` IS NOT `BILLING_STRIPE_SECRET_KEY`. A second, WRITE-CAPABLE Stripe
 * integration (phase 28.1) charges from Pikar's OWN merchant account under that other prefix.
 * Putting it here would point a read-only tenant lane at Pikar's own books.
 *
 * `STRIPE_APP_API_VERSION` has NO DEFAULT and the lane refuses to read without it. This repository
 * cannot verify a currently-valid Stripe version string offline, and inventing one would be a
 * fabricated fact; an unpinned read silently takes whichever version the CONNECTED ACCOUNT's
 * dashboard is on, which the tenant can change under us.
 *
 * The redirect URI must appear in the app manifest's `allowed_redirect_uris`. Then install the app
 * on a test Stripe account (external testing serves 25 accounts with NO App Review), complete the
 * consent flow, and re-run this with `--tenant <id>`.
 *
 * ═══ IT NEVER WRITES TO STRIPE ═══
 *
 * Every read goes through `convex/stripeConnector.ts`, whose only transport is
 * `connectorFetch.readPages` — GET, allow-listed, redirect-refusing. And unlike the QuickBooks
 * lane, the boundary is not only ours: a Stripe App declaring solely `*_read` manifest permissions
 * cannot express a write with the token it is issued.
 *
 * ═══ IT RESOLVES NOTHING ═══
 *
 * Clearing `platform-initiated-revocation` is an owner seal on the `providerGates` row and that is
 * 28-24's judgment — with a Stripe support answer, or with an explicit tenant-visible statement of
 * what disconnect means here. It cannot be closed by a green test, and this script refuses to emit,
 * and `--verify-evidence` refuses to accept, a file claiming the condition is resolved.
 *
 * FOUR MODES:
 *   (no flags)            live read only. Refuses loudly if nothing is connected. Never disconnects.
 *   --revoke              live read + a LOCAL CLEAR, recorded as 28-03's `unsupported` state.
 *                         DESTRUCTIVE LOCALLY: the ciphertext is gone and the tenant must reconnect.
 *                         The grant stays LIVE on Stripe until the user uninstalls the app.
 *   --self-test           OFFLINE. Assembles evidence from a STUBBED transcript through the same
 *                         builder the live run uses, then feeds mutated copies through the
 *                         validator and requires every guard to fire.
 *   --verify-evidence F   OFFLINE. Schema, freshness, environment binding, version pin,
 *                         sensitive-field scan, and a loud refusal to read a stub as a live pass.
 *
 * WHAT IT RECORDS: entity names, projection states, counts, cap flags, request counts, closed
 * failure labels, the API version pin and timestamps. NOT tokens, NOT the secret key, NOT the
 * CONNECTED ACCOUNT ID, NOT any money amount, NOT a customer, NOT one byte of a Stripe payload
 * (CLAUDE.md §4).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const SCHEMA = "stripe-read-lane/v1";
const PROVIDER = "stripe";
const OPEN_CONDITION = "platform-initiated-revocation";
/** The five members of the closed entity union in `convex/stripeConnector.ts`. Nothing else reads. */
const ENTITIES = ["balance", "charges", "invoices", "payouts", "disputes"];
const MODES = ["live", "self-test"];
const FRESHNESS_MS = 30 * 86_400_000;

/** A dated Stripe API version, optionally release-named. Mirrors `connectorFetch`'s own shape. */
const API_VERSION_SHAPE = /^\d{4}-\d{2}-\d{2}(\.[a-z0-9_]+)?$/;

/**
 * THE ONLY HONEST UPSTREAM STATE ON THIS ROUTE.
 *
 * There is no documented platform-initiated revoke for Stripe Apps, so there is no request that
 * could have returned a 200 (`confirmed`) or an error (`attempted_failed`). `not_attempted` is
 * wrong for a different reason: it means "we have an endpoint and skipped it". Only `unsupported`
 * describes what actually happened.
 */
const ONLY_HONEST_UPSTREAM = "unsupported";

/**
 * Anything whose presence in an evidence file is a leak, checked against the RAW TEXT rather than
 * against known field names — a secret smuggled in under a field nobody thought to ban is still a
 * secret.
 *
 * `acct_` is here because the connected-account id is the business's own Stripe identifier.
 * `BILLING_STRIPE` is here because evidence from this READ-ONLY tenant lane naming the phase-28.1
 * write-capable merchant credential would mean the two namespaces had already been crossed.
 */
const FORBIDDEN_SUBSTRINGS = [
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "client_secret",
  "clientSecret",
  "secret_key",
  "secretKey",
  "sk_live",
  "sk_test",
  "rk_live",
  "rk_test",
  "stripe_user_id",
  "acct_",
  "cus_",
  "Bearer ",
  "authorization",
  "Authorization",
  "BILLING_STRIPE",
];

/** An email anywhere in the file means a person's identity reached it. */
const EMAIL_SHAPED = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// ── The validator (the whole point of `--verify-evidence`) ────────────────────────────────

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Every reason a piece of evidence is not evidence. Returns a LIST, not a boolean: an operator
 * fixing one problem at a time learns about the next only after another live run, and a live run
 * against Stripe spends a real slice of a 10,000-reads-per-month allocation.
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

  // The version pin is part of the evidence, not deployment trivia. A read against an unpinned or
  // malformed version ran against whatever shape the connected account's dashboard was set to, and
  // a projection derived from an unknown shape is not evidence of anything.
  if (typeof raw.apiVersion !== "string" || !API_VERSION_SHAPE.test(raw.apiVersion)) {
    problems.push("evidence must name the pinned Stripe API version it was read against");
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
      // A capped read that calls itself ready is the exact lie the projection contract forbids, and
      // evidence must not be able to assert it either: a prefix of a receipts ledger presented as
      // complete understates what a business took in.
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
  // observation does not support, and it may never report resolution at all — that is an owner seal
  // on the gate row (28-24), not a line in a file this script wrote.
  const condition = raw.openCondition;
  if (!isPlainObject(condition) || condition.id !== OPEN_CONDITION) {
    problems.push(`evidence must name the open condition "${OPEN_CONDITION}"`);
  } else if (condition.resolved !== false) {
    problems.push("evidence may not claim the open condition is resolved — 28-24 owns that seal");
  }

  if (raw.revocation !== null && raw.revocation !== undefined) {
    const r = raw.revocation;
    if (!isPlainObject(r)) problems.push("revocation is not an object");
    else {
      // THE ROUTE'S HARDEST GUARD. Any other state would be a fabrication: no documented endpoint
      // exists for a platform-initiated revoke, so nothing could have succeeded or failed.
      if (r.upstream !== ONLY_HONEST_UPSTREAM) {
        problems.push(
          `revocation.upstream must be "${ONLY_HONEST_UPSTREAM}" — Stripe Apps documents no platform-initiated revoke`,
        );
      }
      if (r.clearedLocally !== true && r.clearedLocally !== false) {
        problems.push("revocation.clearedLocally must be true or false");
      }
      // The user's sentence has to be in the file, because the file is what 28-24 reads. A local
      // clear reported without it is a local clear one edit away from being called a revocation.
      if (r.clearedLocally === true && r.grantRemainsLiveUpstream !== true) {
        problems.push(
          "a local clear must record that the grant stays live on Stripe until the user uninstalls",
        );
      }
      if (r.statusCode !== null && r.statusCode !== undefined) {
        // A status code means a request happened. On this route there was no request to make.
        problems.push("revocation.statusCode must be absent — no upstream request is made");
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
 * Assemble an evidence document. ONE builder for both modes on purpose: a self-test that exercised
 * a second, prettier assembly path would prove nothing about the file a live run writes.
 */
export function buildEvidence({ mode, environment, apiVersion, reads, revocation, requestCount }) {
  return {
    schema: SCHEMA,
    provider: PROVIDER,
    environment,
    mode,
    apiVersion,
    recordedAt: new Date().toISOString(),
    reads,
    revocation,
    // Raw material for the read allocation: how many requests five bounded reads actually cost
    // against the 500-per-transaction / 10,000-per-month floor. A number, not a verdict.
    requestCount,
    openCondition: {
      id: OPEN_CONDITION,
      // ALWAYS false. The observation goes in `observed`; the verdict is 28-24's.
      resolved: false,
      observed:
        mode === "self-test"
          ? "NOT OBSERVED — this file came from a stub, no request reached Stripe"
          : "no platform-initiated revoke was attempted: Stripe Apps documents none. Disconnect deleted Pikar's local copy only.",
    },
    // Restated in the artefact so it survives being pasted somewhere without this script.
    admissionNote:
      "Stripe's approved_production decision (2026-08-27) is an OWNER OVERRIDE recorded against the evidence, not an evidence-backed finding.",
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
  const start = out.indexOf("{");
  if (start < 0) throw new Error(`no result from ${fn}`);
  return JSON.parse(out.slice(start));
}

function liveRun({ environment, tenantId, doRevoke }) {
  const reads = [];
  const pins = new Set();
  let requestCount = 0;
  for (const entity of ENTITIES) {
    const r = convexRun("stripeConnector:stripeReadEvidence", { tenantId, environment, entity });
    reads.push({
      entity: r.entity,
      state: r.state,
      itemCount: r.itemCount,
      capped: r.capped,
      missing: r.missing ?? null,
      rejected: r.rejected ?? 0,
      retrievedAt: r.retrievedAt ?? null,
      // COUNT ONLY. A source ref is a Stripe object id belonging to the business.
      refCount: r.refCount ?? 0,
    });
    // The version pin comes back FROM the deployment with each read, so the evidence names the
    // shape that was actually read against rather than whatever the operator's shell happened to
    // hold. A run that saw two different pins is not one observation and must not be filed as one.
    if (r.apiVersion) pins.add(r.apiVersion);
    if (r.state !== "unavailable") requestCount += 1;
  }

  const connected = reads.some((r) => r.state !== "unavailable");
  if (!connected) {
    console.error("LIVE_EVIDENCE_NOT_PRODUCED: no Stripe grant is connected for this tenant.");
    console.error("  Install the app on a test account first (stripeAuth:beginConnect -> consent");
    console.error("  -> callback), and check the five env names in this file's header are set on");
    console.error("  the deployment. This script does not fake a read.");
    console.error("  Offline proof of its guards: --self-test");
    process.exit(2);
  }

  let revocation = null;
  if (doRevoke) {
    const result = convexRun("stripeAuth:disconnectForTenant", {
      tenantId,
      environment,
      confirm: "revoke",
    });
    revocation = {
      upstream: result.upstream,
      clearedLocally: result.cleared === true,
      // THE SENTENCE THE USER IS OWED, carried in the artefact rather than left to prose. Pikar
      // deleted its copy; the grant is still live on Stripe until the user uninstalls the app.
      grantRemainsLiveUpstream: true,
    };
  }

  if (pins.size !== 1) {
    console.error(
      pins.size === 0
        ? "LIVE_EVIDENCE_NOT_PRODUCED: the deployment reported no pinned Stripe API version."
        : `LIVE_EVIDENCE_NOT_PRODUCED: reads reported ${pins.size} different API version pins.`,
    );
    console.error("  Set STRIPE_APP_API_VERSION on the deployment and re-run.");
    process.exit(2);
  }
  return buildEvidence({
    mode: "live",
    environment,
    apiVersion: [...pins][0],
    reads,
    revocation,
    requestCount,
  });
}

// ── The self-test ─────────────────────────────────────────────────────────────────────────

/** A STUBBED transcript: what five bounded reads look like when they worked. */
const STUB_READS = [
  {
    entity: "balance",
    state: "ready",
    itemCount: 1,
    capped: false,
    missing: null,
    rejected: 0,
    retrievedAt: Date.now(),
    refCount: 0,
  },
  {
    entity: "charges",
    state: "partial",
    itemCount: 500,
    capped: true,
    missing: "the read stopped at the page_cap",
    rejected: 0,
    retrievedAt: Date.now(),
    refCount: 200,
  },
  {
    entity: "invoices",
    state: "ready",
    itemCount: 7,
    capped: false,
    missing: null,
    rejected: 0,
    retrievedAt: Date.now(),
    refCount: 7,
  },
  {
    entity: "payouts",
    state: "ready",
    itemCount: 4,
    capped: false,
    missing: null,
    rejected: 0,
    retrievedAt: Date.now(),
    refCount: 4,
  },
  {
    entity: "disputes",
    state: "ready",
    itemCount: 0,
    capped: false,
    missing: null,
    rejected: 0,
    retrievedAt: Date.now(),
    refCount: 0,
  },
];

/** The stub file, built by the SAME builder a live run uses. Must validate clean. */
const GOOD = () =>
  buildEvidence({
    mode: "self-test",
    environment: "sandbox",
    apiVersion: "2024-06-20",
    reads: STUB_READS.map((r) => ({ ...r })),
    revocation: {
      upstream: "unsupported",
      clearedLocally: true,
      grantRemainsLiveUpstream: true,
    },
    requestCount: 9,
  });

const mutate = (fn) => {
  const doc = GOOD();
  fn(doc);
  return doc;
};

const CASES = [
  ["the stub file this script builds validates", GOOD(), 0],
  ["a wrong schema is refused", mutate((d) => (d.schema = "something/v9")), 1],
  ["a wrong provider is refused", mutate((d) => (d.provider = "quickbooks")), 1],
  ["an unknown mode is refused", mutate((d) => (d.mode = "probably")), 1],
  ["a bad environment is refused", mutate((d) => (d.environment = "staging")), 1],
  ["evidence with NO API version pin is refused", mutate((d) => delete d.apiVersion), 1],
  ["evidence with a non-version pin is refused", mutate((d) => (d.apiVersion = "latest")), 1],
  ["stale evidence is refused", mutate((d) => (d.recordedAt = "2020-01-01T00:00:00.000Z")), 1],
  [
    "future-dated evidence is refused",
    mutate((d) => (d.recordedAt = "2099-01-01T00:00:00.000Z")),
    1,
  ],
  ["evidence with no reads is refused", mutate((d) => (d.reads = [])), 1],
  [
    "an entity outside the allow-list is refused",
    mutate((d) => (d.reads[0].entity = "payment_intents")),
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
    "revocation claiming CONFIRMED is refused — Stripe Apps documents no platform revoke",
    mutate((d) => (d.revocation.upstream = "confirmed")),
    1,
  ],
  [
    "revocation claiming attempted_failed is refused — there was no endpoint to attempt",
    mutate((d) => (d.revocation.upstream = "attempted_failed")),
    1,
  ],
  [
    "revocation claiming not_attempted is refused — that means an endpoint exists and was skipped",
    mutate((d) => (d.revocation.upstream = "not_attempted")),
    1,
  ],
  [
    "a local clear that does NOT say the grant stays live upstream is refused",
    mutate((d) => delete d.revocation.grantRemainsLiveUpstream),
    1,
  ],
  [
    "a revocation carrying an HTTP status is refused — no request is made on this route",
    mutate((d) => (d.revocation.statusCode = 200)),
    1,
  ],
  ["a missing clearedLocally is refused", mutate((d) => delete d.revocation.clearedLocally), 1],
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
  ["a leaked connected-account id is refused", mutate((d) => (d.account = "acct_1Example")), 1],
  ["a leaked secret key is refused", mutate((d) => (d.note = "sk_test_abc")), 1],
  [
    "a 28.1 BILLING_STRIPE name is refused — the two Stripe lanes must not cross",
    mutate((d) => (d.note = "BILLING_STRIPE_SECRET_KEY")),
    1,
  ],
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
  console.log("  Nothing here has spoken to Stripe. The lane stays `parked` and");
  console.log(`  the open condition ${OPEN_CONDITION} stays UNRESOLVED.`);
  console.log("  Stripe's approved_production marker is an OWNER OVERRIDE, not a finding.");
  if (outPath) {
    writeFileSync(outPath, `${JSON.stringify(GOOD(), null, 2)}\n`);
    console.log(
      `\n  Wrote the stub evidence to ${outPath} (mode "self-test" — not lane evidence).`,
    );
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
    console.log("smoke-stripe-read --self-test (offline, no network, no deployment)\n");
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
    console.log(
      `  ${doc.reads.length} read(s), mode ${doc.mode}, API version ${doc.apiVersion}, recorded ${doc.recordedAt}`,
    );
    if (doc.mode !== "live") {
      // A well-formed stub is still a stub. Saying so here is the difference between a lane that is
      // CONSISTENT and a lane that has PASSED.
      console.log("");
      console.log("  *** THIS FILE IS A STUB, NOT A LIVE PASS. ***");
      console.log("  It is well-formed and it proves the validator. It is not lane evidence and");
      console.log("  28-24 must not seal on it.");
    }
    console.log(`  open condition ${OPEN_CONDITION}: UNRESOLVED (28-24 owns the seal)`);
    return;
  }

  // NOTE: there is deliberately no `--api-version` flag and no env fallback for it. The pin is
  // reported BY the deployment with every read (see `liveRun`); letting an operator type one here
  // would let a well-formed evidence file name a shape the read never used.
  const tenantId = value("--tenant", "");
  const environment = value("--environment", "production");
  const out = value("--out", "stripe-lane-evidence.json");
  if (!tenantId) {
    console.error("LIVE_EVIDENCE_NOT_PRODUCED: no tenant.");
    console.error("  Pass --tenant <id>, and install the app on a Stripe account first.");
    console.error("  The deployment env names this needs are listed at the top of this file.");
    console.error("  Offline proof of this script's own guards: --self-test");
    process.exit(2);
  }
  const doRevoke = flag("--revoke");
  console.log(
    `smoke-stripe-read — ${environment}, ${doRevoke ? "read + LOCAL CLEAR" : "read only"}`,
  );
  if (doRevoke) {
    console.log("  WARNING: --revoke deletes Pikar's stored credential. It does NOT revoke");
    console.log("  anything at Stripe: the grant stays live until the USER uninstalls the app.");
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
  console.log("  This is an OBSERVATION. 28-24 decides whether it clears the condition.");
}

// Not `import.meta.main` — that is Bun/Deno. This is the portable form.
if (process.argv[1]?.endsWith("smoke-stripe-read.mjs")) main(process.argv.slice(2));
