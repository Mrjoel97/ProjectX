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
 * `dst-boundary` is COMPLETE and runs today: whether a zone has crossed a transition between two
 * instants is pure clock arithmetic, and `Intl` answers it without a provider or a network.
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

/** The probe implementations. Each returns `{ observed: false, reason }` or `{ observed: true, detail }`. */
const COLLECTORS = {
  /**
   * COMPLETE. A run that spans a transition in the tenant's zone is the trace; anything less is a
   * unit test wearing the word "live", which is the exact relabelling the gate exists to catch.
   */
  "dst-boundary": ({ zone, fromMs, toMs }) => {
    const { crossed, from, to } = crossedDstBoundary(zone, fromMs, toMs);
    if (!crossed) {
      return {
        observed: false,
        reason:
          `no DST transition in ${zone} between the two instants (offset ${from} throughout). ` +
          "A live trace requires a scheduled run that actually spans one — it cannot be simulated, " +
          "and the owner's own zone (UTC+3) never transitions, so this needs a tenant in a " +
          "DST-observing zone. Next transitions: 2026-10-25 (EU), 2026-11-01 (US).",
      };
    }
    return { observed: true, detail: { zone, offsetBefore: from, offsetAfter: to } };
  },

  /**
   * PRECONDITION COMPLETE, COLLECTION UNEXERCISED. Refuses without a real grant, which is the state
   * of every deployment this has been run against.
   */
  "oauth-expiry-reauth": ({ grants }) => {
    const real = grants.filter((g) => g.real);
    if (real.length === 0) {
      return {
        observed: false,
        reason:
          "no real provider grant on this deployment — every stored token is a fixture, so there " +
          "is no token that can expire and no refresh to observe. Connect a provider on the " +
          "deployment that will carry the evidence, then re-run.",
      };
    }
    return {
      observed: false,
      reason:
        "a real grant exists but the refresh observation is NOT IMPLEMENTED — see the header. " +
        "Implement it against the provider's refresh endpoint and record refs only " +
        "(provider, whether the refresh succeeded, the new expiry as an offset, never a token).",
    };
  },

  /** PRECONDITION COMPLETE, COLLECTION UNEXERCISED — same shape and same reason as above. */
  "provider-read": ({ grants }) => {
    const real = grants.filter((g) => g.real);
    if (real.length === 0) {
      return {
        observed: false,
        reason:
          "no real provider grant on this deployment — a read cannot be observed against a fixture " +
          "token. Connect a provider on the deployment that will carry the evidence, then re-run.",
      };
    }
    return {
      observed: false,
      reason:
        "a real grant exists but the bounded read is NOT IMPLEMENTED — see the header. Implement " +
        "it as a capped list call and record refs and COUNTS only (provider, itemCount), never " +
        "a subject, an address or a body.",
    };
  },
};

/** Read the deployment's grants through the convex CLI. Returns `[]` when it cannot look. */
function readGrants() {
  try {
    const out = execFileSync("npx", ["convex", "data", "gmailTokens", "--limit", "50"], {
      cwd: join(REPO_ROOT, "packages", "backend"),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .filter((l) => l.includes("refreshToken") === false && l.includes('"') === true)
      .map((l) => ({ real: !l.includes("not-a-real-token") }));
  } catch {
    return [];
  }
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
  const noGrants = { grants: [] };
  for (const probe of ["oauth-expiry-reauth", "provider-read"]) {
    const res = COLLECTORS[probe](noGrants);
    assert.equal(res.observed, false, `${probe} must refuse without a real grant`);
    assert.match(res.reason, /no real provider grant/, `${probe}'s refusal must name the cause`);
  }
  const dstRefusal = COLLECTORS["dst-boundary"]({
    zone: "Africa/Nairobi",
    fromMs: oct,
    toMs: nov,
  });
  assert.equal(dstRefusal.observed, false);
  assert.match(dstRefusal.reason, /2026-10-25/, "the refusal must name when this becomes possible");

  // 5. A grant that EXISTS still does not manufacture a result: the collection half is unwritten and
  //    says so, rather than returning a cheerful observation of nothing.
  const withGrant = { grants: [{ real: true }] };
  for (const probe of ["oauth-expiry-reauth", "provider-read"]) {
    const res = COLLECTORS[probe](withGrant);
    assert.equal(res.observed, false, `${probe} must not claim an observation it did not make`);
    assert.match(res.reason, /NOT IMPLEMENTED/);
  }

  console.log(
    "[recurrence-evidence] self-check PASSED " +
      "(artifact writer refuses a false observation; dst-boundary proven in BOTH directions incl. " +
      "the local UTC+3 zone that can never produce it; all three probes refuse on the current " +
      "deployment state with actionable reasons; a real grant does not manufacture a result)",
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
      `usage: collect-recurrence-evidence.mjs <${PROBES.join("|")}> --deployment <name>`,
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

  const now = Date.now();
  const input =
    probe === "dst-boundary"
      ? {
          zone: process.env.PIKAR_DST_ZONE ?? "Africa/Nairobi",
          fromMs: now - 86_400_000,
          toMs: now,
        }
      : { grants: readGrants() };

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
