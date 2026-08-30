#!/usr/bin/env node

/**
 * smoke-paypal-read — the PayPal lane's evidence producer (28-08, consumed by 28-25).
 *
 * ═══ READ THIS FIRST: ON 2026-08-28 THIS SCRIPT HAS NEVER RUN LIVE, AND IT CANNOT. ═══
 *
 * There is no PayPal credential in this deployment, and there is no way to obtain one from public
 * documentation. Everything below is RUNNABLE-ON-CREDENTIALS, proven offline against a stub, and NOT
 * a passed lane. `--self-test` says so in its own output, `--verify-evidence` refuses to read a stub
 * as a live pass, a bare run exits NON-ZERO, and the `providerGates` lane row stays `parked`.
 *
 * ═══ THE GAP THAT STOPS A LIVE RUN, AND WHY IT IS NOT A TODO ═══
 *
 * PayPal's Transaction Search spec documents ONE OAuth flow: client credentials. A token minted that
 * way reads THE APP OWNER'S OWN PayPal account — Pikar's. Reading a TENANT'S merchant requires the
 * third-party path, and the published spec declares a partner-only `partner-transactions` resource
 * with NO PUBLISHED OPERATION. So the surface cannot be built from public documentation, and
 * `paypalAuth.beginConnect` refuses rather than offering an app token as a tenant connection.
 *
 * That refusal is the deliverable. The alternative — wiring the app's own credentials into a tenant
 * connection so that something reads — produces a green suite, a working smoke run, and Pikar's own
 * payment data rendered to a tenant as if it were theirs. Every gate in this phase checks that a read
 * WORKED; not one of them checks WHOSE money came back. That is why this script's hardest validator
 * rule is `delegatedMerchant`.
 *
 * ═══ SANDBOX IS NON-PROBATIVE, AND THIS SCRIPT SAYS SO IN ITS OWN OUTPUT ═══
 *
 * PayPal states outright: "You can call and test the PayPal Complete Payments Platform APIs with your
 * sandbox credentials BEFORE you are approved", and a PayPal representative later copies a sandbox
 * configuration to the live account. A green sandbox run therefore proves parsing and NOTHING about
 * production authorization. `probativeForProduction` is false for any sandbox or self-test document,
 * and the validator refuses a document that claims otherwise.
 *
 * ═══ NO REVOKE ENDPOINT IS DOCUMENTED ANYWHERE FOR PAYPAL ═══
 *
 * `POST /v1/oauth2/token` is the only documented authentication call; seller-side removal of granted
 * permissions is an ACCOUNT ACTION, not an API. So `--revoke` performs a LOCAL CLEAR and nothing
 * else, and the validator REFUSES any evidence whose `revocation.upstream` is not `unsupported`.
 * `confirmed` and `attempted_failed` are both fabrications here: there is no endpoint that could have
 * succeeded or failed. The open condition `no-documented-revoke-endpoint` stays UNRESOLVED; 28-25
 * owns it, with the assigned partner manager, and it cannot be closed by a green test.
 *
 * ═══ THE ADMISSION IS TESTIMONY, NOT EVIDENCE ═══
 *
 * PayPal was recorded `approved_production` on 2026-08-27 on an OWNER ATTESTATION that Pikar holds
 * partner acceptance with an assigned partner manager on a live partner account. No script here
 * checked it and no vendor page can. If it is wrong, third-party reads return 401 and PayPal is
 * `blocked` again.
 *
 * ═══ WHAT THE OWNER MUST SET before a live run (all on the DEPLOYMENT, not `.env.local`) ═══
 *
 *   cd packages/backend
 *   npx convex env set PAYPAL_PARTNER_MERCHANT_ID   <Pikar's OWN PayPal merchant id>
 *   npx convex env set CONNECTOR_CREDENTIAL_KEY_V1  <base64 32-byte key>   # if not already set
 *
 * TWO NAMES, AND THAT IS THE WHOLE LIST. There is deliberately no PayPal client id or client secret
 * here: nothing in this repository mints a PayPal token, because the only token it could mint reads
 * Pikar's own account. `PAYPAL_PARTNER_MERCHANT_ID` is not a credential — it is the public merchant
 * id of Pikar's own account, and it exists so `classifyGrantSubject` can tell Pikar's ledger apart
 * from a tenant's. Unset, every read fails closed rather than risk the confusion.
 *
 * ═══ IT NEVER WRITES TO PAYPAL ═══
 *
 * Every read goes through `convex/paypalConnector.ts`, whose only transport is
 * `connectorFetch.readPages` — GET, allow-listed to `/v1/reporting/transactions` and
 * `/v1/reporting/balances`, redirect-refusing. No invoice dispatch, no refund, no payout.
 *
 * FOUR MODES:
 *   (no flags)            live read only. Refuses loudly if nothing is connected. Never disconnects.
 *   --revoke              live read + a LOCAL CLEAR, recorded as 28-03's `unsupported` state.
 *                         DESTRUCTIVE LOCALLY: the ciphertext is gone and the tenant must reconnect.
 *                         Anything PayPal granted stays granted until the seller removes it.
 *   --self-test           OFFLINE. Assembles evidence from a STUBBED transcript through the same
 *                         builder the live run uses, then feeds mutated copies through the validator
 *                         and requires every guard to fire.
 *   --verify-evidence F   OFFLINE. Schema, freshness, environment binding, delegated-merchant
 *                         binding, sandbox non-probativeness, sensitive-field scan, and a loud
 *                         refusal to read a stub as a live pass.
 *
 * WHAT IT RECORDS: entity names, projection states, counts, cap flags, request counts, closed failure
 * labels, one boolean per read saying the credential was bound to a merchant other than Pikar's, and
 * timestamps. NOT tokens, NOT a merchant id, NOT an account number, NOT any money amount, NOT a
 * payer, NOT one byte of a PayPal payload (CLAUDE.md §4).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const SCHEMA = "paypal-read-lane/v1";
const PROVIDER = "paypal";
const OPEN_CONDITION = "no-documented-revoke-endpoint";
/** The two members of the closed entity union in `convex/paypalConnector.ts`. Nothing else reads. */
const ENTITIES = ["transactions", "balances"];
const MODES = ["live", "self-test"];
const FRESHNESS_MS = 30 * 86_400_000;

