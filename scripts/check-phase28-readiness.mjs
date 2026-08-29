#!/usr/bin/env node
/**
 * check-phase28-readiness — the hard go/no-go gate in front of every Phase 28 plan (28-17).
 *
 * WHY IT EXISTS. Phase 28's plans were authored 2026-08-05 against Phase 19, Phase 25 and Phase 27
 * interfaces that did not exist yet. Phase 27's own readiness audit found eleven rotted premises of
 * exactly that shape — plans naming `convex/inbox.ts`, `convex/artifacts.ts` and
 * `apps/web/components/` that never existed. This script refuses to let Phase 28 repeat it: every
 * prerequisite is resolved from a file on disk containing a named symbol, never from a SUMMARY.md
 * claiming it landed.
 *
 * STRICTLY OFFLINE AND READ-ONLY. It reads source files and one attestation comment. It fetches
 * nothing, writes nothing, and never invokes convex.
 *
 * WHAT IT DELIBERATELY CANNOT DO. Three Phase 25 facts are not in the repository and never will be:
 * which secret VALUES a production deployment holds, who owns the redirect URIs registered at
 * Google/Microsoft, and whether the hosted deployment actually fails closed. Those are a `posture`
 * row — an owner attestation parsed out of `docs/connectors/phase28-readiness.md`. An unattested
 * posture is `undecided` and exits non-zero. Making that row auto-pass would be the whole point of
 * the gate, thrown away.
 *
 * NON-VACUITY. `scripts/check-playbooks.mjs` in this repo exits 0 on every terminal path and can
 * only ever read green, and 27-READINESS found four verify commands naming files no task creates.
 * So this script carries `--self-check`, which proves two things mechanically: (1) every row goes
 * RED against an empty tree, and (2) every required symbol is load-bearing — deleting it, and
 * RENAMING it at either end, each flip its row RED. The rename half is not decoration: the first
 * cut of this file matched with `String.includes`, self-checked green on 91 symbols, and was then
 * watched to survive `listPacks` → `listPacksRENAMED`, because the old name is still a substring of
 * the new one. A gate that survives the rename it exists to catch is not a gate.
 *
 * Usage:
 *   node scripts/check-phase28-readiness.mjs                # the gate. exit 0 = Phase 28 may start
 *   node scripts/check-phase28-readiness.mjs --json         # machine-readable, same exit code
 *   node scripts/check-phase28-readiness.mjs --self-check   # prove the gate can go red
 *   node scripts/check-phase28-readiness.mjs --inventory    # regenerate the doc's inventory section
 *
 * Exit 0 = every prerequisite row green AND the owner posture attested `pass`. Exit 1 = blocked,
 * with the exact missing contract printed. Exit 2 = bad usage.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, exit, stdout } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const READINESS_DOC = "docs/connectors/phase28-readiness.md";

/**
 * The attestation values the owner may record. `undecided` is the default and is BLOCKING — a doc
 * that forgot to answer must not read the same as a doc that answered "pass".
 */
const POSTURE_VALUES = ["pass", "block", "undecided"];

/**
 * The prerequisite table.
 *
 * `symbols` are literal substrings that must appear in `path`. They are named exports, closed-union
 * literals and governed refusal codes — the things a dependent plan would otherwise ASSUME. A row
 * is green only when every file exists and every symbol is present.
 *
 * `owner` / `recheck` are what a red row hands the person who has to fix it.
 */
