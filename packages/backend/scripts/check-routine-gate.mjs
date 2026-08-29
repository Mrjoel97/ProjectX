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
 *   - it is not the decision artifact under validation (a record is not its own evidence),
 *   - and no two `pass` rows resolve to the same file.
 *
 * THE LAST TWO ARE KEYED ON FILESYSTEM IDENTITY, NOT ON THE AUTHOR'S SPELLING. Both have been
 * bypassed twice now by re-spelling one path. Round 2 keyed the duplicate rule on the raw
 * string, so `package.json#row-1 ... package.json#row-12` read as twelve citations. Round 3
 * keyed it on `resolve()`d path STRINGS, which on win32 and darwin — case-insensitive
 * filesystems, this repo's own development and gating platform included — made `package.json`,
 * `Package.json` and `PACKAGE.JSON` three keys over one file; three independent verifiers
 * produced a fabricated `enable-safe` citing ONE file twelve times that exited 0 in all three
 * modes, and the self-citation rule fell to the same edit. `fileIdentity()` now resolves each
 * ref through `realpathSync.native` — which returns the on-disk name, so casing, `.` / `..`
 * segments, Windows 8.3 short names and symlinks all collapse — and case-folds on top for
 * paths that are not on disk to be read.
 *
 * NO CLAIM IS MADE HERE ABOUT WHAT FABRICATION COSTS. Three consecutive rounds published a
 * sentence of that shape ("N distinct real citations — a reviewable N-line diff"), each one
 * asserting that the round's new rule closed the previous round's alias space, and each one
 * falsified by the next verifier finding an alias the new rule did not canonicalise. The
 * mechanism is stated above and the residuals below; nothing is claimed about cost.
 *
 * KNOWN RESIDUALS. The gate never READS a cited file, so it cannot tell whether a citation
 * substantiates its row's question — `turbo.json` is a real, distinct, non-empty, meaningless
 * citation and the gate says yes. Two genuinely distinct files with identical content are two
 * citations. A hard link is two names for one inode and `realpath` does not collapse it. That
 * judgement is the human checkpoint's job, and §5/§7 of the decision record say so.
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
 * EXACTLY ONE MODE, AND `--self-check` TAKES NOTHING ELSE. An unrecognised flag and any
 * combination of the above are exit 2, never a quietly weaker check. Round 2 ran `selfCheck()`
 * on `--self-check` ANYWHERE in argv, so `<artifact> --eligibility --self-check` exited 0 without
 * ever opening the artifact, and `<artifact> --matrix --eligibilty` silently discarded the typo
 * and passed on `--matrix` alone.
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

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { argv, exit, platform, stdout } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRootDefault = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * `true` where the filesystem folds case — which includes the platform this repo is developed
 * and gated on. A path rule that compares spellings treats `Package.json` and `package.json` as
 * two files here, and that is exactly how the round-3 citation rules were defeated.
 */
export const CASE_INSENSITIVE_FS = platform === "win32" || platform === "darwin";

/**
 * The identity of a path as the FILESYSTEM sees it, not as its author spelled it. Two refs name
 * the same citation if and only if their identities are equal.
 *
 * `realpathSync.native` returns the on-disk name, so one call collapses casing, `.`/`..`
 * segments, Windows 8.3 short names and symlinks. It throws for a path that is not on disk — a
 * ref naming a missing file, which the caller refuses on its own — so the fallback is the
 * resolved string, with case folding applied on top because there is no on-disk name to read.
 */
export function fileIdentity(abs) {
  let out = abs;
  try {
    out = realpathSync.native(abs);
  } catch {
    /* not on disk: fall back to the resolved string, case-folded below */
  }
  return CASE_INSENSITIVE_FS ? out.toLowerCase() : out;
}

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
 * Who may be recorded as having selected the outcome. `fixture` is a third member so the
 * self-check's synthetic matrix does not have to claim `owner` or `agent`. Nothing enforces that
 * `fixture` means synthetic in either direction — an on-disk artifact recorded as decided by
 * `fixture` is fully valid — so this is a naming convention, not a control.
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
      id: null,
      reason: "names no file at all — an anchor or a note is not a citation",
    };
  }
  const abs = resolve(repoRoot, path);
  // CONTAINMENT IS CHECKED ON THE CANONICAL IDENTITY, not on the resolved string, so neither a
  // re-spelled case nor a symlink inside the repo pointing outside it can smuggle a path past
  // the boundary. `id` is what every downstream identity rule keys on.
  const id = fileIdentity(abs);
  const rootId = fileIdentity(repoRoot);
  if (id !== rootId && !id.startsWith(rootId + sep)) {
    return { ok: false, path, id, reason: "escapes the repository root" };
  }
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    return { ok: false, path, id, reason: "does not resolve to a file in this repo" };
  }
  if (!stat.isFile())
    return { ok: false, path, id, reason: "resolves to a directory, not a file" };
  if (stat.size === 0) return { ok: false, path, id, reason: "resolves to an EMPTY file" };
  return { ok: true, path, id };
}

