#!/usr/bin/env node

/**
 * check-provider-lane — the per-provider lane gate (28-26).
 *
 * WHY IT EXISTS. 28-CONTEXT: "Provider lanes complete independently with a machine-readable
 * `passed` or `parked` result. One parked provider cannot prevent an already-proven
 * provider/workflow subset from being released." That is aspirational until something can decide it
 * mechanically. This is that something.
 *
 * THE DISTINCTION IT REFUSES TO LOSE. On 2026-08-27 the owner admitted all four providers
 * `approved_production`, and THREE of the four rest on human testimony rather than evidence (Stripe
 * is an override against its own record; QuickBooks and PayPal are attestations of vendor approvals
 * nothing in this repository can check). An admission means "engineering and production exposure are
 * PERMITTED". It does NOT mean the provider demonstrated a live read and a live revoke — that is
 * wave 7. This script therefore never converts a decision into a pass:
 * `--seal-decision from-owner` resolves an admitted provider to `park`, deliberately.
 *
 * SOURCE-DERIVED, NEVER RETYPED. Every fact comes from a file:
 *   • the decision marker blocks in `docs/connectors/*-suitability.md`
 *   • the open-condition table in `docs/connectors/README.md`
 *   • `PROVIDER_READ_PATHS` in `packages/backend/convex/connectorFetch.ts`
 *   • `PROVIDERS` / `PROVIDER_OPEN_CONDITIONS` in `packages/revenue/src/contracts.ts`
 *   • the `providerGates` literals in `packages/backend/convex/schema.ts`
 * A hand-maintained fifth copy is a copy that goes stale and then gets believed.
 *
 * STRICTLY OFFLINE AND READ-ONLY by default. It reads files. `--apply` is the one mode that touches
 * a deployment, and it only shells out to `npx convex run` with a payload it just printed.
 *
 * THREE ROW STATUSES, because "not built yet" and "wrong" are different facts:
 *   green   — the check holds.
 *   pending — nothing is wrong; the thing has not been built. Not an error at `--stage engineering`.
 *   red     — an INCONSISTENCY. A parked provider with an adapter, a marker that will not parse, an
 *             expired approval, a lane module reaching a write verb, a doc/code disagreement.
 * Exit 0 = no red. At `--stage final` a `pending` is red, because final means "this lane claims to
 * be passed" and an unbuilt lane cannot claim that.
 *
 * Usage:
 *   node scripts/check-provider-lane.mjs --all                          # the gate (engineering)
 *   node scripts/check-provider-lane.mjs --provider hubspot --stage final
 *   node scripts/check-provider-lane.mjs --all --json
 *   node scripts/check-provider-lane.mjs --provider hubspot --seal-decision from-owner
 *   node scripts/check-provider-lane.mjs --provider hubspot --seal-decision pass \
 *        --evidence 28-22-SUMMARY.md#live-read --clear-condition revoke-cascades-to-access-tokens
 *   node scripts/check-provider-lane.mjs --verify-gate                  # runs the real gate tests
 *   node scripts/check-provider-lane.mjs --self-test                    # prove every row can go red
 *
 * Exit 0 = consistent. Exit 1 = an inconsistency (or a refused seal). Exit 2 = bad usage.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, exit, stdout } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CONNECTOR_DIR = "packages/backend/convex";
const README = "docs/connectors/README.md";
const CONTRACTS = "packages/revenue/src/contracts.ts";
const CONNECTOR_FETCH = `${CONNECTOR_DIR}/connectorFetch.ts`;
const SCHEMA = `${CONNECTOR_DIR}/schema.ts`;
const recordPath = (provider) => `docs/connectors/${provider}-suitability.md`;

/**
 * The decision vocabulary, closed. A typo reads `undecided`, never an approval — the register's own
 * rule, restated here because this is the code that acts on it.
 */
const DECISIONS = ["approved_beta", "approved_production", "blocked", "deferred", "undecided"];

/** Admissions that permit a lane to be BUILT. Everything else must leave no trace in the tree. */
const BUILD_ADMISSIONS = ["approved_beta", "approved_production"];

/**
 * Write verbs an adapter must never reach (playbook invariant 1). `connectorOAuth.ts` legitimately
 * POSTs a token exchange and a revoke; that is why this scans LANE modules only and never the
 * shared mechanics. A direct `fetch(` is banned outright: every provider read goes through
 * `connectorFetch.readPages`, which hardcodes GET and refuses a redirect.
 */
