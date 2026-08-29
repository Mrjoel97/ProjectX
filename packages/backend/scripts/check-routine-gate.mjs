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
 * `provider-read` must each carry `evidenceType: live` before enable-safe is even offered.
 *
 * WHAT A CITATION CHECK CAN AND CANNOT DO — READ THIS BEFORE TRUSTING A GREEN ROW.
 * Round 1 of this script claimed a `pass` row's `evidenceRef` was proven to resolve "to the
 * cited run". It was not. `existsSync(resolve(repoRoot, ref.split("#")[0]))` accepted an
 * anchor-only ref (which strips to "" and resolves to the repo root), a directory, `.`, and a
 * path escaping the repository — so twelve fabricated `pass`/`live` rows passed all three
 * modes. That claim is now DELETED rather than narrowed. What `checkEvidenceRef` below
 * actually enforces, and all it enforces, is:
 *
 *   - the ref names a path at all (not just an `#anchor`),
 *   - the path stays inside this repository,
 *   - it resolves to a REGULAR FILE, not a directory,
 *   - that file is not empty,
 *   - and no two `pass` rows cite the same `evidenceRef` string.
 *
 * That refuses every fabrication shape three verifiers demonstrated, and it forces an author
 * who wants twelve green rows to write twelve distinct real citations — a twelve-line diff a
 * human reads. It CANNOT tell whether the cited file substantiates the row's question. Nothing
 * a parser does can. That judgement is the human checkpoint's job, and §5/§7 of the decision
 * record say so.
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
 *   decidedBy: <owner|agent|fixture>[ <qualifying clause>]
 *   matrix:
 *     - id: <one of ROW_IDS, each exactly once>
 *       status: pass | fail | missing
 *       evidenceType: automated | live | manual
 *       evidenceRef: <non-empty>
 *   ---
 *
 * `decidedBy` is a CLOSED ACTOR SET, not free text. An agent that presents a checkpoint and
 * then selects its outcome under a standing owner ruling is `agent`, not `owner`; the owner's
 * pre-ruling belongs in the qualifying clause after it. A closed set cannot stop a lie, but it
 * stops the lie being invisible: `owner` on a decision no human attended is now a claim someone
 * typed deliberately, in a diff, rather than a formatting habit.
 *
 * Usage:
 *   check-routine-gate.mjs <artifact.md> --matrix              # closed schema + enums, red rows OK
 *   check-routine-gate.mjs <artifact.md> --eligibility         # exit 0 ONLY if enable-safe is earned
 *   check-routine-gate.mjs <artifact.md> --validate-decision   # the recorded decision is permitted
 *   check-routine-gate.mjs --self-check                        # prove the gate can go red
 *
 * Exit 0 = the requested check passed. Exit 1 = it failed (every reason printed). Exit 2 = bad
 * usage (no mode, two modes, no file, two files). An absent file, a directory given as the
 * artifact, malformed YAML, an unknown row, a missing row, a duplicate row, an empty ref, an
 * unresolvable `pass` ref and an unknown enum member are ALL exit 1. Nothing here ever assumes
 * pass. Every one of those exit codes is asserted in `convex/routineDecision.test.ts` by
 * SPAWNING this file, because an exit code no test reads is a contract nobody holds.
 *
 * Do not read this script's exit code through a pipe.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
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

/**
 * Who may be recorded as having selected the outcome. `fixture` exists so the self-check's
 * synthetic matrix cannot masquerade as a real decision.
 */
export const DECIDERS = ["owner", "agent", "fixture"];

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

/**
 * Does one `evidenceRef` name a real, non-empty file inside this repository? Returns
 * `{ ok: true }` or `{ ok: false, reason }` where `reason` completes the sentence
 * "row `x`: status is `pass` but its evidenceRef ...".
 *
 * A ref may carry a `#anchor`, a `:line` suffix or a trailing note; all three name the same
 * file, so they are stripped before resolution. What is NOT tolerated is a ref that strips to
 * nothing — `#anchor-only` used to resolve to the repo root and pass, which is how a fully
 * fabricated matrix got a clean bill of health.
 */
