#!/usr/bin/env node

/**
 * COLLECT A LIVE TRACE FOR ONE RECURRENCE GATE ROW — or refuse, loudly, and write nothing.
 *
 * WHY THIS EXISTS. `check-routine-gate.mjs --eligibility` will not offer `enable-safe` until
 * `oauth-expiry-reauth`, `dst-boundary` and `provider-read` each carry `evidenceType: live`. Its own
 * docstring is candid about the ceiling of its citation check: `checkEvidenceRef` proves a ref names
 * a non-empty file inside the repo and NOTHING MORE. So a `live` row could cite `README.md`, or the
 * very unit test whose insufficiency is the reason the row exists — and round 1 of that script
 * shipped exactly that hole, with twelve fabricated rows passing all three modes.
 *
 * This script is the other half: it produces a STRUCTURED ARTIFACT that says which probe ran and
 * what was observed, and `checkLiveEvidenceArtifact` (in the gate) requires a `live` row to cite one
 * whose `probe:` matches the row id. Relabelling a unit test as `live` stops being a one-word edit.
 *
 * THE CEILING, STATED SO NOBODY OVERREADS IT. A determined editor can hand-write an artifact that
 * claims `observed: true`. Nothing in a file-based evidence scheme can prevent that. What changes is
 * that the lie must now be a deliberately forged structured record naming a probe and a result,
 * rather than a plausible-looking path in one field — the same standard the gate already applies to
 * `decidedBy`: a closed set cannot stop a lie, it stops the lie being invisible.
 *
 * ═══ WHAT IS AND IS NOT EXERCISED, READ THIS BEFORE TRUSTING A GREEN RUN ═══
 *
 * `dst-boundary` NO LONGER ANSWERS ITSELF WITH ARITHMETIC. Until 47-09 this probe compared the
 * zone's UTC offset 24 hours ago with its offset now and wrote an artifact when they differed.
 * That is a true statement about ICU's tz database and it evidences NOTHING about this
 * deployment's scheduler, which is what the row is about. Any laptop could produce it, on any
 * day after any transition, with no deployment involved at all.
 *
 * ADR-046 D9 named the replacement: a throwaway `ctx.scheduler` function, armed on a real
 * deployment BEFORE a real transition and observed to fire on the far side of it. That is
 * `convex/dstProbe.ts`. This probe now READS the two audit rows that function leaves behind and
 * refuses if they are not there. The arithmetic below survives as the INDEPENDENT CHECK: the
 * deployment reports the offsets it saw, and this script asks its own ICU whether a transition
 * really fell between the armed and fired instants. Two witnesses, and they must agree.
 *
 * `oauth-expiry-reauth` and `provider-read` have their PRECONDITION half complete and their
 * COLLECTION half unexercised, because there is nothing on this deployment to collect from: every
 * `gmailTokens` row reads `packeval-not-a-real-token` and `connectorConnections` is empty (measured
 * 2026-08-30). Both refuse correctly on that state, and that refusal IS tested. The provider call
 * each would make on a deployment holding a real grant has never run. Do not read a passing
 * `--self-check` as evidence that it would work; read it as evidence that it cannot fake a result.
 *
 * Usage:
 *   collect-recurrence-evidence.mjs <probe> --deployment <name> [--out <dir>]
 *   collect-recurrence-evidence.mjs --self-check
 *
 * Exit 0 = an artifact was written. Exit 1 = the probe refused (reason printed, NOTHING written).
 * Exit 2 = bad usage. A refusal is the expected outcome today for two of the three probes.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");

/** The three rows `--eligibility` requires a LIVE trace for. Same ids as the gate's REQUIRED_LIVE_ROWS. */
export const PROBES = ["oauth-expiry-reauth", "dst-boundary", "provider-read"];

/** The marker that makes an artifact identifiable as machine-collected. Version it: a format change
 *  must not let an old artifact satisfy a new rule by accident. */
export const ARTIFACT_MARKER = "<!-- recurrence-evidence v1 -->";

/**
 * Render the artifact. PURE, so `--self-check` can prove its shape and the gate's reader can be
 * tested against the exact bytes this writes rather than against a hand-typed approximation.
 *
 * REFS AND COUNTS ONLY (CLAUDE.md §4). `detail` is whitelisted to primitives at the call sites
 * below; there is no field here for a token, a message body, an address or a customer name, and
 * that absence is the enforcement.
 */
export function renderArtifact({ probe, observed, collectedAt, deployment, detail }) {
  assert.ok(PROBES.includes(probe), `unknown probe ${probe}`);
  // FAIL CLOSED ON THE ONE FIELD THAT MATTERS. There is deliberately no way to render an artifact
  // that claims an observation this script did not make: the caller cannot pass `observed: false`
  // and get a file, because a refusal writes nothing at all.
  assert.equal(observed, true, "an artifact is only ever written for an OBSERVED probe");
  const lines = [
    ARTIFACT_MARKER,
    `probe: ${probe}`,
    "observed: true",
    `collectedAt: ${collectedAt}`,
    `deployment: ${deployment}`,
    "",
    "detail:",
    ...Object.entries(detail).map(([k, v]) => `  ${k}: ${String(v)}`),
    "",
  ];
  return lines.join("\n");
}

/**
 * Has `zone` crossed a DST transition between two instants?
 *
 * The whole `dst-boundary` question in one function, and it needs no provider: compare the zone's
 * UTC offset at both instants. `Intl.DateTimeFormat` with `timeZoneName: "shortOffset"` is in every
 * Node this repo runs, so there is no dependency to add.
 */