/**
 * Closed schema + enumerations + resolvable, distinct `pass` refs. Red rows are FINE here.
 *
 * @param {string} text
 * @param {{ repoRoot?: string, artifactPath?: string | null }} [opts]
 */
export function validateMatrix(text, { repoRoot = repoRootDefault, artifactPath = null } = {}) {
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
      // An artifact may not be its own evidence. This is the fabrication shape an author reaches
      // for FIRST once refs have to resolve (the most available real file is the one already
      // open), and unlike "does this file answer the question" it is mechanically decidable.
      //
      // KEYED ON `fileIdentity`, BOTH SIDES. Round 3 compared `resolve()`d strings, so on a
      // case-insensitive filesystem an artifact at `d.md` citing `D.md` was not citing itself.
      const id = check.ok ? check.id : null;
      if (id !== null && artifactPath !== null && id === fileIdentity(resolve(artifactPath))) {
        errors.push(
          `row \`${row.id}\`: cites the decision artifact ITSELF - ${JSON.stringify(row.evidenceRef)}. ` +
            "A record cannot be the evidence for its own verdict.",
        );
      }
      // KEYED ON `fileIdentity`, not on the author's spelling. Round 2 keyed on the raw string
      // INCLUDING its `#anchor` (`package.json#row-1 ... #row-12` read as twelve citations);
      // round 3 keyed on the `resolve()`d string, which on a case-insensitive filesystem let
      // `package.json` / `Package.json` / `PACKAGE.JSON` be three keys over one file. Both
      // shapes produced a fabricated enable-safe that exited 0 in all three modes. See the
      // header for what this does and does not close - no cost claim is made.
      const key = id ?? row.evidenceRef;
      const prior = passRefs.get(key);
      if (prior !== undefined) {
        errors.push(
          `row \`${row.id}\`: cites the SAME FILE as row \`${prior}\` - ${JSON.stringify(row.evidenceRef)}. ` +
            "One document cannot answer two independent governance questions, and an `#anchor` " +
            "does not make it two documents.",
        );
      } else {
        passRefs.set(key, row.id);
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
 * Every manifest a scheduling dependency could hide in, DERIVED FROM THE FILESYSTEM.
 *
 * Round 1 hardcoded three manifests and no lockfile. Round 3 hardcoded five — the root, the
 * lockfile, `apps/web` and two of ten workspace packages — so `rrule` added to
 * `packages/vault/package.json` was invisible until `pnpm install` wrote it into the lock, and
 * the test that asserted "EVERY scanned manifest" iterated the same constant it pinned and so
 * could never discover a manifest missing from it. Enumerating `apps/*` and `packages/*` means
 * a workspace package added later is scanned without anyone remembering to add it.
 *
 * The root manifest and the lockfile are unconditional: `deferAbsenceChecks` skips a manifest
 * that does not exist, so listing them costs nothing on a scratch root that has neither.
 */
export function manifestsUnder(repoRoot = repoRootDefault) {
  const found = ["package.json", "pnpm-lock.yaml"];
  for (const group of ["apps", "packages"]) {
    const dir = resolve(repoRoot, group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      const rel = `${group}/${name}/package.json`;
      if (existsSync(resolve(repoRoot, rel))) found.push(rel);
    }
  }
  return found;
}

/** The derived list for THIS repository, so a test can pin it and see it widen or narrow. */
export const DEPENDENCY_MANIFESTS = manifestsUnder();

/**
 * The scheduling libraries a recurrence implementation would reach for, as a CLOSED, NAMED set.
 * Round 2 matched `/temporal/i` alone while a test described the rule as "no scheduling
 * DEPENDENCY" - `rrule`, `cron-parser`, `node-cron`, `croner`, `bullmq` and `@js-joda` all
 * passed. Each name below is a package name, not a word, so `agenda` (a common English word that
 * is also a scheduler) is deliberately EXCLUDED rather than accepted: a rule that false-positives
 * on prose is a rule someone deletes.
 */
export const SCHEDULING_DEPENDENCY_RE =
  /temporal|\brrule\b|cron-parser|node-cron|node-schedule|croner|bullmq|js-joda|toad-scheduler/i;

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
  for (const manifest of manifestsUnder(repoRoot)) {
    const p = resolve(repoRoot, manifest);
    if (!existsSync(p)) continue;
    const hit = SCHEDULING_DEPENDENCY_RE.exec(readFileSync(p, "utf8"));
    if (hit) {
      errors.push(
        `decision is \`defer\` but ${manifest} names a scheduling dependency (${hit[0]})`,
      );
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
  // EVERY MIS-COMPOSED COMMAND LINE IS EXIT 2. A mis-composed verify line that reads green is
  // exactly the failure this gate exists to prevent, and round 2 had three ways to produce one:
  // `--self-check` ANYWHERE in argv short-circuited the requested mode and exited 0 without ever
  // opening the artifact; an unrecognised flag (`--eligibilty`) was counted by neither list and
  // silently vanished, leaving the weaker mode to print OK; and two modes ran only the first.
  // So: flags are a closed set, exactly one mode is required, and `--self-check` is EXCLUSIVE.
  const flags = args.filter((a) => a.startsWith("--"));
  const files = args.filter((a) => !a.startsWith("--"));
  const refuse = (why) => {
    stdout.write(`FAIL usage: ${why}
${USAGE}`);
    return 2;
  };

  // `Object.hasOwn`, not `in`: `in` walks the prototype chain, so `MODES` would answer to
  // `constructor` and friends. No prototype key starts with `--`, so with the flag rule above
  // this is belt-and-braces rather than load-bearing — round 2 claimed a test covered it and
  // none did. What IS covered, from a spawned process, is that an unknown flag is refused.
  const unknown = flags.filter((a) => a !== "--self-check" && !Object.hasOwn(MODES, a));
  if (unknown.length > 0) return refuse(`unrecognised flag(s) ${unknown.join(", ")}`);

  if (flags.includes("--self-check")) {
    if (flags.length !== 1 || files.length !== 0) {
      return refuse("--self-check runs the gate against its own fixtures and takes nothing else");
    }
    return selfCheck();
  }

  if (flags.length !== 1 || files.length !== 1) {
    return refuse("exactly one mode and exactly one artifact are required");
  }
  const [mode] = flags;
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
  // The artifact path travels with the text so a row cannot cite the artifact under validation.
  const result = MODES[mode](readFileSync(path, "utf8"), { artifactPath: path });
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
  const overlapRef = `evidenceRef: ${fixtureRef("overlap")}#overlap`;
  // Corrupting a row by RENAMING it also makes a required row missing, so the unknown-id and
  // duplicate-id rules never run and both mutations survive. Both cases below APPEND a row, and
  // cite the one real manifest the fixture deliberately leaves unused.
  const extraRow = (id) =>
    green.replace(
      "\n---\n",
      `\n  - id: ${id}\n    status: pass\n    evidenceType: manual\n    evidenceRef: packages/cost/package.json#extra\n---\n`,
    );
  const oneRefForAll = green.replace(/evidenceRef: .*/g, "evidenceRef: package.json");
  // The ANCHOR LOOPHOLE: one file, twelve different `#anchor`s. Round 2 read those as twelve
  // distinct citations and let a fabricated enable-safe through all three modes.
  const oneFileTwelveAnchors = green.replace(
    /evidenceRef: [^\n#]*#/g,
    "evidenceRef: package.json#",
  );
  // THE CASE LOOPHOLE: one file, twelve spellings. Round 3 keyed the duplicate and the
  // self-citation rules on `resolve()`d path STRINGS, so on win32/darwin these read as twelve
  // distinct citations of one file, and a fabricated enable-safe exited 0 in all three modes.
  // On a case-SENSITIVE filesystem eleven of these do not exist and are refused as unresolvable
  // instead - a different reason, the same verdict, which is why these cases assert `false`
  // rather than a message. The identity case below is the one that distinguishes the two.
  const CASINGS = [
    "package.json",
    "Package.json",
    "PACKAGE.json",
    "pACKAGE.json",
    "PaCKAGE.json",
    "pAcKAGE.json",
    "packAGE.json",
    "PACKage.json",
    "packagE.json",
    "PACKAGE.JSON",
    "Package.JSON",
    "pACKAGE.JSON",
  ];
  let casing = 0;
  const oneFileTwelveCasings = green.replace(
    /evidenceRef: .*/g,
    () => `evidenceRef: ${CASINGS[casing++]}`,
  );
  const selfPath = "packages/backend/scripts/check-routine-gate.mjs";
  const selfCitedByCase = green.replace(
    /evidenceRef: .*/g,
    () => "evidenceRef: packages/backend/scripts/Check-Routine-Gate.mjs",
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
      () => validateMatrix(green.replace(overlapRef, "evidenceRef: ")).ok === false,
    ],
    [
      "validateMatrix: a pass ref naming a file that does not exist",
      () => validateMatrix(green.replace(overlapRef, "evidenceRef: nope/missing.md")).ok === false,
    ],
    [
      "validateMatrix: an ANCHOR-ONLY pass ref is a fabrication, not a citation",
      () => validateMatrix(green.replace(overlapRef, "evidenceRef: #where")).ok === false,
    ],
    [
      "validateMatrix: a DIRECTORY as a pass ref",
      () => validateMatrix(green.replace(overlapRef, "evidenceRef: docs")).ok === false,
    ],
    [
      "validateMatrix: a pass ref escaping the repo root",
      () =>
        validateMatrix(green.replace(overlapRef, "evidenceRef: ../../../etc/hosts")).ok === false,
    ],
    [
      "validateMatrix: twelve pass rows citing ONE file",
      () => validateMatrix(oneRefForAll).ok === false,
    ],
    [
      "validateMatrix: twelve pass rows citing ONE file under twelve #anchors",
      () =>
        validateMatrix(oneFileTwelveAnchors).errors.some((e) => e.includes("cites the SAME FILE")),
    ],
    [
      "validateMatrix: twelve pass rows citing ONE file under twelve CASINGS",
      () => validateMatrix(oneFileTwelveCasings).ok === false,
    ],
    [
      "validateDecision: a fabricated enable-safe under twelve CASINGS of one file is refused",
      () => validateDecision(oneFileTwelveCasings).ok === false,
    ],
    [
      "validateDecision: an enable-safe citing the artifact itself under a DIFFERENT CASE is refused",
      () =>
        validateDecision(selfCitedByCase, {
          artifactPath: resolve(repoRootDefault, selfPath),
        }).ok === false,
    ],
    [
      "fileIdentity: two spellings of one real file share an identity iff the FS folds case",
      () => {
        const a = fileIdentity(resolve(repoRootDefault, "package.json"));
        const b = fileIdentity(resolve(repoRootDefault, "Package.json"));
        return CASE_INSENSITIVE_FS ? a === b : a !== b;
      },
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
      "validateDecision: an enable-safe whose rows cite the ARTIFACT ITSELF is refused",
      () => {
        const self = "packages/backend/scripts/check-routine-gate.mjs";
        const selfCiting = green.replace(/evidenceRef: .*/g, `evidenceRef: ${self}`);
        return validateDecision(selfCiting, {
          artifactPath: resolve(repoRootDefault, self),
        }).errors.some((e) => e.includes("cites the decision artifact ITSELF"));
      },
    ],
    [
      // NOT "genuinely green": twelve distinct real files that say nothing about routines. This
      // case proves the gate is not hard-coded to refuse, and nothing more. See the header.
      "validateDecision: a SCHEMA-VALID enable-safe is ACCEPTED (the gate can say yes)",
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
 * One real file per row, in ROW_IDS order, no two of them the same file. They are all repo-root
 * manifests and docs, so no reader can mistake the fixture for a real evidence set. Round 2's
 * fixture was `package.json#<row-id>` twelve times, which pinned the anchor loophole in place:
 * the fixture the suite called "genuinely green" was the same shape a verifier used to fabricate
 * one, so hardening the rule would have turned the suite red.
 *
 * `packages/cost/package.json` is deliberately NOT used, so a test that appends a thirteenth row
 * has a real file left to cite without colliding.
 */
export const FIXTURE_REFS = [
  "package.json",
  "pnpm-workspace.yaml",
  "README.md",
  "CLAUDE.md",
  "biome.json",
  "tsconfig.base.json",
  "turbo.json",
  "docs/README.md",
  "packages/core/package.json",
  "packages/backend/package.json",
  "apps/web/package.json",
  "packages/contracts/package.json",
];

/**
 * The fixture's citation for one row, so a test can address it without a literal path.
 *
 * @param {string} id
 * @returns {string}
 */
export const fixtureRef = (id) => {
  const n = ROW_IDS.indexOf(id);
  if (n === -1) throw new Error(`fixtureRef: \`${id}\` is not a matrix row`);
  return FIXTURE_REFS[n];
};

/**
 * A synthetic all-green matrix. It exists ONLY inside the self-check and the unit tests - never
 * on disk. Every row cites a DIFFERENT real file, because `pass` rows may not share one. It is
 * schema-valid and says NOTHING about routines - see the header's residuals.
 */
export function greenFixture() {
  const rows = ROW_IDS.map(
    (id, n) =>
      `  - id: ${id}\n    status: pass\n    evidenceType: ${REQUIRED_LIVE_ROWS.includes(id) ? "live" : "manual"}\n    evidenceRef: ${FIXTURE_REFS[n]}#${id}`,
  ).join("\n");
  return `---\ndecision: enable-safe\ndecidedAt: 2026-01-01\ndecidedBy: fixture\nmatrix:\n${rows}\n---\n`;
}

if (import.meta.url === pathToFileURL(argv[1] ?? "").href) {
  exit(main(argv.slice(2)));
}