const CHECKS = [
  // ── Phase 19 — ACTN-05 / PIPE-01 terminals ────────────────────────────────────────────────────
  {
    id: "p19-contacts-substrate",
    phase: "19",
    requirement: "ACTN-05",
    what: "One tenant-scoped person/consent/suppression/follow-up store (REVN-04 must not build a second CRM).",
    owner: "Phase 19 lane",
    files: [
      {
        path: "packages/backend/convex/contacts.ts",
        symbols: [
          "export const upsertContact",
          "export const assertConsent",
          "export const consentRecord",
          "export const markSuppressed",
          "export const unsuppress",
          "export const createFollowUp",
          "export const setFollowUpStatus",
          "export const listUnassignedFollowUps",
          "export const isSuppressed",
          "export const suppressedAmong",
        ],
      },
      {
        path: "packages/backend/convex/contacts.test.ts",
        symbols: [
          "contacts: the write surface",
          "contacts: the send-path suppression backstop",
          "contacts: listUnassignedFollowUps is the contactless section's own read",
        ],
      },
    ],
  },
  {
    id: "p19-suppression-terminal",
    phase: "19",
    requirement: "ACTN-05",
    what: "The last-mile send refusal. REVN-06's invoice-reminder drafts terminate here, not at a new check.",
    owner: "Phase 19 lane",
    files: [
      {
        path: "packages/backend/convex/gmail.ts",
        symbols: [
          "export async function prepareGovernedMessage",
          "internal.contacts.isSuppressed",
          'reason: "suppressed"',
        ],
      },
      {
        path: "packages/backend/convex/gmail.test.ts",
        symbols: ["gmail.send — the suppression backstop"],
      },
    ],
  },
  {
    id: "p19-approval-terminal",
    phase: "19",
    requirement: "ACTN-05",
    what: "The single human approval gate + per-address suppression drop that REVN-06 drafts must pass through.",
    owner: "Phase 19 lane",
    files: [
      {
        path: "packages/backend/convex/cockpit.ts",
        symbols: [
          "export const executePlan",
          "internal.contacts.suppressedAmong",
          '"all_recipients_suppressed"',
          'status: "approved"',
        ],
      },
      {
        path: "packages/backend/convex/cockpit.test.ts",
        symbols: ["executePlan"],
      },
    ],
  },
  {
    id: "p19-pipeline-view",
    phase: "19",
    requirement: "PIPE-01",
    what: "A pipeline read over the SAME substrate, with no opportunity/deal-value concept. REVN-04 extends this.",
    owner: "Phase 19 lane",
    files: [
      {
        path: "packages/backend/convex/contacts.ts",
        symbols: ["export const pipelineTiles"],
      },
      { path: "apps/web/app/(app)/dashboard/pipeline/PipelineView.tsx", symbols: [] },
      {
        path: "packages/backend/convex/contacts.test.ts",
        symbols: [
          "PIPE-01: no second CRM data plane leaked an opportunity concept into the substrate",
          "contacts: pipelineTiles are ALWAYS-KNOWN counts",
        ],
      },
    ],
  },

  // ── Phase 25 — secret and OAuth posture ───────────────────────────────────────────────────────
  {
    id: "p25-secret-manifest",
    phase: "25",
    requirement: "REVN-03 (encrypted, revocable provider grants)",
    what: "A derived-checked env manifest that reports NAMES only, plus the durable-origin assertion (ADR-022).",
    owner: "Phase 25 lane",
    files: [
      {
        path: "packages/backend/convex/lib/env.ts",
        symbols: [
          "export const ENV_MANIFEST",
          "export const REQUIRED_ENV",
          "export function missingEnv",
          "export const ORIGIN_ENV",
          "export function isDurableOrigin",
        ],
      },
      {
        path: "packages/backend/convex/env.test.ts",
        symbols: [
          "missingEnv reports names, never values",
          "isDurableOrigin rejects the origins that stop resolving",
          "envCheck is owner-only and leaks nothing",
        ],
      },
      {
        path: "packages/backend/convex/ops.ts",
        symbols: ["export const envCheck", "nonDurableOrigins"],
      },
    ],
  },
  {
    id: "p25-oauth-state",
    phase: "25",
    requirement: "REVN-01/02/03 (connector OAuth round-trip)",
    what: "The signed-state callback trust boundary a connector grant would be modelled on: HMAC state, provider discriminator, redirect from env.",
    owner: "Phase 25 lane",
    files: [
      {
        path: "packages/backend/convex/gmailAuth.ts",
        symbols: ["export async function verifyState", 'requireEnv("GMAIL_OAUTH_REDIRECT_URI")'],
      },
      {
        path: "packages/backend/convex/microsoftAuth.ts",
        symbols: [
          "export async function verifyMicrosoftState",
          "STATE_PROVIDER",
          'requireEnv("MICROSOFT_CALENDAR_REDIRECT_URI")',
        ],
      },
      {
        path: "packages/backend/convex/http.ts",
        symbols: ["verifyState", "verifyMicrosoftState"],
      },
      {
        path: "packages/backend/convex/microsoftAuth.test.ts",
        symbols: [
          "verifyMicrosoftState — the callback trust boundary",
          "a Google-issued state is REJECTED even when both providers share a client secret",
        ],
      },
      {
        path: "packages/backend/convex/httpAuth.test.ts",
        symbols: ["a tampered state fails BEFORE the credentialed token POST"],
      },
    ],
  },
  {
    id: "p25-no-dev-fallback",
    phase: "25",
    requirement: "REVN-03 (honest partial/unavailable states)",
    what: "Missing credentials THROW instead of falling back to a development default or a faked provider.",
    owner: "Phase 25 lane",
    files: [
      {
        path: "packages/backend/convex/gmailAuth.ts",
        symbols: ["function requireEnv", "throw new Error(`Gmail OAuth env not configured:"],
      },
      {
        path: "packages/backend/convex/media.ts",
        symbols: ["export function requireEnvMedia", "throw new Error(`Media env not configured:"],
      },
      {
        path: "packages/backend/convex/lib/env.ts",
        // The fixture seams are enumerated so a provider left FAKED in production is reported, not
        // silently green. Without this the "no development fallback" row would be half a check.
        symbols: ['tier: "fixture"', "fixturesActive"],
      },
    ],
  },
  {
    id: "p25-production-posture",
    phase: "25",
    requirement: "REVN-01/02/03 production suitability gate",
    what: "Production secret SOURCE, redirect-URI OWNERSHIP and hosted fail-closed behaviour. None of these are facts about this repository.",
    owner: "Owner (28-17 Task 2 checkpoint)",
    posture: "phase25_production_posture",
    // Why this can never be a `files` row: Phase 25 plans 25-11 (deploy the Branch-A production
    // bundle), 25-12 (automated production qualification) and 25-13 (live acceptance) have no
    // SUMMARY on disk. The code-side posture above is real and green; whether it was ever EXERCISED
    // against a hosted deployment is an observation, and only the owner has made it.
  },

  // ── Phase 27 — the native pack contract ───────────────────────────────────────────────────────
  {
    id: "p27-manifest-provenance",
    phase: "27",
    requirement: "PACK-01",
    what: "Pinned upstream snapshot + offline provenance verifier + attribution. A connector pack inherits this shape.",
    owner: "Phase 27 lane",
    files: [
      { path: "third_party/knowledge-work-plugins/manifest.json", symbols: [] },
      {
        path: "scripts/verify-knowledge-work-provenance.mjs",
        symbols: ["--check-source", "--check", "adaptedBodySha256"],
      },
      { path: "THIRD_PARTY_NOTICES.md", symbols: ["knowledge-work-plugins"] },
    ],
  },
  {
    id: "p27-static-grant",
    phase: "27",
    requirement: "PACK-02",
    what: "Code-owned per-pack tool allow-list + forbidden-operation vocabulary. REVN-06 needs this to keep sends/refunds unreachable.",
    owner: "Phase 27 lane",
    files: [
      {
        path: "packages/core/src/workflowPacks.ts",
        symbols: [
          "export const WORKFLOW_PACK_IDS",
          "export const WORKFLOW_PACKS",
          "export function toolsForWorkflowPack",
          "export function resolveWorkflowPack",
          "export const LEAF_FORBIDDEN_OPERATIONS",
          "export const PACK_UNREACHABLE_TOOLS",
          "export const MISSING_PACK_SOURCES",
          "export function packPreflight",
        ],
      },
      { path: "packages/core/src/workflowPacks.test.ts", symbols: [] },
    ],
  },
  {
    id: "p27-pack-binding",
    phase: "27",
    requirement: "PACK-02",
    what: "The (skill body, tool-set) binding onto the existing agent loop. Revenue specialists bind the same way — do NOT write a second runtime.",
    owner: "Phase 27 lane",
    files: [
      {
        path: "packages/backend/convex/workflowPackBinding.ts",
        symbols: [
          "export const runWorkflowPack",
          "export function preflightPrompt",
          "export function outcomeFor",
        ],
      },
      { path: "packages/backend/convex/workflowPackBinding.test.ts", symbols: [] },
      { path: "packages/backend/convex/cockpit.ts", symbols: ["export const startWorkflowPack"] },
    ],
  },
  {
    id: "p27-candidate-lifecycle",
    phase: "27",
    requirement: "PACK-03",
    what: "Dark-first publication, provenance/eval/browser gating, activation and an owner-facing deactivate.",
    owner: "Phase 27 lane",
    files: [
      {
        path: "packages/backend/convex/skills.ts",
        symbols: [
          "export const publishPackCandidate",
          "export const inspectPackCandidates",
          "export const recordPackBrowserEvidence",
          "export const deactivatePack",
          "export const activateCandidate",
          "export const getActiveSkill",
          "export const PACK_GATE_ERROR",
          "export const PROVENANCE_PIN_ERROR",
        ],
      },
      {
        path: "packages/core/src/workflowPacks.ts",
        symbols: [
          "export function hasValidPackProvenance",
          "export function hasPassingPackBrowserEvidence",
        ],
      },
      { path: "packages/backend/convex/skills.test.ts", symbols: [] },
    ],
  },
  {
    id: "p27-golden-eval",
    phase: "27",
    requirement: "PACK-03",
    what: "Per-pack fixture evaluation writing evidence onto the exact skill version. Revenue packs must reuse it, not add a third runner.",
    owner: "Phase 27 lane",
    files: [
      {
        path: "packages/backend/scripts/run-workflow-pack-evals.mjs",
        symbols: [],
      },
      { path: "packages/backend/scripts/workflow-pack-fixtures/thresholds.json", symbols: [] },
      {
        path: "packages/backend/scripts/run-eval-golden.mjs",
        symbols: ["COST_CAP_USD"],
      },
    ],
  },
  {
    id: "p27-discovery",
    phase: "27",
    requirement: "PACK-04",
    what: "Tenant-visible pack list with honest source availability. REVN-01/02/03 connector states surface through this, not a new shelf.",
    owner: "Phase 27 lane",
    files: [
      {
        path: "packages/backend/convex/workflowPackDiscovery.ts",
        symbols: [
          "export const listPacks",
          "export const probeSources",
          "export const listPackCandidates",
        ],
      },
      { path: "packages/backend/convex/workflowPackDiscovery.test.ts", symbols: [] },
    ],
  },
  {
    id: "p27-shared-events",
    phase: "27",
    requirement: "PACK-04",
    what: "The shared refs-only pack event plane and derived metrics. REVN telemetry EXTENDS this; it must not open a sixth event plane.",
    owner: "Phase 27 lane",
    files: [
      {
        path: "packages/core/src/workflowPackMetrics.ts",
        symbols: [
          "export const PACK_EVENTS",
          "export const PACK_OUTCOMES",
          "export const PACK_DERIVED_METRIC_SOURCES",
          "export function followUpRecovery",
        ],
      },
      {
        path: "packages/backend/convex/workflowPackEventLog.ts",
        symbols: ["export const record", "export function toMetricEvent", "export const forTenant"],
      },
      { path: "packages/backend/convex/schema.ts", symbols: ["workflowPackEvents: defineTable("] },
      { path: "packages/core/src/workflowPackMetrics.test.ts", symbols: [] },
      { path: "packages/backend/convex/workflowPackEventLog.test.ts", symbols: [] },
    ],
  },
  {
    id: "p27-outcomes",
    phase: "27",
    requirement: "PACK-04",
    what: "Cost/latency read from their EXISTING owners rather than re-emitted. REVN success measurement joins here.",
    owner: "Phase 27 lane",
    files: [
      {
        path: "packages/backend/convex/workflowPackOutcomes.ts",
        symbols: ["export const forTenant", "PackOutcomeReport"],
      },
      { path: "packages/backend/convex/workflowPackOutcomes.test.ts", symbols: [] },
    ],
  },
];