export function crossedDstBoundary(zone, fromMs, toMs) {
  const offsetAt = (ms) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date(ms));
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  };
  const from = offsetAt(fromMs);
  const to = offsetAt(toMs);
  return { crossed: from !== to, from, to };
}

/**
 * When does `zone` next change offset, scanning forward day by day from `fromMs`?
 *
 * DERIVED, NEVER A DATE LIST. The first version of this file's refusal message named "2026-10-25
 * (EU), 2026-11-01 (US)" as when a DST trace becomes possible. That was WRONG BY SEVEN WEEKS:
 * America/Santiago transitions 2026-09-07, and so does Pacific/Easter. The error was a northern
 * hemisphere assumption — the two zones a European or American engineer thinks of first — written
 * into a constant where nothing could contradict it.
 *
 * A hardcoded answer to "when is the next transition" is wrong the moment a tenant lives somewhere
 * the author did not picture, and it is wrong again every year. `Intl` already holds the whole tz
 * database; asking it is both shorter and correct.
 *
 * Day-granularity: it answers WHICH DAY to schedule for, not the exact instant, which is all a
 * refusal message needs. Returns `null` if the zone has no transition in the window.
 */
export function nextTransition(zone, fromMs, days = 400) {
  const offsetAt = (ms) =>
    new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(new Date(ms))
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  let prev = offsetAt(fromMs);
  for (let d = 1; d <= days; d++) {
    const ms = fromMs + d * 86_400_000;
    const now = offsetAt(ms);
    if (now !== prev) return { day: new Date(ms).toISOString().slice(0, 10), from: prev, to: now };
    prev = now;
  }
  return null;
}

/**
 * The soonest transition anywhere, and the zones that reach it first. This is what a refusal should
 * quote: the earliest date on which SOME tenant could carry this evidence.
 */
export function soonestTransition(fromMs) {
  let best = null;
  for (const zone of Intl.supportedValuesOf("timeZone")) {
    const t = nextTransition(zone, fromMs, 200);
    if (t === null) continue;
    if (best === null || t.day < best.day) best = { day: t.day, zones: [zone] };
    else if (t.day === best.day && best.zones.length < 3) best.zones.push(zone);
  }
  return best;
}