export function checkEvidenceRef(ref, repoRoot = repoRootDefault) {
  const path = ref.split("#")[0].split(" ")[0].replace(/:\d+$/, "").trim();
  if (path === "") {
    return {
      ok: false,
      path,
      reason: "names no file at all — an anchor or a note is not a citation",
    };
  }
  const abs = resolve(repoRoot, path);
  if (abs !== repoRoot && !abs.startsWith(repoRoot + sep)) {
    return { ok: false, path, reason: "escapes the repository root" };
  }
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    return { ok: false, path, reason: "does not resolve to a file in this repo" };
  }
  if (!stat.isFile()) return { ok: false, path, reason: "resolves to a directory, not a file" };
  if (stat.size === 0) return { ok: false, path, reason: "resolves to an EMPTY file" };
  return { ok: true, path };
}

/** Closed schema + enumerations + resolvable, distinct `pass` refs. Red rows are FINE here. */
export function validateMatrix(text, { repoRoot = repoRootDefault } = {}) {
  const { doc, errors } = parseArtifact(text);
  if (!doc) return { ok: false, doc: null, errors };

  if (!DECISIONS.includes(doc.decision)) {
    errors.push(`decision \`${doc.decision}\` is not one of ${DECISIONS.join(" | ")}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.decidedAt)) {
    errors.push(`decidedAt \`${doc.decidedAt}\` is not a YYYY-MM-DD date`);
  }
  // The actor is a closed set. An agent selecting under a standing owner ruling is `agent`.
  const decider = doc.decidedBy.split(/[\s(]/)[0];
  if (!DECIDERS.includes(decider)) {
    errors.push(
      `decidedBy \`${doc.decidedBy}\` does not begin with one of ${DECIDERS.join(" | ")} — ` +
        "name the ACTOR that selected the outcome first; a standing authorisation goes in the " +
        "clause after it",
    );
  }

  const seen = new Set();
  const passRefs = new Map();
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
    // A `pass` row must cite a real, non-empty file inside the repo — and its OWN file. See the
    // header: this catches fabrication SHAPES, not fabricated meaning.
    if (row.status === "pass" && row.evidenceRef !== "") {
      const check = checkEvidenceRef(row.evidenceRef, repoRoot);
      if (!check.ok) {
        errors.push(
          `row \`${row.id}\`: status is \`pass\` but its evidenceRef ${check.reason} — ${JSON.stringify(row.evidenceRef)}`,
        );
      }
      const prior = passRefs.get(row.evidenceRef);
      if (prior !== undefined) {
        errors.push(
          `row \`${row.id}\`: cites the SAME evidence as row \`${prior}\` — ${JSON.stringify(row.evidenceRef)}. ` +
            "One citation cannot answer two independent governance questions; cite the specific " +
            "section with a `#anchor`.",
        );
      } else {
        passRefs.set(row.evidenceRef, row.id);
      }
    }
  }
  for (const id of ROW_IDS) {
    if (!seen.has(id)) errors.push(`required row \`${id}\` is missing from the matrix`);
  }

  return { ok: errors.length === 0, doc, errors };
}

/**
 * Is `enable-safe` earned? Every row `pass` — which drags in every `--matrix` rule, including
 * the citation checks, because a `pass` row is exactly what those rules police — and the three
 * required rows carrying `live` evidence. Any schema failure fails this too: an unparseable
 * matrix is never an eligible one.
 */
