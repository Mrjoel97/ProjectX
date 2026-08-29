#!/usr/bin/env node
/**
 * check-routine-gate — the fail-closed gate in front of ANY recurrence implementation (29-11,
 * ROUT-02).
 *
 * WHAT IT GUARDS. `schema.ts:442` says, verbatim, "There is deliberately NO `routines` table,
 * cron, trigger, recurrence, next-run timestamp, execution-history table, canvas or DSL." The
 * only thing that may lift that is
 * `.planning/phases/29-unified-knowledge-and-routines/29-RECURRENCE-DECISION.md` recording
 * `decision: enable-safe` — and this script is what decides whether that recording is allowed
 * to stand. Its single job is to make "defer" the only reachable answer until real evidence
 * exists, WITHOUT hard-coding that answer: fill the matrix with green rows carrying live refs
 * and `--eligibility` exits 0. That is deliberate. A gate that can only ever say no proves
 * nothing about the day it says yes.
 *
 * THE FAILURE MODE IT EXISTS TO CATCH is relabelling. A code path is not a trace; a unit test
 * is not a live run; `manual` is not `live`. So `oauth-expiry-reauth`, `dst-boundary` and
 * `provider-read` must each carry `evidenceType: live` before enable-safe is even offered, and
 * every `pass` row's `evidenceRef` must RESOLVE to a file that exists in this repo. A pass row
 * pointing at nothing is treated as a lie, not as a formatting slip.
 *
 * WHY THE YAML READER IS HAND-WRITTEN AND HOSTILE. No YAML dependency is installed in this
 * repo and this gate is not worth adding one for. More importantly, a permissive parser is the
 * wrong tool here: a general reader silently accepts a fifth key, a re-ordered row or a nested
 * surprise, and a gate that accepts what it did not expect is a gate that can be edited around.
 * The reader below accepts EXACTLY the closed shape below and rejects every other byte.
 *
 *   ---
 *   decision: defer | enable-safe
 *   decidedAt: YYYY-MM-DD
 *   decidedBy: <non-empty>
 *   matrix:
 *     - id: <one of ROW_IDS, each exactly once>
 *       status: pass | fail | missing
 *       evidenceType: automated | live | manual
 *       evidenceRef: <non-empty>
 *   ---
 *
 * Usage:
 *   check-routine-gate.mjs <artifact.md> --matrix              # closed schema + enums, red rows OK
 *   check-routine-gate.mjs <artifact.md> --eligibility         # exit 0 ONLY if enable-safe is earned
 *   check-routine-gate.mjs <artifact.md> --validate-decision   # the recorded decision is permitted
 *   check-routine-gate.mjs --self-check                        # prove the gate can go red
 *
 * Exit 0 = the requested check passed. Exit 1 = it failed (every reason printed). Exit 2 = bad
 * usage. An absent file, malformed YAML, an unknown row, a missing row, a duplicate row, an empty
 * ref and an unknown enum member are ALL exit 1. Nothing here ever assumes pass.
 *
 * Do not read this script's exit code through a pipe.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv, exit, stdout } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRootDefault = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * THE CLOSED ROW SET. Every governance question the research gate raised, one row each. A row
 * may not be dropped to make the matrix green and a row may not be invented to pad it: the
 * parser requires this exact set, once each.
 */
export const ROW_IDS = [
  "standing-approval",
  "material-change-reapproval",
  "oauth-expiry-reauth",
  "dst-boundary",
  "provider-read",
  "missed-run",
  "run-identity",
  "overlap",
  "retry",
  "cost",
  "pause-revoke",
  "audit-notify",
];

/**
 * The three rows that cannot be answered from source code. Each names a thing that either
 * happened in the real world or did not: a token that actually expired and was actually
 * reconnected, a schedule that actually executed across a DST transition, and a real read from
 * a really connected provider. `automated` and `manual` evidence on these rows is fine to
 * RECORD — it just cannot unlock enable-safe.
 */
export const REQUIRED_LIVE_ROWS = ["oauth-expiry-reauth", "dst-boundary", "provider-read"];

export const STATUSES = ["pass", "fail", "missing"];
export const EVIDENCE_TYPES = ["automated", "live", "manual"];
export const DECISIONS = ["defer", "enable-safe"];