/** The probe implementations. Each returns `{ observed: false, reason }` or `{ observed: true, detail }`. */
const COLLECTORS = {
  /**
   * THE SCHEDULER'S OWN TRACE, read back from the deployment. Never computed here.
   *
   * `convex/dstProbe.ts` writes two `audit` rows under one correlation: `armed` when the call is
   * booked, `fired` when it actually runs. This probe demands BOTH, and then applies four
   * independent tests before it will call anything observed. Three of them exist because each is
   * a way the row could read green while evidencing nothing:
   *
   *   1. Both halves present, under ONE correlation. A `fired` row alone cannot show when it was
   *      armed, and "armed before the transition" is the entire claim.
   *   2. THIS SCRIPT'S OWN ICU agrees a transition fell between the armed and fired instants.
   *      The deployment reporting its own offsets is one witness; a checker that took that on
   *      trust would be reading the claim back rather than checking it.
   *   3. The deployment's own offsets differ across the two rows. The other direction of the same
   *      question, asked of the runtime that actually ran the job — if these two witnesses ever
   *      disagree, THAT is the finding, and it is a tzdata skew nobody would otherwise see.
   *   4. It did not fire EARLY. A call that ran before its target instant never crossed anything,
   *      whatever the offsets say.
   */
  "dst-boundary": ({ zone, runConvex, nowMs }) => {
    const rows = runConvex("dstProbeRows", { sinceMs: nowMs - PROBE_LOOKBACK_MS });
    if (rows === UNREACHABLE) return { observed: false, reason: UNREACHABLE_REASON };
    if (rows === null) return { observed: false, reason: noProbeReason(zone, nowMs) };

    const mine = rows.filter((r) => r?.payload?.zone === zone);
    const fired = mine.find((r) => r.payload.phase === "fired");
    if (!fired) return { observed: false, reason: noProbeReason(zone, nowMs, mine) };
    const armed = mine.find(
      (r) => r.payload.phase === "armed" && r.correlationId === fired.correlationId,
    );
    if (!armed) {
      return {
        observed: false,
        reason:
          `a fired row exists for ${zone} but its \`armed\` half is missing under correlation ` +
          `${fired.correlationId}. Without it there is no record of WHEN the call was booked, and ` +
          '"armed before the transition" is the whole claim. Arm a fresh probe rather than ' +
          "inferring the missing instant.",
      };
    }

    const armedAtMs = Number(armed.payload.armedAtMs);
    const firedAtMs = Number(fired.payload.firedAtMs);
    const targetAtMs = Number(fired.payload.fireAtMs);
    if (!Number.isFinite(armedAtMs) || !Number.isFinite(firedAtMs)) {
      return { observed: false, reason: "the probe rows carry no usable instants" };
    }

    // WITNESS TWO: this script's ICU, asked independently of whatever the deployment reported.
    const local = crossedDstBoundary(zone, armedAtMs, firedAtMs);
    if (!local.crossed) {
      return {
        observed: false,
        reason:
          `the probe fired, but THIS runtime sees ${zone} holding ${local.from} across the whole ` +
          `armed-to-fired window (${new Date(armedAtMs).toISOString()} -> ` +
          `${new Date(firedAtMs).toISOString()}). A run that spans no transition evidences nothing.`,
      };
    }
    // The deployment's own reading of the same question.
    const deployedBefore = String(fired.payload.offsetAtArm ?? "");
    const deployedAfter = String(fired.payload.offsetAtFire ?? "");
    if (deployedBefore === deployedAfter) {
      return {
        observed: false,
        reason:
          `THE TWO WITNESSES DISAGREE, and that is the finding rather than a missing probe. This ` +
          `runtime says ${zone} moved ${local.from} -> ${local.to} across the window; the ` +
          `deployment that ran the job reported ${deployedBefore} at both ends. One of the two ` +
          "tzdata sets is stale. Do not record this row until they agree.",
      };
    }
    if (Number.isFinite(targetAtMs) && firedAtMs < targetAtMs) {
      return {
        observed: false,
        reason:
          `the call fired ${targetAtMs - firedAtMs}ms BEFORE its target instant, so it did not ` +
          "cross the boundary it was armed for.",
      };
    }

    return {
      observed: true,
      // REFS, COUNTS AND TIMESTAMPS ONLY (§4). A zone, four instants, two offsets and a wall time.
      detail: {
        zone,
        correlationId: fired.correlationId,
        armedAt: new Date(armedAtMs).toISOString(),
        targetAt: Number.isFinite(targetAtMs) ? new Date(targetAtMs).toISOString() : "unknown",
        firedAt: new Date(firedAtMs).toISOString(),
        heldForMs: firedAtMs - armedAtMs,
        driftMs: Number.isFinite(targetAtMs) ? firedAtMs - targetAtMs : "unknown",
        wallClockAtFire: String(fired.payload.wallClockAtFire ?? "unavailable"),
        offsetBefore: deployedBefore,
        offsetAfter: deployedAfter,
        offsetBeforeLocal: local.from,
        offsetAfterLocal: local.to,
      },
    };
  },

  /**
   * A TOKEN THAT EXPIRED AND WAS SILENTLY RE-AUTHED. The observation is that `gmailTokens.expiresAt`
   * ADVANCED across a read that needed a valid access token — a fact about stored state before and
   * after, not a claim the script makes about itself.
   *
   * WHY IT DRIVES `gmail:listInbox` RATHER THAN THE REFRESH ENDPOINT. The refresh is not a thing a
   * user asks for; it happens because a real call needed a valid token. Calling the provider's
   * refresh URL directly would exercise a path production never takes and would need this script to
   * hold credentials, which it must not. Driving the app's own bounded read means the trace is of
   * the code that actually runs, through the same seam a scheduled routine would hit.
   *
   * REFUSES rather than reports when the token has NOT expired: a read that never needed a refresh
   * is not evidence of one, and calling it so would be the relabelling this whole gate exists for.
   */
  "oauth-expiry-reauth": ({ tenant, runConvex }) => {
    if (!tenant) return { observed: false, reason: NEEDS_TENANT };
    const before = runConvex("gmailAuthState", { tenantId: tenant });
    if (before === UNREACHABLE) return { observed: false, reason: UNREACHABLE_REASON };
    if (before === null) return { observed: false, reason: NO_GRANT };
    if (!before.real) return { observed: false, reason: FIXTURE_GRANT };
    if (typeof before.expiresAt !== "number") {
      return {
        observed: false,
        reason:
          "the stored grant has no `expiresAt`, so there is no before-and-after to compare. " +
          "Nothing can be observed about a refresh that has no clock.",
      };
    }
    if (before.expiresAt > Date.now()) {
      return {
        observed: false,
        reason:
          `the access token is still valid until ${new Date(before.expiresAt).toISOString()}, so a ` +
          "read will NOT trigger a refresh and there is nothing to observe. Re-run after it lapses " +
          "— that wait is the point: a refresh nobody needed is not evidence that refresh works.",
      };
    }
    const read = runConvex("listInbox", { tenantId: tenant });
    if (read === null) return { observed: false, reason: "the read failed — no refresh observed" };
    const after = runConvex("gmailAuthState", { tenantId: tenant });
    if (
      after === null ||
      typeof after.expiresAt !== "number" ||
      after.expiresAt <= before.expiresAt
    ) {
      return {
        observed: false,
        reason:
          "the read succeeded but the stored expiry did NOT advance, so no refresh happened on this " +
          "path. Whatever made the read work, it was not the re-auth this row is about.",
      };
    }
    return {
      observed: true,
      // REFS AND COUNTS ONLY (§4): a provider name and two instants. Never a token, never a subject.
      detail: {
        provider: "gmail",
        expiredAt: new Date(before.expiresAt).toISOString(),
        renewedUntil: new Date(after.expiresAt).toISOString(),
      },
    };
  },

  /** A BOUNDED LIVE READ through the app's own adapter. Counts only — there is nowhere here to put
   *  a subject, an address or a body, and that absence is the enforcement. */
  "provider-read": ({ tenant, runConvex }) => {
    if (!tenant) return { observed: false, reason: NEEDS_TENANT };
    const state = runConvex("gmailAuthState", { tenantId: tenant });
    if (state === UNREACHABLE) return { observed: false, reason: UNREACHABLE_REASON };
    if (state === null) return { observed: false, reason: NO_GRANT };
    if (!state.real) return { observed: false, reason: FIXTURE_GRANT };
    const read = runConvex("listInbox", { tenantId: tenant });
    if (read === null || typeof read.count !== "number") {
      return { observed: false, reason: "the read did not return a count — nothing observed" };
    }
    return { observed: true, detail: { provider: "gmail", itemCount: read.count } };
  },
};