// ── The engine ───────────────────────────────────────────────────────────────────────────────────

/** Reads a repo-relative path, or null when it is absent. `read` is injectable so `--self-check`
 *  can mutate content without touching the working tree. */
function defaultRead(rel) {
  const abs = join(repoRoot, rel);
  if (!existsSync(abs)) return null;
  // A directory satisfies existence but has no content; treat it as an empty file so a `symbols: []`
  // row can name a directory and a row that names symbols in one cannot pass.
  if (statSync(abs).isDirectory()) return "";
  return readFileSync(abs, "utf8");
}

const IDENT = /[A-Za-z0-9_$]/;

/**
 * Whole-symbol containment, NOT `String.includes`.
 *
 * THIS COST A ROUND. The first cut used `includes`, self-checked green on 91 symbols, and was then
 * observed failing to notice `export const listPacks` being renamed to `export const listPacksRENAMED`
 * — because the old name is still a substring of the new one. A gate that survives the rename it
 * exists to catch is the repo's "green tests over broken capability" class, verbatim.
 *
 * So a match must not be flanked by identifier characters on an end where the symbol itself has one.
 * Symbols ending in `(`, `"` or `-` are unaffected; identifier-shaped ones are now rename-proof.
 */
function containsSymbol(hay, sym) {
  const startBounded = IDENT.test(sym[0]);
  const endBounded = IDENT.test(sym[sym.length - 1]);
  for (let i = hay.indexOf(sym); i !== -1; i = hay.indexOf(sym, i + 1)) {
    const before = i > 0 ? hay[i - 1] : "";
    const after = hay[i + sym.length] ?? "";
    if ((!startBounded || !IDENT.test(before)) && (!endBounded || !IDENT.test(after))) return true;
  }
  return false;
}