const ROW_KEYS = ["id", "status", "evidenceType", "evidenceRef"];
const HEAD_KEYS = ["decision", "decidedAt", "decidedBy"];

/**
 * The strict reader. Returns `{ doc, errors }`; `doc` is null whenever anything at all was off,
 * so no caller can accidentally validate a half-parsed document.
 */
export function parseArtifact(text) {
  const errors = [];
  const fail = (msg) => {
    errors.push(msg);
    return { doc: null, errors };
  };

  if (typeof text !== "string" || text.length === 0) return fail("artifact is empty");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") return fail("line 1: expected the frontmatter opener `---`");
  const close = lines.indexOf("---", 1);
  if (close === -1) return fail("frontmatter is never closed by a `---` line");

  const head = {};
  const rows = [];
  let inMatrix = false;

  for (let i = 1; i < close; i++) {
    const line = lines[i];
    const at = `line ${i + 1}`;
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    if (!inMatrix) {
      if (line === "matrix:") {
        inMatrix = true;
        continue;
      }
      const m = /^([a-zA-Z]+): (.*)$/.exec(line);
      if (!m)
        return fail(
          `${at}: not a \`key: value\` line before \`matrix:\` — ${JSON.stringify(line)}`,
        );
      const [, key, value] = m;
      if (!HEAD_KEYS.includes(key))
        return fail(`${at}: \`${key}\` is not in the closed header schema`);
      if (key in head) return fail(`${at}: duplicate header key \`${key}\``);
      if (value.trim() === "") return fail(`${at}: header \`${key}\` is empty`);
      head[key] = value.trim();
      continue;
    }

    const item = /^ {2}- id: (.*)$/.exec(line);
    if (item) {
      rows.push({ id: item[1].trim(), _line: i + 1 });
      continue;
    }
    const field = /^ {4}([a-zA-Z]+): (.*)$/.exec(line);
    if (!field) return fail(`${at}: not a matrix row line — ${JSON.stringify(line)}`);
    const [, key, value] = field;
    const row = rows[rows.length - 1];
    if (!row) return fail(`${at}: \`${key}\` appears before any \`- id:\` row`);
    if (!ROW_KEYS.includes(key)) return fail(`${at}: \`${key}\` is not in the closed row schema`);
    if (key in row) return fail(`${at}: duplicate \`${key}\` in row \`${row.id}\``);
    row[key] = value.trim();
  }

  for (const key of HEAD_KEYS) {
    if (!(key in head)) errors.push(`frontmatter is missing \`${key}\``);
  }
  if (!inMatrix) errors.push("frontmatter has no `matrix:` block");
  for (const row of rows) {
    for (const key of ROW_KEYS) {
      if (!(key in row)) errors.push(`row \`${row.id}\` (line ${row._line}) is missing \`${key}\``);
    }
  }
  if (errors.length > 0) return { doc: null, errors };
  return { doc: { ...head, matrix: rows.map(({ _line, ...r }) => r) }, errors };
}

/** Closed schema + enumerations + resolvable `pass` refs. Red rows are FINE here. */
export function validateMatrix(text, { repoRoot = repoRootDefault } = {}) {
  const { doc, errors } = parseArtifact(text);
  if (!doc) return { ok: false, doc: null, errors };

  if (!DECISIONS.includes(doc.decision)) {
    errors.push(`decision \`${doc.decision}\` is not one of ${DECISIONS.join(" | ")}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.decidedAt)) {
    errors.push(`decidedAt \`${doc.decidedAt}\` is not a YYYY-MM-DD date`);
  }

  const seen = new Set();
  for (const row of doc.matrix) {
    if (!ROW_IDS.includes(row.id)) errors.push(`row \`${row.id}\` is not a known matrix row`);
    if (seen.has(row.id)) errors.push(`row \`${row.id}\` is declared more than once`);
    seen.add(row.id);
    if (!STATUSES.includes(row.status)) {
      errors.push(
        `row \`${row.id}\`: status \`${row.status}\` is not one of ${STATUSES.join(" | ")}`,
      );
    }
    if (!EVIDENCE_TYPES.includes(row.evidenceType)) {
      errors.push(
        `row \`${row.id}\`: evidenceType \`${row.evidenceType}\` is not one of ${EVIDENCE_TYPES.join(" | ")}`,
      );
    }
    if (row.evidenceRef === "") errors.push(`row \`${row.id}\`: evidenceRef is empty`);
    // A `pass` row must point at something that EXISTS. This is the whole "confirm each evidence
    // reference resolves to the cited run" check, mechanised: a green row citing a file that is
    // not in the repo is a fabricated citation, not a typo.
    if (row.status === "pass") {
      const path = row.evidenceRef.split("#")[0].split(" ")[0].replace(/:\d+$/, "");
      if (!existsSync(resolve(repoRoot, path))) {
        errors.push(
          `row \`${row.id}\`: status is \`pass\` but evidenceRef does not resolve — ${path}`,
        );
      }
    }
  }
  for (const id of ROW_IDS) {
    if (!seen.has(id)) errors.push(`required row \`${id}\` is missing from the matrix`);
  }

  return { ok: errors.length === 0, doc, errors };
}