/**
 * How far back to look for the probe's rows. The armed half is written WEEKS before the fired
 * half, and `audit:recentByType` defaults to a seven-day window — so an unstated `sinceMs` would
 * silently return the `fired` row alone and this probe would refuse for entirely the wrong reason.
 * 120 days covers any pair of consecutive transitions anywhere on earth.
 */
const PROBE_LOOKBACK_MS = 120 * 86_400_000;

/** The eventType `convex/dstProbe.ts` writes under. One literal, two places — keep them equal. */
const DST_PROBE_EVENT = "clock.dst_probe";

/**
 * "There is no trace yet" — and the exact command that would start one.
 *
 * A REFUSAL NOBODY CAN ACT ON IS ITS OWN DEAD END, and this one has an 18-day-to-six-month lead
 * time, so being told WHAT to run and WHEN is the difference between a gate that opens this month
 * and one that opens next year. The dates are DERIVED from ICU rather than remembered: the first
 * version of this file's refusal named "2026-10-25 (EU), 2026-11-01 (US)" and was wrong by seven
 * weeks, because America/Santiago transitions in September and a northern-hemisphere author does
 * not picture it.
 */
function noProbeReason(zone, nowMs, seen = []) {
  const own = nextTransition(zone, nowMs);
  const soonest = soonestTransition(nowMs);
  const pending = seen.filter((r) => r.payload?.phase === "armed").length;
  const target = own === null ? null : Date.parse(`${own.day}T12:00:00Z`);
  return (
    `no completed \`${DST_PROBE_EVENT}\` trace for ${zone}` +
    (pending > 0
      ? ` — ${pending} armed row(s) are waiting for their transition, which has not arrived yet. ` +
        "That is the expected state between arming and firing; nothing is wrong."
      : " — nothing has been armed on this deployment.") +
    (own === null
      ? ` ${zone} has no transition in the next 400 days, so it can never carry this row.`
      : ` ${zone} next transitions on ${own.day} (${own.from} -> ${own.to}).`) +
    (soonest === null ? "" : ` Earliest anywhere: ${soonest.day} (${soonest.zones.join(", ")}).`) +
    (target === null
      ? ""
      : "\n  To arm it, pick an instant on the FAR SIDE of that transition and run:\n" +
        `    node node_modules/convex/bin/main.js run internal:dstProbe:arm ` +
        `'{"zone":"${zone}","fireAtMs":${target}}'${
          process.env.PIKAR_CONVEX_TARGET === "prod" ? " --prod" : ""
        }\n` +
        "  (from packages/backend. `arm` refuses any window with no transition in it, so a wrong\n" +
        "  instant is loud rather than silently useless.)")
  );
}

const NEEDS_TENANT =
  "--tenant <id> is required: the tenant holding the grant is not guessed. Discovering it by " +
  "scanning would make this script pick WHOSE data is read, which is exactly the decision it must " +
  "never make.";
const UNREACHABLE_REASON =
  "the deployment did not answer the probe. This is NOT 'there is no grant' — it is 'the question " +
  "was never asked'. Check that `convex dev` is running and that CONVEX_DEPLOYMENT points where you " +
  "think, then re-run. Diagnosing this as a missing connection would send you to fix the wrong thing.";
const NO_GRANT =
  "no provider grant for that tenant on this deployment. Connect one on the deployment that will " +
  "carry the evidence, then re-run.";
const FIXTURE_GRANT =
  "that tenant's grant is a FIXTURE token, not a real one — a read against it exercises the " +
  "offline seam and observes nothing about a provider.";

/**
 * Drive ONE of the two refs-only probe surfaces on the deployment, and return its parsed result.
 *
 * ONLY THESE TWO FUNCTIONS ARE REACHABLE FROM HERE, and that is the point. An earlier draft scraped
 * `npx convex data gmailTokens`, which prints REFRESH TOKENS to stdout — a probe that leaks the
 * credential it is probing. `gmailAuth.grantState` returns `{present, real, expiresAt}` and
 * `gmail.probeReadCount` returns `{ok, count}`; neither can return token material or a message,
 * so there is nothing for this script to accidentally capture, print or write into an artifact.
 *
 * Returns `null` on any failure. A probe that cannot read the state REFUSES — it never guesses.
 */