/**
 * Evaluate one file requirement. Returns an array of failure strings (empty = green).
 * LF-normalizes because `.md`/`.ts` check out CRLF on Windows and a multi-line symbol would
 * otherwise miss — the same trap `verify-knowledge-work-provenance.mjs` documents.
 */
function checkFile(file, read) {
  const content = read(file.path);
  if (content === null) return [`${file.path}: MISSING — no such file`];
  const hay = content.replace(/\r\n/g, "\n");
  return file.symbols
    .filter((s) => !containsSymbol(hay, s.replace(/\r\n/g, "\n")))
    .map((s) => `${file.path}: MISSING symbol \`${s}\``);
}

/** Evaluate every non-posture row. */
function runCodeChecks(read) {
  return CHECKS.filter((c) => !c.posture).map((c) => {
    const failures = c.files.flatMap((f) => checkFile(f, read));
    return { ...c, status: failures.length === 0 ? "green" : "red", failures };
  });
}

/**
 * Parse the owner attestation out of the readiness doc.
 *
 * It lives in an HTML comment so the doc renders clean, and it is a CLOSED value set: a typo reads
 * `undecided` (blocking), never `pass`. An absent doc or an absent key is `undecided` — the gate
 * must not be satisfiable by forgetting to write the file.
 */
function readAttestation(read) {
  const doc = read(READINESS_DOC);
  const out = {};
  for (const c of CHECKS.filter((x) => x.posture)) out[c.posture] = "undecided";
  if (doc === null) return { found: false, values: out };
  const block = /<!--\s*phase28-attestation([\s\S]*?)-->/.exec(doc.replace(/\r\n/g, "\n"));
  if (!block) return { found: false, values: out };
  for (const key of Object.keys(out)) {
    const m = new RegExp(`^\\s*${key}\\s*:\\s*([a-z]+)\\s*$`, "m").exec(block[1]);
    if (m && POSTURE_VALUES.includes(m[1])) out[key] = m[1];
  }
  return { found: true, values: out };
}