/**
 * THE ONLY HONEST UPSTREAM STATE ON THIS ROUTE.
 *
 * No revocation endpoint is documented anywhere for PayPal, so there is no request that could have
 * returned a 200 (`confirmed`) or an error (`attempted_failed`). `not_attempted` is wrong for a
 * different reason: it means "we have an endpoint and skipped it". Only `unsupported` describes what
 * actually happened.
 */
const ONLY_HONEST_UPSTREAM = "unsupported";

/**
 * Anything whose presence in an evidence file is a leak, checked against the RAW TEXT rather than
 * against known field names — a secret smuggled in under a field nobody thought to ban is still a
 * secret.
 *
 * `merchantId`/`merchant_id`/`payer_id` and `account_number` are here because they are the business's
 * own PayPal identifiers; the evidence carries a BOOLEAN saying a read was delegated, never the id it
 * was delegated to. `payer_info`, `cart_info` and `shipping_info` are here because those response
 * blocks carry a customer's name, email and address, and no read ever asks for them.
 */
const FORBIDDEN_SUBSTRINGS = [
  "access_token",
  "accessToken",
  "client_secret",
  "clientSecret",
  "client_id",
  "clientId",
  "Bearer ",
  // The HEADER NAME as a JSON KEY, not the bare word: this file's own prose legitimately says
  // "production authorization", and a substring scan that caught its own explanation would be
  // deleted, taking the real guard with it.
  '"authorization"',
  '"Authorization"',
  "merchant_id",
  "merchantId",
  "payer_id",
  "payerId",
  "payer_info",
  "cart_info",
  "shipping_info",
  "email_address",
  "account_number",
  "transaction_subject",
  "transaction_note",
];