function convexProbe(fn, args) {
  try {
    // SPAWN THE CLI'S JS ENTRYPOINT WITH THIS NODE, not `npx`. Two failed attempts got us here and
    // both are worth recording, because the second looked like the fix:
    //   `npx`     -> ENOENT  (a .cmd shim on win32; execFile does not resolve it)
    //   `npx.cmd` -> EINVAL  (Node 24 refuses to execFile a .cmd without a shell — CVE-2024-27980)
    // `shell: true` would work but then the JSON argument has to survive cmd.exe quoting, which is
    // a second fragile thing to get right on every platform. Resolving `convex/package.json` and
    // running its `bin` with `process.execPath` needs no shell at all, so the JSON crosses as one
    // argv element exactly as written.
    //
    // NONE OF THIS WAS VISIBLE UNTIL THE SENTINEL EXISTED. Every one of these failures returned the
    // same `null` as "this tenant has no grant", so the probe confidently reported a missing
    // connection on a deployment that was answering perfectly well — and I believed it and said so.
    const cliRequire = createRequire(join(REPO_ROOT, "packages", "backend", "package.json"));
    const cliPkg = cliRequire.resolve("convex/package.json");
    const cli = join(dirname(cliPkg), "bin", "main.js");
    // WHICH DEPLOYMENT, stated per invocation and never guessed — `check-provider-lane.mjs:502`'s
    // convention. The evidence that matters is production's, and a probe that read dev while
    // reporting "prod" would be the worst kind of green.
    const target = process.env.PIKAR_CONVEX_TARGET === "prod" ? ["--prod"] : [];
    const out = execFileSync(process.execPath, [cli, "run", ...target, fn, JSON.stringify(args)], {
      cwd: join(REPO_ROOT, "packages", "backend"),
      encoding: "utf8",
      // stderr PIPED, not ignored: the crash path needs `err.stdout`, and node only populates the
      // error's captured streams when they were piped.
      stdio: ["ignore", "pipe", "pipe"],
    });
    return parseProbeOutput(out);
  } catch (err) {
    // THE CLI CRASHES ON EXIT AFTER PRINTING THE ANSWER. On win32 the convex CLI reliably ends with
    // `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` — a libuv teardown assert that fires
    // AFTER stdout is complete. `execFileSync` throws on the non-zero exit, so a probe that trusted
    // the exception would discard a result it already had, intermittently, depending on timing.
    //
    // That flapping is exactly what happened here: the same tenant read as "no grant" once and
    // "unreachable" the next time, from one process crashing a few milliseconds differently.
    // So the RESULT decides, not the exit code: if the captured stdout parses, it is the answer.
    return parseProbeOutput(String(err?.stdout ?? ""));
  }
}

/** stdout -> parsed object, or UNREACHABLE when there is nothing to parse. The ONE place output
 *  becomes an answer, so the success and crash paths cannot diverge in how they read it. */