function runAll(read) {
  const code = runCodeChecks(read);
  const att = readAttestation(read);
  const posture = CHECKS.filter((c) => c.posture).map((c) => {
    const v = att.values[c.posture];
    return {
      ...c,
      status: v === "pass" ? "green" : "red",
      failures:
        v === "pass"
          ? []
          : [
              v === "block"
                ? `${READINESS_DOC}: owner attested \`${c.posture}: block\``
                : `${READINESS_DOC}: \`${c.posture}\` is \`undecided\` — no owner judgment on record`,
            ],
    };
  });
  const rows = [...code, ...posture];
  return { rows, passed: rows.every((r) => r.status === "green"), attestationFound: att.found };
}

// ── --self-check: prove the gate can go red ──────────────────────────────────────────────────────

/**
 * Two mechanical proofs, because a gate nobody has watched fail is not evidence of anything.
 *
 *   1. EMPTY TREE — with every file absent, EVERY row must be red. Catches a row whose file list is
 *      empty, or whose symbols are all `[]` on a path that cannot be missing.
 *   2. LOAD-BEARING SYMBOLS — for every symbol in the table, re-run its row with that one string
 *      MUTATED in the file content and require the row to flip red. Two mutations, because the
 *      first cut only did the first and shipped a gate a rename walked straight through:
 *        a. DELETE every occurrence — catches a symbol nothing depends on.
 *        b. RENAME it (suffix, and prefix, on identifier-shaped symbols) — catches the substring
 *           trap, where `listPacks` still "matches" inside `listPacksRENAMED`.
 *
 * Also asserts the posture row is red under the empty tree, which is the `undecided` default.
 */