/**
 * Is `enable-safe` earned? Every row `pass`, every ref non-empty, and the three required rows
 * carrying `live` evidence. Any schema failure fails this too — an unparseable matrix is never
 * an eligible one.
 */
export function eligibility(text, opts = {}) {
  const base = validateMatrix(text, opts);
  const errors = [...base.errors];
  if (base.doc) {
    for (const row of base.doc.matrix) {
      if (row.status !== "pass")
        errors.push(`row \`${row.id}\` is \`${row.status}\`, not \`pass\``);
      if (!row.evidenceRef) errors.push(`row \`${row.id}\` has no evidenceRef`);
      if (REQUIRED_LIVE_ROWS.includes(row.id) && row.evidenceType !== "live") {
        errors.push(
          `row \`${row.id}\` requires LIVE evidence and carries \`${row.evidenceType}\` — ` +
            "a code path, a unit test or a manual attestation is not a live trace",
        );
      }
    }
  }
  return { ok: errors.length === 0, doc: base.doc, errors };
}

/**
 * Absence checks the `defer` branch promises: no ADR was minted for a decision that was not
 * taken, and no scheduling dependency was installed. Cheap, and the exact things a later
 * "we sort of enabled it" drift would leave behind.
 */
export function deferAbsenceChecks({ repoRoot = repoRootDefault } = {}) {
  const errors = [];
  const adrDir = resolve(repoRoot, "docs/decisions");
  if (existsSync(adrDir)) {
    const stray = readdirSync(adrDir).filter((f) => /routine|recurrence|schedul/i.test(f));
    for (const f of stray) {
      errors.push(`decision is \`defer\` but docs/decisions/${f} exists — no ADR may be minted`);
    }
  }
  for (const manifest of [
    "package.json",
    "packages/core/package.json",
    "packages/backend/package.json",
  ]) {
    const p = resolve(repoRoot, manifest);
    if (existsSync(p) && /temporal/i.test(readFileSync(p, "utf8"))) {
      errors.push(`decision is \`defer\` but ${manifest} names a temporal dependency`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** The recorded decision is permitted by the evidence. `defer` always is; `enable-safe` must earn it. */
export function validateDecision(text, opts = {}) {
  const base = validateMatrix(text, opts);
  if (!base.doc) return { ok: false, doc: null, errors: base.errors };
  const errors = [...base.errors];

  if (base.doc.decision === "defer") {
    errors.push(...deferAbsenceChecks(opts).errors);
    return { ok: errors.length === 0, doc: base.doc, errors };
  }
  // enable-safe: the same green check `--eligibility` applies, no softer.
  const elig = eligibility(text, opts);
  for (const e of elig.errors) if (!errors.includes(e)) errors.push(e);
  if (!elig.ok) {
    errors.push(
      "decision is `enable-safe` but eligibility is NOT met — rewrite the artifact to `defer` " +
        "before any downstream recurrence work",
    );
  }
  return { ok: errors.length === 0, doc: base.doc, errors };
}

const MODES = {
  "--matrix": validateMatrix,
  "--eligibility": eligibility,
  "--validate-decision": validateDecision,
};

function main(args) {
  if (args.includes("--self-check")) return selfCheck();

  const mode = args.find((a) => a in MODES);
  const file = args.find((a) => !a.startsWith("--"));
  if (!mode || !file) {
    stdout.write(
      "usage: check-routine-gate.mjs <artifact.md> --matrix|--eligibility|--validate-decision\n",
    );
    return 2;
  }
  const path = resolve(file);
  if (!existsSync(path)) {
    stdout.write(`FAIL ${mode}: the decision artifact does not exist — ${file}\n`);
    return 1;
  }
  const result = MODES[mode](readFileSync(path, "utf8"));
  if (result.ok) {
    const decision = result.doc ? ` (decision: ${result.doc.decision})` : "";
    stdout.write(`OK ${mode}${decision}\n`);
    return 0;
  }
  stdout.write(`FAIL ${mode} — ${result.errors.length} problem(s):\n`);
  for (const e of result.errors) stdout.write(`  - ${e}\n`);
  return 1;
}

/**
 * Proves the gate can go RED, and that its green is not vacuous. Two directions, because only
 * having one is how a gate ends up unable to fail: a fully green fixture must be ELIGIBLE, and
 * every single-field corruption of it must NOT be.
 */
function selfCheck() {
  const green = greenFixture();
  const cases = [
    ["a fully green fixture is eligible", () => eligibility(green).ok === true],
    ["empty text", () => validateMatrix("").ok === false],
    ["no frontmatter", () => validateMatrix("# hi\n").ok === false],
    ["unclosed frontmatter", () => validateMatrix("---\ndecision: defer\n").ok === false],
    [
      "unknown row id",
      () => validateMatrix(green.replace("- id: overlap", "- id: overlaps")).ok === false,
    ],
    [
      "dropped row",
      () => validateMatrix(green.replace(/ {2}- id: retry\n(?: {4}.*\n)+/, "")).ok === false,
    ],
    [
      "duplicated row",
      () => validateMatrix(green.replace("  - id: retry", "  - id: overlap")).ok === false,
    ],
    [
      "unknown status",
      () => validateMatrix(green.replace("status: pass", "status: green")).ok === false,
    ],
    [
      "unknown evidenceType",
      () => validateMatrix(green.replace("evidenceType: live", "evidenceType: vibes")).ok === false,
    ],
    [
      "empty evidenceRef",
      () =>
        validateMatrix(green.replace("evidenceRef: package.json", "evidenceRef: ")).ok === false,
    ],
    [
      "dangling pass ref",
      () =>
        validateMatrix(green.replace("evidenceRef: package.json", "evidenceRef: nope/missing.md"))
          .ok === false,
    ],
    [
      "extra row key",
      () =>
        validateMatrix(green.replace("    status: pass", "    status: pass\n    note: x")).ok ===
        false,
    ],
    [
      "unknown decision",
      () => validateMatrix(green.replace("decision: enable-safe", "decision: maybe")).ok === false,
    ],
    [
      "a required row relabelled from live to manual is NOT eligible",
      () => eligibility(green.replace("evidenceType: live", "evidenceType: manual")).ok === false,
    ],
    [
      "one red row is NOT eligible",
      () =>
        eligibility(
          green.replace(
            "    status: pass\n    evidenceType: manual",
            "    status: fail\n    evidenceType: manual",
          ),
        ).ok === false,
    ],
    [
      "enable-safe over a red matrix is refused",
      () => validateDecision(green.replace("status: pass", "status: missing")).ok === false,
    ],
  ];
  let bad = 0;
  for (const [name, fn] of cases) {
    let ok = false;
    try {
      ok = fn();
    } catch {
      ok = false;
    }
    stdout.write(`${ok ? "  ok  " : "  RED "} ${name}\n`);
    if (!ok) bad++;
  }
  stdout.write(
    bad === 0 ? "self-check: all cases behaved\n" : `self-check: ${bad} case(s) did not\n`,
  );
  return bad === 0 ? 0 : 1;
}

/** A synthetic all-green matrix. It exists ONLY inside the self-check — never on disk. */
export function greenFixture() {
  const rows = ROW_IDS.map(
    (id) =>
      `  - id: ${id}\n    status: pass\n    evidenceType: ${REQUIRED_LIVE_ROWS.includes(id) ? "live" : "manual"}\n    evidenceRef: package.json`,
  ).join("\n");
  return `---\ndecision: enable-safe\ndecidedAt: 2026-01-01\ndecidedBy: fixture\nmatrix:\n${rows}\n---\n`;
}

if (import.meta.url === pathToFileURL(argv[1] ?? "").href) {
  exit(main(argv.slice(2)));
}