/** An email anywhere in the file means a person's identity reached it. */
const EMAIL_SHAPED = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// ── The validator (the whole point of `--verify-evidence`) ────────────────────────────────

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Every reason a piece of evidence is not evidence. Returns a LIST, not a boolean: an operator fixing
 * one problem at a time would otherwise learn about the next only after another live run.
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

  // SANDBOX IS NON-PROBATIVE, AS A REFUSABLE CLAIM RATHER THAN A FOOTNOTE. PayPal states sandbox
  // calls work BEFORE approval, so a green sandbox run corroborates nothing about production
  // authorization. A document may only claim production probativeness if it is a LIVE run against
  // PRODUCTION — and even then it is an observation, not the seal.
  const claimsProbative = raw.probativeForProduction === true;
  if (raw.probativeForProduction !== true && raw.probativeForProduction !== false) {
    problems.push("evidence must state probativeForProduction explicitly");
  } else if (claimsProbative && !(raw.mode === "live" && raw.environment === "production")) {
    problems.push(
      "only a LIVE PRODUCTION run may claim probativeForProduction — PayPal's sandbox works before approval",
    );
  }

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
      // A capped read that calls itself ready is the exact lie the projection contract forbids.
      if (read.capped === true && read.state === "ready") {
        problems.push(`${read.entity}: a capped read cannot be ready`);
      }
      if (read.state === "partial" && !read.missing) {
        problems.push(`${read.entity}: a partial read must name what is missing`);
      }
      // "Missing history is unknown, never zero."
      if (read.state === "unavailable" && read.itemCount !== 0) {
        problems.push(`${read.entity}: an unavailable read cannot report items`);
      }
      // ═══ THE HARDEST RULE IN THIS FILE ═══
      //
      // A read that produced rows must state that the credential behind it was bound to a merchant
      // OTHER than Pikar's own. Without this, a perfectly well-formed evidence file could record a
      // successful read of PIKAR'S OWN PayPal account and 28-25 would seal the lane on it — the read
      // WORKED, every count is honest, and nothing else here would notice whose money it was.
      if (read.delegatedMerchant !== true && read.delegatedMerchant !== false) {
        problems.push(`${read.entity}: delegatedMerchant must be stated`);
      } else if (read.delegatedMerchant === false && read.state !== "unavailable") {
        problems.push(
          `${read.entity}: a read on a credential bound to Pikar's own account cannot produce a projection`,
        );
      }
    }
  }

  // THE OPEN CONDITION. Evidence may report what was seen; it may never report a verdict the
  // observation does not support, and it may never report resolution at all — that is an owner seal
  // on the gate row (28-25), not a line in a file this script wrote.
  const condition = raw.openCondition;
  if (!isPlainObject(condition) || condition.id !== OPEN_CONDITION) {
    problems.push(`evidence must name the open condition "${OPEN_CONDITION}"`);
  } else if (condition.resolved !== false) {
    problems.push("evidence may not claim the open condition is resolved — 28-25 owns that seal");
  }

  if (raw.revocation !== null && raw.revocation !== undefined) {
    const r = raw.revocation;
    if (!isPlainObject(r)) problems.push("revocation is not an object");
    else {
      // THE ROUTE'S OTHER HARD GUARD. Any other state would be a fabrication: no revoke endpoint is
      // documented anywhere for PayPal, so nothing could have succeeded or failed.
      if (r.upstream !== ONLY_HONEST_UPSTREAM) {
        problems.push(
          `revocation.upstream must be "${ONLY_HONEST_UPSTREAM}" — PayPal documents no revoke endpoint`,
        );
      }
      if (r.clearedLocally !== true && r.clearedLocally !== false) {
        problems.push("revocation.clearedLocally must be true or false");
      }
      // The seller's sentence has to be IN the file, because the file is what 28-25 reads. A local
      // clear reported without it is a local clear one edit away from being called a revocation.
      if (r.clearedLocally === true && r.grantRemainsGrantedUpstream !== true) {
        problems.push(
          "a local clear must record that anything PayPal granted stays granted until the seller removes it",
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
 * Assemble an evidence document. ONE builder for both modes on purpose: a self-test that exercised a
 * second, prettier assembly path would prove nothing about the file a live run writes.
 */
export function buildEvidence({ mode, environment, reads, revocation, requestCount }) {
  return {
    schema: SCHEMA,
    provider: PROVIDER,
    environment,
    mode,
    recordedAt: new Date().toISOString(),
    // Derived, never passed in: an operator who could type this could type `true` for a sandbox run.
    probativeForProduction: mode === "live" && environment === "production",
    reads,
    revocation,
    requestCount,
    openCondition: {
      id: OPEN_CONDITION,
      // ALWAYS false. The observation goes in `observed`; the verdict is 28-25's.
      resolved: false,
      observed:
        mode === "self-test"
          ? "NOT OBSERVED — this file came from a stub, no request reached PayPal"
          : "no revoke was attempted: PayPal documents none anywhere. Disconnect deleted Pikar's local copy only.",
    },
    // Restated in the artefact so both survive being pasted somewhere without this script.
    admissionNote:
      "PayPal's approved_production decision (2026-08-27) rests on an OWNER ATTESTATION of partner acceptance. It is testimony, not evidence, and nothing in this repository verified it.",
    sandboxNote:
      "PayPal sandbox calls work BEFORE partner approval and a PayPal representative later copies a sandbox configuration to the live account. A green sandbox run proves parsing and nothing about production authorization.",
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
  let requestCount = 0;
  for (const entity of ENTITIES) {
    const r = convexRun("paypalConnector:paypalReadEvidence", { tenantId, environment, entity });
    reads.push({
      entity: r.entity,
      state: r.state,
      itemCount: r.itemCount,
      capped: r.capped,
      missing: r.missing ?? null,
      rejected: r.rejected ?? 0,
      retrievedAt: r.retrievedAt ?? null,
      // COUNT ONLY. A source ref is a PayPal transaction id belonging to the business.
      refCount: r.refCount ?? 0,
      // A BOOLEAN, reported BY the deployment. An operator-supplied value would be an unverified
      // claim about the one fact that separates a tenant's revenue from Pikar's own.
      delegatedMerchant: r.delegatedMerchant === true,
    });
    if (r.state !== "unavailable") requestCount += 1;
  }

  const connected = reads.some((r) => r.state !== "unavailable");
  if (!connected) {
    console.error("LIVE_EVIDENCE_NOT_PRODUCED: no delegated PayPal grant exists for this tenant.");
    console.error("  This is the EXPECTED state today, and it is not a bug in this script:");
    console.error(
      "  PayPal publishes no third-party read surface (`partner-transactions` is named",
    );
    console.error(
      "  in the spec with no published operation), so paypalAuth.beginConnect refuses.",
    );
    console.error("  An app client-credentials token would read PIKAR'S OWN account, not a");
    console.error("  tenant's, and this lane will not pretend otherwise.");
    console.error("  Resolving it is 28-25's job, with the assigned PayPal partner manager.");
    console.error("  The two deployment env names this needs are listed at the top of this file.");
    console.error("  Offline proof of this script's own guards: --self-test");
    process.exit(2);
  }

  if (reads.some((r) => r.state !== "unavailable" && r.delegatedMerchant !== true)) {
    console.error("LIVE_EVIDENCE_NOT_PRODUCED: a read succeeded on a credential bound to Pikar's");
    console.error(
      "  own PayPal account. That is Pikar's money, not this tenant's, and recording it",
    );
    console.error("  as lane evidence is the precise defect this lane exists to prevent.");
    process.exit(2);
  }

  let revocation = null;
  if (doRevoke) {
    const result = convexRun("paypalAuth:disconnectForTenant", {
      tenantId,
      environment,
      confirm: "revoke",
    });
    revocation = {
      upstream: result.upstream,
      clearedLocally: result.cleared === true,
      // THE SENTENCE THE SELLER IS OWED, carried in the artefact rather than left to prose.
      grantRemainsGrantedUpstream: true,
    };
  }

  return buildEvidence({ mode: "live", environment, reads, revocation, requestCount });
}

// ── The self-test ─────────────────────────────────────────────────────────────────────────

/** A STUBBED transcript: what two bounded reads look like when they worked. */
const STUB_READS = [
  {
    entity: "transactions",
    state: "partial",
    itemCount: 500,
    capped: true,
    missing: "the read stopped at the page_cap",
    rejected: 0,
    retrievedAt: Date.now(),
    refCount: 200,
    delegatedMerchant: true,
  },
  {
    entity: "balances",
    state: "ready",
    itemCount: 1,
    capped: false,
    missing: null,
    rejected: 0,
    retrievedAt: Date.now(),
    refCount: 0,
    delegatedMerchant: true,
  },
];

/** The stub file, built by the SAME builder a live run uses. Must validate clean. */
const GOOD = () =>
  buildEvidence({
    mode: "self-test",
    environment: "sandbox",
    reads: STUB_READS.map((r) => ({ ...r })),
    revocation: {
      upstream: "unsupported",
      clearedLocally: true,
      grantRemainsGrantedUpstream: true,
    },
    requestCount: 6,
  });

const mutate = (fn) => {
  const doc = GOOD();
  fn(doc);
  return doc;
};

const CASES = [
  ["the stub file this script builds validates", GOOD(), 0],
  ["a wrong schema is refused", mutate((d) => (d.schema = "something/v9")), 1],
  ["a wrong provider is refused", mutate((d) => (d.provider = "stripe")), 1],
  ["an unknown mode is refused", mutate((d) => (d.mode = "probably")), 1],
  ["a bad environment is refused", mutate((d) => (d.environment = "staging")), 1],
  ["stale evidence is refused", mutate((d) => (d.recordedAt = "2020-01-01T00:00:00.000Z")), 1],
  [
    "future-dated evidence is refused",
    mutate((d) => (d.recordedAt = "2099-01-01T00:00:00.000Z")),
    1,
  ],
  [
    "a SANDBOX file claiming production probativeness is refused — sandbox works before approval",
    mutate((d) => (d.probativeForProduction = true)),
    1,
  ],
  [
    "a SELF-TEST file claiming production probativeness is refused, even in production",
    mutate((d) => {
      d.environment = "production";
      d.probativeForProduction = true;
    }),
    1,
  ],
  [
    "a file that states no probativeness at all is refused",
    mutate((d) => delete d.probativeForProduction),
    1,
  ],
  ["evidence with no reads is refused", mutate((d) => (d.reads = [])), 1],
  [
    "an entity outside the allow-list is refused",
    mutate((d) => (d.reads[0].entity = "partner-transactions")),
    1,
  ],
  ["a capped read calling itself ready is refused", mutate((d) => (d.reads[1].capped = true)), 1],
  [
    "a partial read naming nothing missing is refused",
    mutate((d) => (d.reads[0].missing = null)),
    1,
  ],
  [
    "an unavailable read reporting items is refused — missing is unknown, never zero",
    mutate((d) => (d.reads[1].state = "unavailable")),
    1,
  ],
  [
    "A READ OF PIKAR'S OWN ACCOUNT THAT PRODUCED ROWS IS REFUSED — the defect this lane exists to stop",
    mutate((d) => (d.reads[1].delegatedMerchant = false)),
    1,
  ],
  [
    "a read that states no merchant binding at all is refused",
    mutate((d) => delete d.reads[0].delegatedMerchant),
    1,
  ],
  [
    "revocation claiming CONFIRMED is refused — PayPal documents no revoke endpoint",
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
    "a local clear that does NOT say the grant stays granted upstream is refused",
    mutate((d) => delete d.revocation.grantRemainsGrantedUpstream),
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
  ["a leaked merchant id is refused", mutate((d) => (d.note = "merchantId=2J6QB8YJQSJRJ")), 1],
  ["a leaked account number is refused", mutate((d) => (d.note = "account_number: 123")), 1],
  ["a leaked payer block is refused", mutate((d) => (d.note = "payer_info")), 1],
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
  console.log("  Nothing here has spoken to PayPal, and PayPal's SANDBOX could not prove it if it");
  console.log("  had: sandbox calls work BEFORE partner approval. The lane stays `parked` and");
  console.log(`  the open condition ${OPEN_CONDITION} stays UNRESOLVED.`);
  console.log("  PayPal's approved_production marker rests on OWNER ATTESTATION, not on evidence.");
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
    console.log("smoke-paypal-read --self-test (offline, no network, no deployment)\n");
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
      `  ${doc.reads.length} read(s), mode ${doc.mode}, environment ${doc.environment}, recorded ${doc.recordedAt}`,
    );
    if (doc.mode !== "live") {
      // A well-formed stub is still a stub. Saying so here is the difference between a lane that is
      // CONSISTENT and a lane that has PASSED.
      console.log("");
      console.log("  *** THIS FILE IS A STUB, NOT A LIVE PASS. ***");
      console.log("  It is well-formed and it proves the validator. It is not lane evidence and");
      console.log("  28-25 must not seal on it.");
    } else if (doc.environment !== "production") {
      console.log("");
      console.log("  *** SANDBOX EVIDENCE IS NON-PROBATIVE ABOUT PRODUCTION. ***");
      console.log("  PayPal states sandbox calls work BEFORE partner approval, and a PayPal");
      console.log(
        "  representative later copies a sandbox configuration to the live account. This",
      );
      console.log("  file proves parsing. It does not corroborate the partner attestation.");
    }
    console.log(`  open condition ${OPEN_CONDITION}: UNRESOLVED (28-25 owns the seal)`);
    return;
  }

  const tenantId = value("--tenant", "");
  const environment = value("--environment", "production");
  const out = value("--out", "paypal-lane-evidence.json");
  if (!tenantId) {
    console.error("LIVE_EVIDENCE_NOT_PRODUCED: no tenant.");
    console.error("  Pass --tenant <id>. But note that NO PayPal grant can exist today: PayPal");
    console.error("  publishes no third-party read surface, so paypalAuth.beginConnect refuses");
    console.error("  rather than offering the app's own credentials as a tenant connection.");
    console.error("  The two deployment env names this needs are listed at the top of this file.");
    console.error("  Offline proof of this script's own guards: --self-test");
    process.exit(2);
  }
  const doRevoke = flag("--revoke");
  console.log(
    `smoke-paypal-read — ${environment}, ${doRevoke ? "read + LOCAL CLEAR" : "read only"}`,
  );
  if (doRevoke) {
    console.log("  WARNING: --revoke deletes Pikar's stored credential. It does NOT revoke");
    console.log("  anything at PayPal: no revoke endpoint is documented, and anything the seller");
    console.log("  granted stays granted until the seller removes it from their own account.");
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
  console.log("  This is an OBSERVATION. 28-25 decides whether it clears the condition.");
  if (environment !== "production") {
    console.log("  AND IT IS SANDBOX EVIDENCE, which PayPal's own documentation makes");
    console.log("  non-probative about production authorization.");
  }
}

// Not `import.meta.main` — that is Bun/Deno. This is the portable form.
if (process.argv[1]?.endsWith("smoke-paypal-read.mjs")) main(process.argv.slice(2));