function parseProbeOutput(out) {
  // AN ARRAY IS A VALID ANSWER. `audit:recentByType` returns a LIST, and the original
  // `/\{[\s\S]*\}/` would have matched from the first inner `{` to the last `}` — i.e. sliced the
  // brackets off and handed `JSON.parse` a fragment. That failure would have read as UNREACHABLE,
  // which is the one diagnosis this function exists to keep separate from the others.
  const start = out.search(/[[{]/);
  if (start < 0) return UNREACHABLE;
  const end = Math.max(out.lastIndexOf("]"), out.lastIndexOf("}"));
  if (end <= start) return UNREACHABLE;
  try {
    return JSON.parse(out.slice(start, end + 1));
  } catch {
    return UNREACHABLE;
  }
}

/**
 * "THE DEPLOYMENT DID NOT ANSWER" — distinct from "it answered, and there is no grant".
 *
 * Without this the two are the same `null`, and the refusal message says "no provider grant for that
 * tenant" whether the tenant genuinely has none or the CLI blew up, the deployment was down, or the
 * function name was wrong. That is the identical defect this session fixed in `shouldRecordEvidence`
 * — a check that cannot tell "we looked and it was absent" from "we could not look" is reporting a
 * conclusion it did not reach. Here it is milder (a refusal either way, never a false artifact) but
 * it sends an operator to connect a provider when the real problem is that `convex dev` is not
 * running, and a wrong diagnosis costs more than a missing one.
 */
const UNREACHABLE = Symbol("probe-unreachable");
/** Alias used by `--self-check`, so the stub cannot accidentally pass a look-alike. */
const UNREACHABLE_SENTINEL_FOR_TEST = UNREACHABLE;

/** The probe surface, named so the collectors read declaratively and the self-check can stub it. */
function makeRunConvex(correlationId) {
  return (what, args) => {
    if (what === "gmailAuthState") {
      const r = convexProbe("gmailAuth:grantState", args);
      if (r === UNREACHABLE) return UNREACHABLE;
      if (r === null || r.present !== true) return null;
      return { real: r.real === true, expiresAt: r.expiresAt };
    }
    if (what === "dstProbeRows") {
      const r = convexProbe("audit:recentByType", {
        eventType: DST_PROBE_EVENT,
        sinceMs: args.sinceMs,
        limit: 100,
      });
      if (r === UNREACHABLE) return UNREACHABLE;
      // An EMPTY ARRAY is an answer ("we looked, there is nothing"), not a failure to look. Only a
      // non-array is unreadable. Collapsing the two is the defect the UNREACHABLE sentinel exists
      // for, and it would report "nothing armed" on a deployment that never answered.
      if (!Array.isArray(r)) return UNREACHABLE;
      return r.length === 0 ? null : r;
    }
    if (what === "listInbox") {
      const r = convexProbe("gmail:probeReadCount", { ...args, correlationId });
      if (r === UNREACHABLE) return UNREACHABLE;
      if (r === null || r.ok !== true) return null;
      return { count: r.count };
    }
    throw new Error(`unknown probe surface ${what}`);
  };
}

function selfCheck() {
  // 1. The artifact writer CANNOT be made to claim an unobserved result.
  assert.throws(
    () =>
      renderArtifact({
        probe: "provider-read",
        observed: false,
        collectedAt: "t",
        deployment: "d",
        detail: {},
      }),
    /only ever written for an OBSERVED probe/,
    "renderArtifact must refuse to write a false observation",
  );
  assert.throws(
    () =>
      renderArtifact({
        probe: "not-a-probe",
        observed: true,
        collectedAt: "t",
        deployment: "d",
        detail: {},
      }),
    /unknown probe/,
    "an artifact for a row the gate does not know is not evidence for anything",
  );

  // 2. A rendered artifact carries its marker and names its probe — the two fields the gate keys on.
  const art = renderArtifact({
    probe: "dst-boundary",
    observed: true,
    collectedAt: "2026-11-01T09:00:00Z",
    deployment: "prod",
    detail: { zone: "America/New_York" },
  });
  assert.ok(art.startsWith(ARTIFACT_MARKER), "the marker must be first — the gate reads the head");
  assert.match(art, /^probe: dst-boundary$/m);
  assert.match(art, /^observed: true$/m);

  // 3. THE DST PROBE IS REAL, and both directions are proven — a positive witness first, so the
  //    refusal below cannot be passing because the function always says no.
  const NY = "America/New_York";
  const nov = Date.UTC(2026, 10, 1, 12); // after the US transition
  const oct = Date.UTC(2026, 9, 15, 12); // before it
  const crossing = crossedDstBoundary(NY, oct, nov);
  assert.equal(crossing.crossed, true, "Oct->Nov in New York MUST read as a crossing");
  assert.notEqual(crossing.from, crossing.to);
  const within = crossedDstBoundary(NY, Date.UTC(2026, 6, 1), Date.UTC(2026, 6, 2));
  assert.equal(within.crossed, false, "two July days in one zone are not a crossing");
  // The owner's own zone never transitions, which is WHY this row cannot be collected locally.
  const nairobi = crossedDstBoundary("Africa/Nairobi", oct, nov);
  assert.equal(
    nairobi.crossed,
    false,
    "UTC+3 has no DST — the local zone can never produce this row",
  );

  // 4. Each probe REFUSES on the state this deployment is actually in, and the reason is specific
  //    rather than a generic failure — a refusal nobody can act on is its own kind of dead end.
  // NO TENANT NAMED: refuse rather than go looking. Which tenant's mailbox is read is not a
  // decision a script may make for itself.
  for (const probe of ["oauth-expiry-reauth", "provider-read"]) {
    const res = COLLECTORS[probe]({ tenant: undefined, runConvex: () => null });
    assert.equal(res.observed, false, `${probe} must refuse without --tenant`);
    assert.match(res.reason, /--tenant <id> is required/);
  }
  // UNREACHABLE IS NOT "ABSENT". The whole point of the sentinel: an operator must not be sent to
  // connect a provider when the real problem is that nothing answered.
  for (const probe of ["oauth-expiry-reauth", "provider-read"]) {
    const res = COLLECTORS[probe]({ tenant: "t1", runConvex: () => UNREACHABLE_SENTINEL_FOR_TEST });
    assert.equal(res.observed, false);
    assert.match(
      res.reason,
      /the question was never asked/,
      `${probe} must distinguish unreachable`,
    );
    assert.doesNotMatch(res.reason, /no provider grant for that tenant/);
  }

  // NAMED BUT NO GRANT, and named with a FIXTURE grant — the two states every deployment here is in.
  for (const probe of ["oauth-expiry-reauth", "provider-read"]) {
    assert.match(
      COLLECTORS[probe]({ tenant: "t1", runConvex: () => null }).reason,
      /no provider grant for that tenant/,
      `${probe} must refuse when the grant is absent`,
    );
    assert.match(
      COLLECTORS[probe]({ tenant: "t1", runConvex: () => ({ real: false, expiresAt: 1 }) }).reason,
      /FIXTURE token/,
      `${probe} must refuse a fixture token — reading it observes the offline seam, not a provider`,
    );
  }
  // ═══ dst-boundary: THE SCHEDULER'S TRACE, and every way it can fail to be one ═══════════════
  //
  // The whole probe is now a reader, so each branch is driven against a stubbed deployment. The
  // POSITIVE case comes first, deliberately: without it every refusal below could be passing
  // because the collector says no to everything, which is the shape of a check that cannot fail.
  const NZ = "Pacific/Auckland";
  const nzArm = Date.UTC(2026, 8, 20, 0);
  const nzTarget = Date.UTC(2026, 8, 27, 19, 0);
  const nzFired = nzTarget + 1200;
  const dstRows = (over = {}) => [
    {
      correlationId: "dst-probe:c1",
      payload: {
        phase: "fired",
        zone: NZ,
        armedAtMs: nzArm,
        fireAtMs: nzTarget,
        firedAtMs: nzFired,
        wallClockAtFire: "2026-09-28T08:00:01",
        offsetAtArm: "GMT+12",
        offsetAtFire: "GMT+13",
        ...over,
      },
    },
    {
      correlationId: "dst-probe:c1",
      payload: { phase: "armed", zone: NZ, armedAtMs: nzArm, fireAtMs: nzTarget },
    },
  ];
  const dst = (rows, zone = NZ) =>
    COLLECTORS["dst-boundary"]({ zone, nowMs: nzFired, runConvex: () => rows });

  // POSITIVE WITNESS. A real pair, a real crossing, and the detail carries what ADR-046 D9 names.
  const dstOk = dst(dstRows());
  assert.equal(
    dstOk.observed,
    true,
    "a complete armed+fired pair across a real crossing IS the trace",
  );
  assert.equal(dstOk.detail.wallClockAtFire, "2026-09-28T08:00:01");
  assert.equal(dstOk.detail.driftMs, 1200);
  assert.ok(dstOk.detail.armedAt < dstOk.detail.firedAt, "armed must precede fired");
  // §4: nothing in the artifact may be a person, and there is nowhere to put one.
  for (const [k, v] of Object.entries(dstOk.detail)) {
    assert.ok(
      typeof v === "string" || typeof v === "number",
      `dst-boundary detail.${k} must be a primitive`,
    );
  }

  // NOTHING ARMED AT ALL — and the refusal must hand over a runnable command with a derived date.
  const dstNone = dst(null);
  assert.equal(dstNone.observed, false);
  assert.match(dstNone.reason, /nothing has been armed on this deployment/);
  assert.match(dstNone.reason, /internal:dstProbe:arm/, "the refusal must say how to arm one");
  assert.match(
    dstNone.reason,
    /"fireAtMs":\d{10,}/,
    "and with a DERIVED instant, not a placeholder",
  );
  assert.match(dstNone.reason, /Earliest anywhere: \d{4}-\d{2}-\d{2}/, "must name a derived date");

  // ARMED BUT NOT YET FIRED — the expected state for most of the wait. It must read as "not yet",
  // never as "broken", or somebody re-arms a probe that is working perfectly.
  const dstPending = dst([{ correlationId: "c2", payload: { phase: "armed", zone: NZ } }]);
  assert.equal(dstPending.observed, false);
  assert.match(dstPending.reason, /1 armed row\(s\) are waiting/);
  assert.match(dstPending.reason, /nothing is wrong/);

  // UNREACHABLE IS NOT "NOTHING ARMED". Same sentinel discipline as the other two probes.
  assert.match(
    COLLECTORS["dst-boundary"]({
      zone: NZ,
      nowMs: nzFired,
      runConvex: () => UNREACHABLE_SENTINEL_FOR_TEST,
    }).reason,
    /the question was never asked/,
  );

  // A FIRED ROW WITH NO ARMED HALF. The armed instant is the claim; it is never inferred.
  assert.match(
    dst([dstRows()[0]]).reason,
    /its `armed` half is missing/,
    "a fired row alone cannot evidence when it was armed",
  );

  // THE WINDOW SPANS NO TRANSITION, according to THIS runtime — the independent witness. The
  // deployment claimed GMT+12 -> GMT+13 and the rows are otherwise perfect; the local ICU check is
  // the only thing that can catch a forged or mistaken pair, so it must be able to.
  const flat = dst(
    dstRows({
      armedAtMs: Date.UTC(2026, 5, 1),
      firedAtMs: Date.UTC(2026, 5, 2),
      fireAtMs: Date.UTC(2026, 5, 2),
    }),
  );
  assert.equal(flat.observed, false);
  assert.match(flat.reason, /A run that spans no transition evidences nothing/);

  // THE TWO WITNESSES DISAGREE. A real crossing locally, but the deployment saw one offset at both
  // ends — a tzdata skew, which is a finding rather than a missing probe.
  const skew = dst(dstRows({ offsetAtArm: "GMT+12", offsetAtFire: "GMT+12" }));
  assert.equal(skew.observed, false);
  assert.match(skew.reason, /THE TWO WITNESSES DISAGREE/);
  assert.match(skew.reason, /tzdata sets is stale/);

  // IT FIRED EARLY. Offsets can differ across a window a call never actually crossed.
  const early = dst(dstRows({ firedAtMs: nzTarget - 5 }));
  assert.equal(early.observed, false);
  assert.match(early.reason, /BEFORE its target instant/);

  // A ZONE THAT NEVER TRANSITIONS still gets an honest refusal naming itself.
  assert.match(
    dst(null, "Africa/Nairobi").reason,
    /has no transition in the next 400 days/,
    "UTC+3 can never carry this row and the refusal must say so about the zone it was given",
  );
  // NEXT-TRANSITION, BOTH DIRECTIONS. A zone that transitions and one that never does.
  const santiago = nextTransition("America/Santiago", Date.UTC(2026, 7, 30));
  assert.ok(santiago !== null, "America/Santiago must have an upcoming transition");
  assert.match(santiago.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(
    nextTransition("Africa/Nairobi", Date.UTC(2026, 7, 30)),
    null,
    "UTC+3 has no transition in 400 days — the local zone can never carry this row",
  );
  // And the soonest-anywhere search really searches: it must beat the northern-hemisphere dates
  // that the deleted constant named, which is the whole reason that constant was wrong.
  const soonest = soonestTransition(Date.UTC(2026, 7, 30));
  assert.ok(
    soonest !== null && soonest.day < "2026-10-25",
    `soonest ${soonest?.day} must beat the old hardcoded EU date`,
  );

  // 5. THE COLLECTION HALVES, driven against a stubbed probe surface. These are the cases that
  //    were `NOT IMPLEMENTED` until 2026-08-30; they now run, and both directions are pinned.
  const FUTURE = Date.now() + 3_600_000;
  const PAST = Date.now() - 3_600_000;

  // provider-read: a real grant and a real count IS the observation.
  const readOk = COLLECTORS["provider-read"]({
    tenant: "t1",
    runConvex: (what) =>
      what === "gmailAuthState" ? { real: true, expiresAt: FUTURE } : { count: 3 },
  });
  assert.equal(readOk.observed, true, "a real grant + a real count is the provider-read trace");
  assert.deepEqual(readOk.detail, { provider: "gmail", itemCount: 3 });
  // …and a read that returns no count observes nothing, rather than reporting zero as success.
  assert.equal(
    COLLECTORS["provider-read"]({
      tenant: "t1",
      runConvex: (what) => (what === "gmailAuthState" ? { real: true, expiresAt: FUTURE } : null),
    }).observed,
    false,
  );

  // oauth-expiry-reauth: THE REFUSAL THAT MATTERS. A token that has not expired cannot produce a
  // refresh, so a read against it is not evidence of one however well it goes.
  const notYet = COLLECTORS["oauth-expiry-reauth"]({
    tenant: "t1",
    runConvex: () => ({ real: true, expiresAt: FUTURE }),
  });
  assert.equal(notYet.observed, false, "an unexpired token cannot evidence a refresh");
  assert.match(notYet.reason, /still valid until/);

  // Expired, and the stored expiry ADVANCES across the read: that is the refresh, observed.
  let call = 0;
  const refreshed = COLLECTORS["oauth-expiry-reauth"]({
    tenant: "t1",
    runConvex: (what) => {
      if (what === "listInbox") return { count: 1 };
      call += 1;
      return { real: true, expiresAt: call === 1 ? PAST : FUTURE };
    },
  });
  assert.equal(refreshed.observed, true, "expiry advancing across a read IS the re-auth trace");
  assert.equal(refreshed.detail.provider, "gmail");
  assert.ok(!("token" in refreshed.detail), "§4: no token may reach an artifact");

  // Expired, read succeeds, expiry does NOT move — something else made it work. Not this row.
  const noAdvance = COLLECTORS["oauth-expiry-reauth"]({
    tenant: "t1",
    runConvex: (what) => (what === "listInbox" ? { count: 1 } : { real: true, expiresAt: PAST }),
  });
  assert.equal(noAdvance.observed, false, "a read that refreshed nothing is not a refresh trace");
  assert.match(noAdvance.reason, /did NOT advance/);

  console.log(
    "[recurrence-evidence] self-check PASSED " +
      "(artifact writer refuses a false observation; dst-boundary now READS THE SCHEDULER'S OWN " +
      "TRACE and every failure mode is driven — nothing armed, armed-but-waiting, unreachable, a " +
      "fired row with no armed half, a window spanning no transition, the two tzdata witnesses " +
      "disagreeing, and a call that fired early — with a positive witness first so none of those " +
      "refusals can be passing vacuously; all three probes refuse on the current deployment state " +
      "with actionable reasons, and the dst refusal hands over a runnable arm command with a " +
      "DERIVED instant; and BOTH provider collection halves RUN — a real count is the " +
      "provider-read trace, an expiry ADVANCING across a read is the re-auth trace, and an " +
      "unexpired token refuses because a refresh nobody needed evidences nothing)",
  );
}

function main(argv) {
  if (argv.includes("--self-check")) {
    if (argv.length !== 1) {
      console.error("usage: --self-check takes nothing else");
      process.exit(2);
    }
    selfCheck();
    return;
  }
  const probe = argv[0];
  if (!PROBES.includes(probe)) {
    console.error(
      `usage: collect-recurrence-evidence.mjs <${PROBES.join("|")}> --deployment <name> [--tenant <id>]`,
    );
    process.exit(2);
  }
  const depIx = argv.indexOf("--deployment");
  const deployment = depIx >= 0 ? argv[depIx + 1] : undefined;
  if (!deployment) {
    console.error("--deployment <name> is required: an artifact that cannot say WHERE it was");
    console.error("collected is not a trace of anything.");
    process.exit(2);
  }
  const outIx = argv.indexOf("--out");
  const outDir = resolve(REPO_ROOT, outIx >= 0 ? argv[outIx + 1] : "docs/evidence/recurrence");

  const tenIx = argv.indexOf("--tenant");
  const tenant = tenIx >= 0 ? argv[tenIx + 1] : undefined;
  const now = Date.now();
  const runConvex = makeRunConvex(`recurrence-evidence:${probe}:${now}`);
  const input =
    probe === "dst-boundary"
      ? {
          // NO DEFAULT ZONE. The old default was Africa/Nairobi — UTC+3, which never transitions —
          // so the unconfigured run refused for a reason that had nothing to do with the probe.
          zone: process.env.PIKAR_DST_ZONE ?? "Pacific/Auckland",
          runConvex,
          nowMs: now,
        }
      : { tenant, runConvex };

  const res = COLLECTORS[probe](input);
  if (!res.observed) {
    console.error(`[recurrence-evidence] ${probe} REFUSED — nothing written.`);
    console.error(`  ${res.reason}`);
    process.exit(1);
  }

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${probe}.md`);
  writeFileSync(
    file,
    renderArtifact({
      probe,
      observed: true,
      collectedAt: new Date(now).toISOString(),
      deployment,
      detail: res.detail,
    }),
    "utf8",
  );
  console.log(`[recurrence-evidence] ${probe} OBSERVED — wrote ${file}`);
}

// RUN ONLY WHEN INVOKED DIRECTLY. `check-routine-gate.mjs` imports `ARTIFACT_MARKER` from this
// module, and an unguarded top-level `main()` would make merely READING the marker start a probe —
// the same trap that cost a real 46-case eval run earlier today when this file's sibling was
// imported to syntax-check it. A module that does work on import is a module nobody can safely
// import.
if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main(process.argv.slice(2));
}