const WRITE_MARKERS = [
  ['"POST"', "an HTTP POST"],
  ['"PUT"', "an HTTP PUT"],
  ['"PATCH"', "an HTTP PATCH"],
  ['"DELETE"', "an HTTP DELETE"],
  ["fetch(", "a direct fetch outside connectorFetch"],
];

// ── The filesystem façade ─────────────────────────────────────────────────────────────────────
//
// Injected, so `--self-test` can feed a mutated tree and watch each row go red without touching a
// real file. A gate that has never been observed failing is not a gate.

const realFs = {
  read: (relPath) => {
    const abs = join(repoRoot, relPath);
    return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  },
  list: (relDir) => {
    const abs = join(repoRoot, relDir);
    return existsSync(abs) ? readdirSync(abs) : [];
  },
};

// ── Source-derived facts ──────────────────────────────────────────────────────────────────────

/** The four providers, read from `PROVIDERS` in the contracts module. Never retyped here. */
function providersFrom(fs) {
  const src = fs.read(CONTRACTS) ?? "";
  const line = /export const PROVIDERS = \[([^\]]*)\] as const;/.exec(src);
  if (line === null) return [];
  return [...line[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
}

/**
 * One record's marker block. Returns `{ ok, fields }` — an unparseable block is a RED row, never a
 * silent default, because the register must not be satisfiable by malforming the answer.
 */
function markerFrom(fs, provider) {
  const src = fs.read(recordPath(provider));
  if (src === null) return { ok: false, why: `no record at ${recordPath(provider)}` };
  const block = /<!-- phase28-provider-decision\n([\s\S]*?)\n-->/.exec(src);
  if (block === null) return { ok: false, why: "no phase28-provider-decision marker block" };
  const fields = {};
  for (const line of block[1].split("\n")) {
    const kv = /^([a-z_]+):\s*(.+?)\s*$/.exec(line);
    if (kv !== null) fields[kv[1]] = kv[2];
  }
  if (fields.provider !== provider) {
    return { ok: false, why: `marker names "${fields.provider}", not "${provider}"` };
  }
  if (!DECISIONS.includes(fields.decision)) {
    // A value outside the closed set reads `undecided`, which is BLOCKING — never an approval.
    return { ok: false, why: `decision "${fields.decision}" is outside the closed vocabulary` };
  }
  return { ok: true, fields };
}

/** `PROVIDER_READ_PATHS[provider]`, read out of `connectorFetch.ts`. */
function readPathsFrom(fs, provider) {
  const src = fs.read(CONNECTOR_FETCH) ?? "";
  const at = src.indexOf("export const PROVIDER_READ_PATHS");
  if (at < 0) return null;
  const table = src.slice(at, src.indexOf("\n};", at));
  const entry = new RegExp(`^\\s*${provider}: \\[([^\\]]*)\\]`, "m").exec(table);
  if (entry === null) return null;
  return [...entry[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** The providers the register's open-condition table still lists, and the plan that owes each. */
function openConditionsFromRegister(fs, providers) {
  const src = fs.read(README) ?? "";
  const section = src.split("### Open conditions that survived every approval")[1] ?? "";
  const table = section.split("\n##")[0] ?? "";
  const found = {};
  for (const row of table.split("\n")) {
    const cells = row.split("|").map((c) => c.trim());
    if (cells.length < 4 || cells[1] === "" || cells[1].startsWith("-")) continue;
    const provider = providers.find((p) => cells[1].toLowerCase().startsWith(p));
    if (provider === undefined) continue;
    const plans = [...cells[3].matchAll(/28-(\d\d)/g)].map((m) => `28-${m[1]}`);
    found[provider] = { condition: cells[2], plans };
  }
  return found;
}

/** `PROVIDER_OPEN_CONDITIONS` in the contracts module, as `{ provider: [{id, resolvedBy}] }`. */
function openConditionsFromCode(fs) {
  const src = fs.read(CONTRACTS) ?? "";
  const at = src.indexOf("export const PROVIDER_OPEN_CONDITIONS");
  if (at < 0) return {};
  const table = src.slice(at, src.indexOf("\n};", at));
  const found = {};
  for (const m of table.matchAll(/^\s*([a-z]+): \[([\s\S]*?)\],\s*$/gm)) {
    found[m[1]] = [...m[2].matchAll(/id: "([^"]+)", resolvedBy: "([^"]+)"/g)].map((c) => ({
      id: c[1],
      resolvedBy: c[2],
    }));
  }
  return found;
}

/**
 * The provider's own lane modules, by NAME, so this does not have to guess what 28-05..08 will call
 * them. Anything under `convex/` whose basename starts with the slug or with `connector<Slug>`.
 * Excludes tests: a test file naming a parked provider is evidence discipline, not a shipped lane.
 */
function laneModulesFor(fs, provider) {
  const slug = provider.toLowerCase();
  return fs
    .list(CONNECTOR_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .filter((name) => {
      const base = name.slice(0, -3).toLowerCase();
      return base.startsWith(slug) || base.startsWith(`connector${slug}`);
    })
    .map((name) => `${CONNECTOR_DIR}/${name}`);
}

// ── The rows ──────────────────────────────────────────────────────────────────────────────────

const green = (note) => ({ status: "green", note });
const pending = (note) => ({ status: "pending", note });
const red = (note) => ({ status: "red", note });

/**
 * Every check, as a pure function of the injected filesystem. Order matters only for reading: each
 * row stands alone so `--self-test` can fail exactly one at a time.
 */
const ROWS = [
  {
    id: "decision",
    what: "The record carries one parseable marker whose decision is in the closed vocabulary.",
    run: (fs, provider) => {
      const marker = markerFrom(fs, provider);
      if (!marker.ok) return red(marker.why);
      const { decision, decided_on } = marker.fields;
      if (decision !== "undecided" && !/^\d{4}-\d{2}-\d{2}$/.test(decided_on ?? "")) {
        // "Writing a decision without a date is not a decision" — the register's own rule.
        return red(`decision "${decision}" carries decided_on "${decided_on}"`);
      }
      return green(`${decision} (decided ${decided_on})`);
    },
  },
  {
    id: "evidence-life",
    what: "The approval has not outlived its evidence. 90 days is the maximum evidence life.",
    run: (fs, provider, { now }) => {
      const marker = markerFrom(fs, provider);
      if (!marker.ok) return red(marker.why);
      const reviewBy = Date.parse(marker.fields.review_by ?? "");
      if (Number.isNaN(reviewBy))
        return red(`review_by "${marker.fields.review_by}" is not a date`);
      // An EXPIRED record is parked, not passed. A gate that let an expired approval read green
      // would make the 90-day cap decorative.
      return reviewBy <= now
        ? red(`review_by ${marker.fields.review_by} has passed — re-verify before any lane runs`)
        : green(`review_by ${marker.fields.review_by}`);
    },
  },
  {
    id: "absence",
    what: "A parked provider leaves no adapter, route or tenant-visible entry point behind.",
    run: (fs, provider) => {
      const marker = markerFrom(fs, provider);
      if (!marker.ok) return red(marker.why);
      if (BUILD_ADMISSIONS.includes(marker.fields.decision)) {
        return green(`${marker.fields.decision} — the lane may be built`);
      }
      const modules = laneModulesFor(fs, provider);
      return modules.length > 0
        ? red(`${marker.fields.decision} but ${modules.join(", ")} exists`)
        : green(`${marker.fields.decision} — parked, and nothing was built`);
    },
  },
  {
    id: "adapter",
    what: "An admitted provider has a lane module.",
    run: (fs, provider) => {
      const marker = markerFrom(fs, provider);
      if (!marker.ok) return red(marker.why);
      if (!BUILD_ADMISSIONS.includes(marker.fields.decision)) {
        return green("parked — no adapter is expected");
      }
      const modules = laneModulesFor(fs, provider);
      return modules.length > 0
        ? green(modules.join(", "))
        : pending("admitted, not built — this is the normal state before its wave-6 plan");
    },
  },
  {
    id: "read-only",
    what: "No lane module reaches a write verb or a direct fetch (playbook invariant 1).",
    run: (fs, provider) => {
      const modules = laneModulesFor(fs, provider);
      if (modules.length === 0) return pending("no lane module to scan");
      const hits = [];
      for (const path of modules) {
        const src = fs.read(path) ?? "";
        for (const [marker, describe] of WRITE_MARKERS) {
          if (src.includes(marker)) hits.push(`${path} contains ${describe}`);
        }
      }
      return hits.length > 0
        ? red(hits.join("; "))
        : green(`${modules.length} module(s) read-only`);
    },
  },
  {
    id: "allow-list",
    what: "A built lane has a non-empty read allow-list; an empty one fails closed.",
    run: (fs, provider) => {
      const paths = readPathsFrom(fs, provider);
      if (paths === null) return red(`no PROVIDER_READ_PATHS entry for ${provider}`);
      const built = laneModulesFor(fs, provider).length > 0;
      if (paths.length === 0) {
        // Stripe today: `[]` BY DECISION, not omission. A lane module over an empty allow-list
        // could only ever throw, so it is an inconsistency rather than a pending.
        return built
          ? red("a lane module exists but the read allow-list is empty — every call fails closed")
          : pending("allow-list empty by decision — nothing can be read until it is filled");
      }
      return green(`${paths.length} allow-listed path(s)`);
    },
  },
  {
    id: "open-conditions",
    what: "The register's surviving conditions and the machine copy agree, and are unresolved.",
    run: (_fs, provider, { register, code, cleared }) => {
      const inDocs = register[provider];
      const inCode = code[provider] ?? [];
      if (inDocs === undefined && inCode.length === 0) return green("no condition on record");
      if (inDocs === undefined) {
        return red(`code carries ${inCode.length} condition(s) the register no longer lists`);
      }
      if (inCode.length === 0) {
        return red(
          "the register still lists a condition that PROVIDER_OPEN_CONDITIONS has dropped",
        );
      }
      const codePlans = [...new Set(inCode.map((c) => c.resolvedBy))].sort();
      const docPlans = [...new Set(inDocs.plans)].sort();
      // The register names the plan that must confront it; the code must name the same one.
      if (!docPlans.some((p) => codePlans.includes(p))) {
        return red(`register says ${docPlans.join("/")}, code says ${codePlans.join("/")}`);
      }
      // The SAME rule the runtime resolver applies: a condition is answered by being named on
      // the gate row with evidence, not by being deleted from the register. If the CLI and
      // `resolveProviderEligibility` disagreed about this, one of them would be lying at the
      // moment a wave-7 plan tried to seal.
      const unnamed = inCode.filter((c) => !cleared.includes(c.id));
      return unnamed.length === 0
        ? green(`every condition named: ${inCode.map((c) => c.id).join(", ")}`)
        : pending(`${unnamed.map((c) => c.id).join(", ")} — owed by ${codePlans.join(", ")}`);
    },
  },
  {
    id: "parity",
    what: "The register, @pikar/revenue and the providerGates schema name the same four providers.",
    run: (fs, provider, { providers }) => {
      const schema = fs.read(SCHEMA) ?? "";
      const at = schema.indexOf("providerGates: defineTable(");
      if (at < 0) return red("no providerGates table in the schema");
      const block = schema.slice(at, schema.indexOf("by_provider_environment", at));
      const inSchema = [...block.matchAll(/v\.literal\("([a-z]+)"\)/g)].map((m) => m[1]);
      if (!inSchema.includes(provider)) return red(`${provider} has no providerGates literal`);
      if (fs.read(recordPath(provider)) === null) return red("no suitability record on file");
      // Whole-set comparison, so a provider added to one place and not the others is caught even
      // when the row being run is a different provider.
      const missing = providers.filter((p) => !inSchema.includes(p));
      return missing.length > 0
        ? red(`the schema is missing ${missing.join(", ")}`)
        : green(`${providers.length} providers agree across docs, contracts and schema`);
    },
  },
];

// ── Running ───────────────────────────────────────────────────────────────────────────────────

function runProvider(fs, provider, options) {
  const providers = providersFrom(fs);
  const context = {
    now: options.now,
    providers,
    register: openConditionsFromRegister(fs, providers),
    code: openConditionsFromCode(fs),
    cleared: options.clear ?? [],
  };
  return ROWS.map((row) => {
    const result = row.run(fs, provider, context);
    // At `final` a pending IS red: "final" means this lane claims to be passed, and an unbuilt or
    // unresolved thing cannot claim that. At `engineering` a pending is just work not yet done.
    const status = options.stage === "final" && result.status === "pending" ? "red" : result.status;
    return { provider, id: row.id, what: row.what, status, note: result.note };
  });
}

function runAll(fs, options) {
  const providers = options.provider ? [options.provider] : providersFrom(fs);
  return providers.flatMap((p) => runProvider(fs, p, options));
}

function report(rows, options) {
  const failed = rows.filter((r) => r.status === "red");
  if (options.json) {
    stdout.write(
      `${JSON.stringify({ stage: options.stage, passed: failed.length === 0, rows }, null, 1)}\n`,
    );
    return failed.length === 0 ? 0 : 1;
  }
  stdout.write(`Provider lanes — stage ${options.stage}\n\n`);
  let current = "";
  for (const row of rows) {
    if (row.provider !== current) {
      current = row.provider;
      stdout.write(`${current}\n`);
    }
    const badge = { green: "OK   ", pending: "PEND ", red: "RED  " }[row.status];
    stdout.write(`  ${badge} ${row.id.padEnd(17)} ${row.note}\n`);
  }
  stdout.write("\n");
  if (failed.length === 0) {
    const pend = rows.filter((r) => r.status === "pending").length;
    stdout.write(
      `RESULT: consistent — no lane contradicts its record. ${pend} row(s) pending (not built or ` +
        "not yet resolved).\nA consistent lane is NOT a passed lane: no live gate has run.\n",
    );
    return 0;
  }
  stdout.write(
    `RESULT: inconsistent — ${failed.length} of ${rows.length} rows red.\n` +
      `${failed.map((r) => `  ${r.provider}/${r.id}: ${r.note}`).join("\n")}\n`,
  );
  return 1;
}

// ── Sealing ───────────────────────────────────────────────────────────────────────────────────

/**
 * Build the `providerGates:sealGate` payload. PURE, so `--self-test` can assert every flag
 * combination without a deployment.
 *
 * `from-owner` consumes the record's marker and resolves DETERMINISTICALLY. It can only ever
 * produce `parked`: an owner's admission is permission to start, and turning it into a `passed`
 * lane here would be exactly the laundering of testimony into observation this register was built
 * to prevent. A pass requires `--seal-decision pass` with live evidence and every open condition
 * named explicitly.
 */
function buildSeal(fs, options) {
  const { provider, environment, seal } = options;
  const marker = markerFrom(fs, provider);
  if (!marker.ok) return { ok: false, why: marker.why };
  const admission = marker.fields.decision;
  if (admission === "undecided") {
    return { ok: false, why: `${provider} is undecided — there is no judgment to seal` };
  }
  const reviewBy = Date.parse(marker.fields.review_by);

  const base = {
    provider,
    environment,
    admission,
    evidenceRef: options.evidence ?? `${recordPath(provider)}#decision`,
    reviewBy,
    ...(options.expectedRevision === undefined
      ? {}
      : { expectedRevision: options.expectedRevision }),
  };

  if (seal === "park" || seal === "from-owner") {
    return {
      ok: true,
      resolved: "park",
      why:
        seal === "from-owner"
          ? `the record says ${admission}; an admission is permission to start, never a passed lane`
          : "explicit park",
      payload: { ...base, lane: "parked", clearedConditions: [] },
    };
  }

  // seal === "pass"
  if (options.evidence === undefined) {
    return { ok: false, why: "--seal-decision pass requires --evidence <ref> from a live gate" };
  }
  const owed = (openConditionsFromCode(fs)[provider] ?? []).map((c) => c.id);
  const missing = owed.filter((id) => !options.clear.includes(id));
  if (missing.length > 0) {
    return {
      ok: false,
      why: `unresolved open condition(s): ${missing.join(", ")} — name each with --clear-condition`,
    };
  }
  const blocking = runProvider(fs, provider, { ...options, stage: "final" }).filter(
    (r) => r.status === "red",
  );
  if (blocking.length > 0) {
    return {
      ok: false,
      why: `stage final is red: ${blocking.map((r) => `${r.id} (${r.note})`).join("; ")}`,
    };
  }
  return {
    ok: true,
    resolved: "pass",
    why: `live evidence ${options.evidence}, every open condition named`,
    payload: { ...base, lane: "passed", clearedConditions: options.clear },
  };
}

/**
 * ponytail: `--apply` shells out to the convex CLI rather than opening an admin client, because the
 * CLI already holds the deployment credentials and this script must stay offline by default. If a
 * lane ever needs to seal without a shell, swap this one call for `ConvexHttpClient`.
 */
function applySeal(payload) {
  const r = spawnSync("npx", ["convex", "run", "providerGates:sealGate", JSON.stringify(payload)], {
    cwd: join(repoRoot, "packages/backend"),
    stdio: "inherit",
    shell: true,
  });
  return r.status ?? 1;
}

function seal(fs, options) {
  const built = buildSeal(fs, options);
  if (!built.ok) {
    stdout.write(`REFUSED: ${built.why}\n`);
    return 1;
  }
  stdout.write(`RESOLVED: ${built.resolved} — ${built.why}\n`);
  stdout.write(`${JSON.stringify(built.payload, null, 1)}\n`);
  if (!options.apply) {
    stdout.write(
      "\nNot applied. Re-run with --apply to send this to the deployment, or paste it into\n" +
        "  cd packages/backend && npx convex run providerGates:sealGate '<payload>'\n",
    );
    return 0;
  }
  return applySeal(built.payload);
}

// ── --verify-gate ─────────────────────────────────────────────────────────────────────────────

/**
 * Prove that a refreshed FAILURE actually disables the passed projection — by running the real
 * gate tests, not by grepping for the branch that is supposed to do it. A source tripwire over a
 * behaviour proves SPELLING, never validity; this repo has the scar.
 *
 * Exit code read directly from `spawnSync`, never through a pipe.
 */
function verifyGate() {
  stdout.write("Running the provider-gate behaviour tests (offline, $0)...\n");
  const r = spawnSync("npx", ["vitest", "run", "convex/providerGates.test.ts"], {
    cwd: join(repoRoot, "packages/backend"),
    stdio: "inherit",
    shell: true,
  });
  const code = r.status ?? 1;
  stdout.write(
    code === 0
      ? "\nVERIFIED: a failed live refresh and an expired review date each empty the passed projection.\n"
      : "\nUNVERIFIED: the gate tests are red. Do not seal anything.\n",
  );
  return code;
}

// ── --self-test ───────────────────────────────────────────────────────────────────────────────

/** A filesystem that reads the real tree except for the paths a mutation overrides. */
const mutatedFs = (overrides) => ({
  read: (p) => (p in overrides ? overrides[p] : realFs.read(p)),
  list: (d) => (`list:${d}` in overrides ? overrides[`list:${d}`] : realFs.list(d)),
});

const NOW = Date.parse("2026-08-27T00:00:00Z");
const baseOptions = { stage: "engineering", now: NOW, clear: [], environment: "production" };

/**
 * Every row must be able to go RED, and every mutation is a RENAME or a substitution rather than a
 * deletion — deletion-only mutation is blind to substring matching, and a row that only fails when
 * its file is missing is a row that would survive the file being WRONG.
 */
function selfTest() {
  const record = realFs.read(recordPath("hubspot")) ?? "";
  const contracts = realFs.read(CONTRACTS) ?? "";
  const fetchSrc = realFs.read(CONNECTOR_FETCH) ?? "";
  const schemaSrc = realFs.read(SCHEMA) ?? "";
  const readme = realFs.read(README) ?? "";

  const cases = [
    {
      row: "decision",
      why: "a decision outside the closed vocabulary reads as undecided, never as an approval",
      fs: mutatedFs({
        [recordPath("hubspot")]: record.replace(
          "decision: approved_production",
          "decision: approved_prodcution",
        ),
      }),
    },
    {
      row: "decision",
      why: "a decision without a date is not a decision",
      fs: mutatedFs({
        [recordPath("hubspot")]: record.replace("decided_on: 2026-08-27", "decided_on: none"),
      }),
    },
    {
      row: "evidence-life",
      why: "an approval that outlived its 90-day evidence must not read green",
      fs: mutatedFs({
        [recordPath("hubspot")]: record.replace("review_by: 2026-11-27", "review_by: 2026-08-01"),
      }),
    },
    {
      row: "absence",
      why: "a parked provider that nonetheless has a lane module is an inconsistency",
      fs: mutatedFs({
        [recordPath("hubspot")]: record.replace(
          "decision: approved_production",
          "decision: blocked",
        ),
        [`list:${CONNECTOR_DIR}`]: [...realFs.list(CONNECTOR_DIR), "hubspotRead.ts"],
        [`${CONNECTOR_DIR}/hubspotRead.ts`]: "export const read = 1;",
      }),
    },
    {
      row: "read-only",
      why: "a lane module reaching a write verb breaks the read-only invariant",
      fs: mutatedFs({
        [`list:${CONNECTOR_DIR}`]: [...realFs.list(CONNECTOR_DIR), "hubspotRead.ts"],
        [`${CONNECTOR_DIR}/hubspotRead.ts`]: 'const m = "POST";\nexport default m;',
      }),
    },
    {
      row: "allow-list",
      why: "a lane module over an EMPTY allow-list could only ever fail closed",
      fs: mutatedFs({
        [`list:${CONNECTOR_DIR}`]: [...realFs.list(CONNECTOR_DIR), "stripeRead.ts"],
        [`${CONNECTOR_DIR}/stripeRead.ts`]: "export const read = 1;",
      }),
      provider: "stripe",
    },
    {
      row: "allow-list",
      why: "a provider with no PROVIDER_READ_PATHS entry at all is not silently allowed",
      fs: mutatedFs({
        [CONNECTOR_FETCH]: fetchSrc.replace("\n  hubspot: [", "\n  hubspotRENAMED: ["),
      }),
    },
    {
      row: "open-conditions",
      why: "dropping a condition from the code while the register still lists it is a drift",
      fs: mutatedFs({
        [CONTRACTS]: contracts.replace(
          '  hubspot: [{ id: "revoke-cascades-to-access-tokens", resolvedBy: "28-22" }],',
          "  hubspot: [],",
        ),
      }),
    },
    {
      row: "open-conditions",
      why: "dropping the register row while the code still carries the condition is a drift",
      fs: mutatedFs({
        [README]: readme.replace(/^\| HubSpot \| Does .*$/m, "| HubSpot | resolved | nobody |"),
      }),
    },
    {
      row: "open-conditions",
      why: "a code condition owed by a different plan than the register names is a drift",
      fs: mutatedFs({
        [CONTRACTS]: contracts.replace('resolvedBy: "28-22"', 'resolvedBy: "28-99"'),
      }),
    },
    {
      row: "parity",
      why: "a provider renamed out of the schema literals breaks the closed set",
      fs: mutatedFs({
        [SCHEMA]: schemaSrc.replace(
          'providerGates: defineTable({\n    provider: v.union(\n      v.literal("hubspot")',
          'providerGates: defineTable({\n    provider: v.union(\n      v.literal("hubspotRENAMED")',
        ),
      }),
    },
  ];

  let failures = 0;
  stdout.write("Self-test — every row must be observed going RED.\n\n");
  for (const c of cases) {
    const provider = c.provider ?? "hubspot";
    const rows = runProvider(c.fs, provider, { ...baseOptions, provider });
    const row = rows.find((r) => r.id === c.row);
    const ok = row !== undefined && row.status === "red";
    if (!ok) failures += 1;
    stdout.write(`  ${ok ? "RED " : "MISS"} ${c.row.padEnd(17)} ${c.why}\n`);
    if (!ok) stdout.write(`       -> stayed ${row?.status ?? "absent"}: ${row?.note ?? ""}\n`);
  }

  // The unmutated tree must be consistent, or every RED above could be noise.
  const clean = runAll(realFs, { ...baseOptions });
  const cleanRed = clean.filter((r) => r.status === "red");
  stdout.write(
    `\n  ${cleanRed.length === 0 ? "OK  " : "FAIL"} baseline${" ".repeat(11)} the real tree is consistent\n`,
  );
  if (cleanRed.length > 0) {
    failures += 1;
    for (const r of cleanRed) stdout.write(`       -> ${r.provider}/${r.id}: ${r.note}\n`);
  }

  // Every seal combination, including the one that matters: an ADMISSION never becomes a PASS.
  stdout.write("\nSeal resolution — every flag combination.\n\n");
  const sealCases = [
    {
      why: "from-owner on an approved record resolves to PARK, never to pass",
      options: { seal: "from-owner", provider: "hubspot" },
      expect: { ok: true, resolved: "park", lane: "parked" },
    },
    {
      why: "from-owner on a blocked record also parks",
      options: { seal: "from-owner", provider: "hubspot" },
      fs: mutatedFs({
        [recordPath("hubspot")]: record.replace(
          "decision: approved_production",
          "decision: blocked",
        ),
      }),
      expect: { ok: true, resolved: "park", lane: "parked" },
    },
    {
      why: "from-owner on an undecided record refuses — there is no judgment to seal",
      options: { seal: "from-owner", provider: "hubspot" },
      fs: mutatedFs({
        [recordPath("hubspot")]: record.replace(
          "decision: approved_production",
          "decision: undecided",
        ),
      }),
      expect: { ok: false },
    },
    {
      why: "an explicit park is always available, so a broken lane can always be shut off",
      options: { seal: "park", provider: "stripe" },
      expect: { ok: true, resolved: "park", lane: "parked" },
    },
    {
      why: "pass without live evidence is refused",
      options: { seal: "pass", provider: "hubspot" },
      expect: { ok: false },
    },
    {
      why: "pass with evidence but an unnamed open condition is refused",
      options: { seal: "pass", provider: "hubspot", evidence: "28-22-SUMMARY.md#live" },
      expect: { ok: false },
    },
    {
      why: "pass with evidence and every condition named is still refused while the lane is unbuilt",
      options: {
        seal: "pass",
        provider: "hubspot",
        evidence: "28-22-SUMMARY.md#live",
        clear: ["revoke-cascades-to-access-tokens"],
      },
      expect: { ok: false },
    },
    {
      why: "pass for Stripe is refused even fully evidenced — its allow-list is empty by decision",
      options: {
        seal: "pass",
        provider: "stripe",
        evidence: "28-24-SUMMARY.md#live",
        clear: ["platform-initiated-revocation"],
      },
      expect: { ok: false },
    },
    {
      // ANTI-VACUITY. A gate that refuses everything is not a safe gate, it is a broken one: every
      // refusal above would then prove nothing. This is the one case that must be ABLE to say yes —
      // an admitted, unexpired provider with a read-only lane module, live evidence and every open
      // condition named. Nothing in the real tree satisfies it today, which is the honest state.
      why: "a built, read-only, fully-evidenced lane with every condition named DOES resolve to pass",
      options: {
        seal: "pass",
        provider: "hubspot",
        evidence: "28-22-SUMMARY.md#live",
        clear: ["revoke-cascades-to-access-tokens"],
      },
      fs: mutatedFs({
        [`list:${CONNECTOR_DIR}`]: [...realFs.list(CONNECTOR_DIR), "hubspotRead.ts"],
        [`${CONNECTOR_DIR}/hubspotRead.ts`]: "export const readDeals = 1;",
      }),
      expect: { ok: true, resolved: "pass", lane: "passed" },
    },
  ];
  for (const c of sealCases) {
    const built = buildSeal(c.fs ?? realFs, { ...baseOptions, ...c.options });
    const ok =
      built.ok === c.expect.ok &&
      (c.expect.resolved === undefined || built.resolved === c.expect.resolved) &&
      (c.expect.lane === undefined || built.payload?.lane === c.expect.lane);
    if (!ok) failures += 1;
    stdout.write(`  ${ok ? "OK  " : "FAIL"} ${c.why}\n`);
    if (!ok) stdout.write(`       -> ${JSON.stringify(built)}\n`);
  }

  stdout.write(
    failures === 0
      ? "\nSELF-TEST PASSED — every row was observed refusing, and no seal turned an admission into a pass.\n"
      : `\nSELF-TEST FAILED — ${failures} check(s) did not behave.\n`,
  );
  return failures === 0 ? 0 : 1;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────

function parse(flags) {
  const options = {
    stage: "engineering",
    now: Date.now(),
    clear: [],
    environment: "production",
    json: false,
    apply: false,
  };
  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i];
    const value = flags[i + 1];
    switch (flag) {
      case "--provider":
        options.provider = value;
        i += 1;
        break;
      case "--environment":
        options.environment = value;
        i += 1;
        break;
      case "--stage":
        options.stage = value;
        i += 1;
        break;
      case "--seal-decision":
        options.seal = value;
        i += 1;
        break;
      case "--evidence":
        options.evidence = value;
        i += 1;
        break;
      case "--clear-condition":
        options.clear.push(value);
        i += 1;
        break;
      case "--expect-revision":
        options.expectedRevision = Number(value);
        i += 1;
        break;
      case "--all":
        options.all = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--apply":
        options.apply = true;
        break;
      case "--verify-gate":
        options.verifyGate = true;
        break;
      case "--self-test":
        options.selfTest = true;
        break;
      default:
        return { error: `unknown flag: ${flag}` };
    }
  }
  return options;
}

function main(flags) {
  const options = parse(flags);
  if (options.error) {
    stdout.write(`${options.error}\n`);
    return 2;
  }
  if (options.selfTest) return selfTest();
  if (options.verifyGate) return verifyGate();

  const providers = providersFrom(realFs);
  if (options.provider !== undefined && !providers.includes(options.provider)) {
    stdout.write(`unknown provider: ${options.provider} (known: ${providers.join(", ")})\n`);
    return 2;
  }
  if (!["engineering", "final"].includes(options.stage)) {
    stdout.write(`unknown stage: ${options.stage} (engineering|final)\n`);
    return 2;
  }
  if (!["sandbox", "production"].includes(options.environment)) {
    stdout.write(`unknown environment: ${options.environment} (sandbox|production)\n`);
    return 2;
  }

  if (options.seal !== undefined) {
    if (!["pass", "park", "from-owner"].includes(options.seal)) {
      stdout.write(`unknown seal: ${options.seal} (pass|park|from-owner)\n`);
      return 2;
    }
    if (options.provider === undefined) {
      stdout.write("--seal-decision needs --provider: a seal is per-provider, never per-phase\n");
      return 2;
    }
    return seal(realFs, options);
  }

  if (options.provider === undefined && !options.all) {
    stdout.write("give --provider <slug> or --all\n");
    return 2;
  }
  return report(runAll(realFs, options), options);
}

if (import.meta.url === pathToFileURL(argv[1]).href) {
  exit(main(argv.slice(2)));
}

export { buildSeal, ROWS, runAll, runProvider, selfTest };