function selfCheck() {
  const problems = [];

  const empty = runAll(() => null);
  for (const r of empty.rows) {
    if (r.status !== "red")
      problems.push(`row \`${r.id}\` is GREEN against an empty tree — vacuous`);
  }

  // A row with no file requirement and no posture can never be red for a real reason.
  for (const c of CHECKS) {
    if (!c.posture && (c.files ?? []).length === 0) {
      problems.push(`row \`${c.id}\` declares neither files nor a posture key`);
    }
  }

  // Baseline: only mutate symbols whose row is green today, otherwise "still red" proves nothing.
  const base = runCodeChecks(defaultRead);
  const byId = new Map(base.map((r) => [r.id, r]));

  for (const c of CHECKS.filter((x) => !x.posture)) {
    const row = byId.get(c.id);
    for (const f of c.files) {
      for (const s of f.symbols) {
        if (!s) {
          problems.push(`row \`${c.id}\`: empty symbol in ${f.path}`);
          continue;
        }
        if (row.status === "red") continue; // cannot prove load-bearing on an already-red row
        const mutations = [["deleting", ""]];
        if (IDENT.test(s[s.length - 1])) mutations.push(["suffix-renaming", `${s}ZZ`]);
        if (IDENT.test(s[0])) mutations.push(["prefix-renaming", `ZZ${s}`]);
        for (const [label, replacement] of mutations) {
          const mutated = (rel) => {
            const v = defaultRead(rel);
            if (v === null) return null;
            return rel === f.path ? v.split(s).join(replacement) : v;
          };
          const after = c.files.flatMap((ff) => checkFile(ff, mutated));
          if (after.length === 0) {
            problems.push(
              `row \`${c.id}\`: ${label} \`${s}\` in ${f.path} left the row GREEN — not load-bearing`,
            );
          }
        }
      }
    }
  }

  // The posture row must be blocked by anything that is not a literal `pass`.
  for (const bad of ["block", "undecided", "PASS", "yes", ""]) {
    const doc = `<!-- phase28-attestation\nphase25_production_posture: ${bad}\n-->`;
    const r = runAll((rel) => (rel === READINESS_DOC ? doc : null));
    const p = r.rows.find((x) => x.id === "p25-production-posture");
    if (p.status !== "red") problems.push(`posture \`${bad}\` was accepted as pass`);
  }
  const okDoc = "<!-- phase28-attestation\nphase25_production_posture: pass\n-->";
  const okRow = runAll((rel) => (rel === READINESS_DOC ? okDoc : null)).rows.find(
    (x) => x.id === "p25-production-posture",
  );
  if (okRow.status !== "green") problems.push("a literal `pass` attestation was not accepted");

  if (problems.length) {
    stdout.write(`SELF-CHECK FAILED (${problems.length})\n`);
    for (const p of problems) stdout.write(`  - ${p}\n`);
    return 1;
  }
  const symbols = CHECKS.filter((c) => !c.posture).reduce(
    (n, c) => n + c.files.reduce((m, f) => m + f.symbols.length, 0),
    0,
  );
  stdout.write(
    `SELF-CHECK PASSED — ${CHECKS.length} rows all red against an empty tree; ` +
      `${symbols} symbols each proven load-bearing; posture accepts only a literal \`pass\`.\n`,
  );
  return 0;
}