export function eligibility(text, opts = {}) {
  const base = validateMatrix(text, opts);
  const errors = [...base.errors];
  if (base.doc) {
    for (const row of base.doc.matrix) {
      if (row.status !== "pass")
        errors.push(`row \`${row.id}\` is \`${row.status}\`, not \`pass\``);
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
 * The manifests a scheduling dependency could hide in. `apps/web/package.json` and
 * `pnpm-lock.yaml` are here because 29-12's plan text gates on "package manifests or the
 * lockfile", and round 1 scanned neither — a dependency added under `apps/web`, or pinned only
 * in the lockfile, left the gate green.
 */
export const DEPENDENCY_MANIFESTS = [
  "package.json",
  "packages/core/package.json",
  "packages/backend/package.json",
  "apps/web/package.json",
  "pnpm-lock.yaml",
];

/**
 * Absence checks the `defer` branch promises: no ADR was minted for a decision that was not
 * taken, and no scheduling dependency was installed. Cheap, and the exact things a later
 * "we sort of enabled it" drift would leave behind.
 *
 * ponytail: the ADR rule matches FILENAMES against `routine|recurrence|schedul`, so an
 * unrelated future ADR (`0NN-scheduled-worm-export.md`) would trip it. That direction is
 * deliberate — a governance gate should fail closed and make a human look — and the
 * alternative (scanning ADR bodies for the topic) is more code with more false negatives.
 * Upgrade path if it ever fires falsely: rename the ADR, or lift the defer.
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
  for (const manifest of DEPENDENCY_MANIFESTS) {
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

const USAGE =
  "usage: check-routine-gate.mjs <artifact.md> --matrix|--eligibility|--validate-decision\n" +
  "       check-routine-gate.mjs --self-check\n";

export function main(args) {
  if (args.includes("--self-check")) return selfCheck();

  // `Object.hasOwn`, not `in`: `constructor` is on the prototype chain and used to read as a mode.
  const modes = args.filter((a) => Object.hasOwn(MODES, a));
  const files = args.filter((a) => !a.startsWith("--"));
  if (modes.length !== 1 || files.length !== 1) {
    // Two modes used to run only the FIRST one and print OK for it. A mis-composed verify line
    // that reads green is exactly the failure this gate exists to prevent.
    stdout.write(USAGE);
    return 2;
  }
  const [mode] = modes;
  const path = resolve(files[0]);
  let stat;
  try {
    stat = statSync(path);
  } catch {
    stdout.write(`FAIL ${mode}: the decision artifact does not exist — ${files[0]}\n`);
    return 1;
  }
  if (!stat.isFile()) {
    stdout.write(`FAIL ${mode}: the decision artifact is not a file — ${files[0]}\n`);
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
 *
 * Every case is PREFIXED WITH THE FUNCTION IT DRIVES, because round 1's summary reported this
 * list as N eligibility results when most of them were schema results. Schema validity and
 * eligibility are different properties and this list no longer blurs them.
 */
function selfCheck() {
  const green = greenFixture();
  // Corrupting a row by RENAMING it also makes a required row missing, so the unknown-id and
  // duplicate-id rules never run and both mutations survive. Both cases below APPEND a row.
  const extraRow = (id) =>
    green.replace(
      "\n---\n",
      `\n  - id: ${id}\n    status: pass\n    evidenceType: manual\n    evidenceRef: package.json#extra\n---\n`,
    );
  const oneRefForAll = green.replace(
    /evidenceRef: package\.json#[a-z-]+/g,
    "evidenceRef: package.json",
  );

  const cases = [
    ["validateMatrix: empty text", () => validateMatrix("").ok === false],
    ["validateMatrix: no frontmatter", () => validateMatrix("# hi\n").ok === false],
    [
      "validateMatrix: unclosed frontmatter",
      () => validateMatrix("---\ndecision: defer\n").ok === false,
    ],
    [
      "validateMatrix: unknown row id, all twelve still present",
      () =>
        validateMatrix(extraRow("overlaps")).errors.some((e) =>
          e.includes("`overlaps` is not a known matrix row"),
        ),
    ],
    [
      "validateMatrix: dropped row",
      () => validateMatrix(green.replace(/ {2}- id: retry\n(?: {4}.*\n)+/, "")).ok === false,
    ],
    [
      "validateMatrix: duplicated row id, all twelve still present",
      () =>
        validateMatrix(extraRow("overlap")).errors.some((e) =>
          e.includes("`overlap` is declared more than once"),
        ),
    ],
    [
      "validateMatrix: unknown status",
      () => validateMatrix(green.replace("status: pass", "status: green")).ok === false,
    ],
    [
      "validateMatrix: unknown evidenceType",
      () => validateMatrix(green.replace("evidenceType: live", "evidenceType: vibes")).ok === false,
    ],
    [
      "validateMatrix: empty evidenceRef",
      () =>
        validateMatrix(green.replace("evidenceRef: package.json#overlap", "evidenceRef: ")).ok ===
        false,
    ],
    [
      "validateMatrix: a pass ref naming a file that does not exist",
      () =>
        validateMatrix(
          green.replace("evidenceRef: package.json#overlap", "evidenceRef: nope/missing.md"),
        ).ok === false,
    ],
    [
      "validateMatrix: an ANCHOR-ONLY pass ref is a fabrication, not a citation",
      () =>
        validateMatrix(green.replace("evidenceRef: package.json#overlap", "evidenceRef: #where"))
          .ok === false,
    ],
    [
      "validateMatrix: a DIRECTORY as a pass ref",
      () =>
        validateMatrix(green.replace("evidenceRef: package.json#overlap", "evidenceRef: docs"))
          .ok === false,
    ],
    [
      "validateMatrix: a pass ref escaping the repo root",
      () =>
        validateMatrix(
          green.replace("evidenceRef: package.json#overlap", "evidenceRef: ../../../etc/hosts"),
        ).ok === false,
    ],
    [
      "validateMatrix: twelve pass rows citing ONE file",
      () => validateMatrix(oneRefForAll).ok === false,
    ],
    [
      "validateMatrix: extra row key",
      () =>
        validateMatrix(green.replace("    status: pass", "    status: pass\n    note: x")).ok ===
        false,
    ],
    [
      "validateMatrix: unknown decision",
      () => validateMatrix(green.replace("decision: enable-safe", "decision: maybe")).ok === false,
    ],
    [
      "validateMatrix: decidedBy outside the closed actor set",
      () =>
        validateMatrix(green.replace("decidedBy: fixture", "decidedBy: nobody at all")).ok ===
        false,
    ],
    ["eligibility: a fully green fixture IS eligible", () => eligibility(green).ok === true],
    [
      "eligibility: a required row relabelled live -> manual is NOT eligible",
      () => eligibility(green.replace("evidenceType: live", "evidenceType: manual")).ok === false,
    ],
    [
      "eligibility: one red row is NOT eligible",
      () =>
        eligibility(
          green.replace(
            "    status: pass\n    evidenceType: manual",
            "    status: fail\n    evidenceType: manual",
          ),
        ).ok === false,
    ],
    [
      "validateDecision: enable-safe over a red matrix is refused",
      () => validateDecision(green.replace("status: pass", "status: missing")).ok === false,
    ],
    [
      "validateDecision: a FABRICATED enable-safe (12 pass/live rows, one shared ref) is refused",
      () =>
        validateDecision(oneRefForAll.replace(/evidenceType: manual/g, "evidenceType: live")).ok ===
        false,
    ],
    [
      "validateDecision: a genuinely green enable-safe is ACCEPTED",
      () => validateDecision(green).ok === true,
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
    bad === 0
      ? `self-check: all ${cases.length} cases behaved\n`
      : `self-check: ${bad} of ${cases.length} case(s) did not\n`,
  );
  return bad === 0 ? 0 : 1;
}

/**
 * A synthetic all-green matrix. It exists ONLY inside the self-check and the unit tests — never
 * on disk. Each row carries a DISTINCT `evidenceRef` because `pass` rows may not share one; the
 * shared target plus a per-row `#anchor` keeps the fixture obviously synthetic (no real file in
 * this repo answers twelve governance questions) while still resolving.
 */
export function greenFixture() {
  const rows = ROW_IDS.map(
    (id) =>
      `  - id: ${id}\n    status: pass\n    evidenceType: ${REQUIRED_LIVE_ROWS.includes(id) ? "live" : "manual"}\n    evidenceRef: package.json#${id}`,
  ).join("\n");
  return `---\ndecision: enable-safe\ndecidedAt: 2026-01-01\ndecidedBy: fixture\nmatrix:\n${rows}\n---\n`;
}

if (import.meta.url === pathToFileURL(argv[1] ?? "").href) {
  exit(main(argv.slice(2)));
}