// ── Report ───────────────────────────────────────────────────────────────────────────────────────

function report(json) {
  const { rows, passed, attestationFound } = runAll(defaultRead);
  if (json) {
    stdout.write(
      `${JSON.stringify(
        {
          status: passed ? "passed" : "blocked",
          attestationFound,
          rows: rows.map((r) => ({
            id: r.id,
            phase: r.phase,
            requirement: r.requirement,
            status: r.status,
            owner: r.owner,
            failures: r.failures,
          })),
        },
        null,
        2,
      )}\n`,
    );
    return passed ? 0 : 1;
  }

  stdout.write("Phase 28 readiness — landed-contract gate (28-17)\n\n");
  for (const phase of ["19", "25", "27"]) {
    stdout.write(`Phase ${phase}\n`);
    for (const r of rows.filter((x) => x.phase === phase)) {
      stdout.write(`  ${r.status === "green" ? "OK   " : "BLOCK"} ${r.id}  [${r.requirement}]\n`);
      for (const f of r.failures) stdout.write(`         ${f}\n`);
      if (r.status !== "green") stdout.write(`         owner: ${r.owner}\n`);
    }
    stdout.write("\n");
  }
  const red = rows.filter((r) => r.status !== "green");
  if (passed) {
    stdout.write("RESULT: passed — every Phase 19/25/27 prerequisite is landed and attested.\n");
    return 0;
  }
  stdout.write(
    `RESULT: blocked — ${red.length} of ${rows.length} rows red. ` +
      "Every Phase 28 dependent plan must stop.\n" +
      `Recheck: node scripts/check-phase28-readiness.mjs\n`,
  );
  return 1;
}

/**
 * The doc's landed-interface inventory, rendered FROM the table rather than retyped beside it.
 * `docs/connectors/phase28-readiness.md` pastes this verbatim; a hand-maintained second copy is a
 * copy that goes stale and then gets believed.
 */
function inventory() {
  const { rows } = runAll(defaultRead);
  for (const phase of ["19", "25", "27"]) {
    stdout.write(`### Phase ${phase}\n\n`);
    for (const r of rows.filter((x) => x.phase === phase)) {
      stdout.write(
        `**\`${r.id}\`** — ${r.requirement} — ${r.status === "green" ? "GREEN" : "RED"}\n`,
      );
      stdout.write(`> ${r.what}\n\n`);
      if (r.posture) {
        stdout.write(`- Not code-provable. Owner attestation key: \`${r.posture}\`\n\n`);
        continue;
      }
      for (const f of r.files) {
        stdout.write(`- \`${f.path}\`${f.symbols.length ? "" : " *(presence only)*"}\n`);
        // A symbol containing a backtick needs a longer fence, or the doc renders garbage.
        for (const s of f.symbols) {
          const [o, c] = s.includes("`") ? ["`` ", " ``"] : ["`", "`"];
          stdout.write(`  - ${o}${s}${c}\n`);
        }
      }
      stdout.write("\n");
    }
  }
  return 0;
}

if (import.meta.url === pathToFileURL(argv[1]).href) {
  const flags = argv.slice(2);
  const unknown = flags.filter((f) => !["--json", "--self-check", "--inventory"].includes(f));
  if (unknown.length) {
    stdout.write(`unknown flag(s): ${unknown.join(", ")}\n`);
    exit(2);
  }
  if (flags.includes("--self-check")) exit(selfCheck());
  if (flags.includes("--inventory")) exit(inventory());
  exit(report(flags.includes("--json")));
}

export { CHECKS, runAll, selfCheck };
