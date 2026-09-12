// Supplemental CURRENT-boundary evidence. Never rewrites historical mutation claims.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computeEvaluatorRevision } from "../packages/backend/scripts/goldenEvaluatorIdentity.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (base, path) => readFileSync(join(base, path), "utf8");
const skill = "packages/contracts/src/skill.ts";
const contractTest = "packages/contracts/src/skillAuthoring.test.ts";
const writer = "packages/backend/convex/skills.ts";
const writerTest = "packages/backend/convex/skills.test.ts";
const llm = "packages/backend/convex/llm.ts";
const runner = "packages/backend/scripts/run-eval-golden.mjs";
const ui = "apps/web/app/(app)/dashboard/workspace/";
const edit = (path, from, to, after) => ({ path, from, to, after });
const vitest = (workspace, file, test) => ({ kind: "vitest", workspace, file, test });
const contracts = (test) => vitest("packages/contracts", "src/skillAuthoring.test.ts", test);
const backend = (test, file = "convex/skills.test.ts") => vitest("packages/backend", file, test);
const setNeedle = "  LEAD_ENGINE_SKILL,\n] as const;";
const authorRegion = "export const publishAgentCandidate";
const evidenceRegion = "export function hasPassingAgentTenantEvidence";
const cases = [
  ...["sourceThreadId", "sourceTurnId"].map((field) => ({
    id: `23-01-persisted-${field}`,
    command: backend(
      "agent writer requires input lineage and persists exact server-owned lineage and author",
    ),
    edits: [
      edit(writer, `\n      ${field},\n`, `\n      // isolated omission: ${field}\n`, authorRegion),
    ],
  })),
  {
    id: "23-02-caller-derived-author",
    command: backend(
      "agent writer requires input lineage and persists exact server-owned lineage and author",
    ),
    qualification:
      "persisted author derived from existing caller-controlled authoredBody; no invented public tenant argument",
    edits: [
      edit(writer, '\n      author: "agent",', "\n      author: authoredBody,", authorRegion),
    ],
  },
  ...["live", "revenue"].map((entry) => ({
    id: `23-04-preflight-${entry}`,
    command: { kind: "entry-preflight", entry },
    expected: `PHASE23_PREFLIGHT_${entry.toUpperCase()}_REQUIRED`,
    edits: [
      entry === "live"
        ? edit(
            runner,
            "  selfCheck();\n  await runLive(",
            "  /* isolated missing live preflight */\n  await runLive(",
          )
        : edit(
            runner,
            "    selfCheck();\n    process.exit(await runRevenueCandidateMode",
            "    /* isolated missing revenue preflight */\n    process.exit(await runRevenueCandidateMode",
          ),
    ],
  })),
  {
    id: "23-01-ungated-set",
    command: contracts("keeps the agent set closed"),
    edits: [
      edit(
        skill,
        setNeedle,
        "  LEAD_ENGINE_SKILL,\n  DOCUMENT_ANALYST_SKILL,\n] as const;",
        "export const AGENT_AUTHORABLE_SKILLS",
      ),
    ],
  },
  {
    id: "23-01-subset-composite",
    qualification:
      "composite sensitivity; removing an assertion alone cannot prove a production guard",
    command: contracts("refuses ungated, un-runnable"),
    edits: [
      edit(
        skill,
        setNeedle,
        "  LEAD_ENGINE_SKILL,\n  DOCUMENT_ANALYST_SKILL,\n] as const;",
        "export const AGENT_AUTHORABLE_SKILLS",
      ),
      edit(
        contractTest,
        "    expect(AGENT_AUTHORABLE_SKILLS).toEqual(AUTHORABLE);",
        "    // Isolated sensitivity mutation: exact-set assertion absent.",
      ),
      edit(
        contractTest,
        "      expect(USER_AUTHORABLE_SKILLS as readonly string[]).toContain(name);\n      expect(GATED_SKILLS).toContain(name);",
        "      // Isolated sensitivity mutation: subset assertions absent.",
      ),
    ],
  },
  {
    id: "23-01-lineage-substitute",
    qualification:
      "documented index isolation substitute; optional provenance schema remains optional",
    command: backend("by_tenant_source_turn answers idempotence EXACTLY"),
    edits: [
      edit(
        "packages/backend/convex/schema.ts",
        '.index("by_tenant_source_turn", ["tenantId", "sourceThreadId", "sourceTurnId"])',
        '.index("by_tenant_source_turn", ["sourceThreadId", "sourceTurnId", "tenantId"])',
      ),
      edit(
        writerTest,
        'q.eq("tenantId", tenantId).eq("sourceThreadId", THREAD).eq("sourceTurnId", TURN)',
        'q.eq("sourceThreadId", THREAD).eq("sourceTurnId", TURN)',
      ),
    ],
  },
  {
    id: "23-02-active-writer",
    command: backend("the writer region contains no activation"),
    edits: [edit(writer, 'status: "candidate",', 'status: "active",', authorRegion)],
  },
  {
    id: "23-02-author-argument",
    qualification:
      "current author-key reconciliation; tenantId is already a trusted internal argument",
    command: backend("the validator has NO authority field"),
    setup: [
      edit(
        writerTest,
        'status: "active",',
        'author: "system",',
        'test("the validator has NO authority field',
      ),
    ],
    edits: [
      edit(
        writer,
        "    authoredBody: v.string(),",
        "    authoredBody: v.string(),\n    author: v.optional(v.string()),",
        authorRegion,
      ),
    ],
  },
  {
    id: "23-02-tenant-predicate",
    command: { kind: "compile", workspace: "packages/backend" },
    expected: "TS2345",
    qualification: "compile rejection, not behavioral test red",
    edits: [edit(writer, '          .eq("tenantId", tenantId)\n', "", authorRegion)],
  },
  {
    id: "23-02-archive-pending",
    command: backend("a NEW turn while any candidate is pending"),
    edits: [
      edit(
        writer,
        // biome-ignore lint/suspicious/noTemplateCurlyInString: exact source bytes, not interpolation.
        "if (pending.length > 0) throw new Error(`AGENT_CANDIDATE_PENDING: ${name}`);",
        'if (pending.length > 0) await ctx.db.patch(pending[0]._id, { status: "archived" });',
        authorRegion,
      ),
    ],
  },
  {
    id: "23-03-unconditional-tool",
    command: backend("authorSkillCandidate is ABSENT", "convex/cockpitTools.test.ts"),
    edits: [
      edit(
        llm,
        "...(grants.skillAuthoring && toolCtx.threadId && toolCtx.rootRequestId\n      ? skillAuthoringTool\n      : ({} as typeof skillAuthoringTool)),",
        "...skillAuthoringTool,",
      ),
    ],
  },
  {
    id: "23-03-self-selected-grant",
    command: backend(
      "mock loop: a specialist allow-list naming the tool STILL",
      "convex/runCockpitAgent.test.ts",
    ),
    edits: [
      edit(
        "packages/core/src/toolGrants.ts",
        "skillAuthoring: executive,",
        'skillAuthoring: executive || (toolNames?.includes("authorSkillCandidate") ?? false),',
      ),
    ],
  },
  {
    id: "23-03-activation-call",
    command: backend(
      "the authoring tool's region reaches nothing but",
      "convex/cockpitTools.test.ts",
    ),
    edits: [
      edit(
        llm,
        "          const res = await ctx.runMutation(internal.skills.publishAgentCandidate, {",
        "          await ctx.runMutation(internal.skills.activateTenantCandidate, {} as never);\n          const res = await ctx.runMutation(internal.skills.publishAgentCandidate, {",
      ),
    ],
  },
  {
    id: "23-04-row-identity",
    command: contracts("inherits every Phase-21 identity check"),
    edits: [edit(skill, "t.candidateId === target.candidateId &&", "true &&")],
  },
  {
    id: "23-04-stale-suite",
    command: contracts("refuses a stale suite"),
    edits: [edit(skill, "s.revision === AGENT_EVAL_SUITE.revision &&", "true &&", evidenceRegion)],
  },
  {
    id: "23-04-filtered",
    command: { kind: "runner" },
    expected: "a --only run executes cases and records NO evidence",
    edits: [
      edit(
        runner,
        "  if (filters.length !== 0) return false;",
        "  // Isolated mutation: filtered evidence is allowed.",
      ),
    ],
  },
  {
    id: "23-04-zero-cases",
    command: { kind: "runner" },
    expected: "it must not write `0/0 pass` as an EVAL_GATE input",
    edits: [
      edit(
        runner,
        "  if (!(casesTotal > 0)) return false;",
        "  // Isolated mutation: empty evidence is allowed.",
      ),
    ],
  },
  {
    id: "23-04-preflight",
    command: { kind: "runner" },
    expected: "the live entry must run the free self-check before entering the paid/provider path",
    edits: [
      edit(
        runner,
        "  selfCheck();\n  await runLive(",
        "  /* isolated mutation: preflight removed */\n  await runLive(",
      ),
      edit(
        runner,
        "    selfCheck();\n    process.exit(await runRevenueCandidateMode",
        "    /* isolated mutation: earlier alternate preflight removed too */\n    process.exit(await runRevenueCandidateMode",
      ),
    ],
    qualification:
      "composite entry scan reconciliation: earlier revenue preflight also matches historical scan",
  },
  {
    id: "23-04-holdout",
    command: { kind: "runner" },
    expected: "runAgentSourceInspect must not reach the held-out fixture corpus",
    edits: [
      edit(
        runner,
        "function runAgentSourceInspect({ tenantId, sourceThreadId }) {",
        "function runAgentSourceInspect({ tenantId, sourceThreadId }) {\n  void loadFixtures();",
      ),
    ],
  },
  {
    id: "23-05-ui-mount",
    command: vitest(
      "apps/web",
      "app/(app)/dashboard/workspace/skillAuthoring.test.ts",
      "the panel is mounted from the workspace",
    ),
    edits: [
      edit(
        `${ui}page.tsx`,
        "{authoring && <SkillAuthoringPanel onClose={() => setAuthoring(false)} />}",
        "{authoring && null}",
      ),
    ],
  },
];

export function patched(text, change) {
  const crlf = text.includes("\r\n");
  const normalized = text.replaceAll("\r\n", "\n");
  const start = change.after ? normalized.indexOf(change.after) : 0;
  assert.ok(start >= 0, `missing region: ${change.path}`);
  const endMarker = change.after?.startsWith("test(") ? "\n  test(" : "\nexport ";
  const next = change.after ? normalized.indexOf(endMarker, start + change.after.length) : -1;
  const end = next < 0 ? normalized.length : next;
  const head = normalized.slice(0, start);
  const tail = normalized.slice(start, end);
  assert.equal(tail.split(change.from).length, 2, `exactly one target required: ${change.path}`);
  const result = head + tail.replace(change.from, change.to) + normalized.slice(end);
  return crlf ? result.replaceAll("\n", "\r\n") : result;
}
function apply(base, changes) {
  for (const change of changes ?? [])
    writeFileSync(join(base, change.path), patched(read(base, change.path), change));
}
export function plan() {
  assert.equal(cases.length, 22);
  assert.equal(new Set(cases.map((item) => item.id)).size, 22);
  for (const item of cases) {
    const sources = new Map();
    for (const change of [...(item.setup ?? []), ...item.edits]) {
      const current = sources.get(change.path) ?? read(root, change.path);
      sources.set(change.path, patched(current, change));
    }
  }
  return cases.map(({ id, command, qualification }) => ({
    id,
    command,
    qualification: qualification ?? "single source guard mutation",
  }));
}
/** Bind source observations to the immutable snapshot and the restored read. */
export function verifySourceHashes(snapshot, before, after) {
  assert.ok(before.length > 0, "source hash proof cannot be empty");
  const expected = new Map(snapshot.map((entry) => [entry.path, entry.sha256]));
  assert.equal(expected.size, snapshot.length, "duplicate snapshot path");
  assert.equal(
    new Set(before.map((entry) => entry.path)).size,
    before.length,
    "duplicate source path",
  );
  for (const entry of before)
    assert.equal(
      entry.sha256,
      expected.get(entry.path),
      `source differs from snapshot: ${entry.path}`,
    );
  assert.deepEqual(after, before, "source changed after control");
}
const env = Object.fromEntries(
  [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
  ]
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]),
);
/** Each entry is pinned independently: a check in another branch cannot satisfy it. */
export function assertEntryPreflight(source, entry) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
  const needle =
    entry === "live"
      ? /selfCheck\(\);\s*await runLive\(parseSkillPins\(argv\)/g
      : /selfCheck\(\);\s*process\.exit\(await runRevenueCandidateMode\(revenueMode\)\)/g;
  assert.equal(
    [...clean.matchAll(needle)].length,
    1,
    `PHASE23_PREFLIGHT_${entry.toUpperCase()}_REQUIRED`,
  );
}
function execute(command, base, preload) {
  let args;
  const workspace = command.workspace ?? ".";
  if (command.kind === "vitest")
    args = [
      join(root, "packages/backend/node_modules/vitest/vitest.mjs"),
      "run",
      command.file,
      "--config",
      join(base, workspace, "mutation.config.mjs"),
      "--maxWorkers=1",
      "-t",
      command.test,
    ];
  else if (command.kind === "entry-preflight")
    args = [fileURLToPath(import.meta.url), "--check-entry", base, command.entry];
  else if (command.kind === "compile")
    args = [join(root, "node_modules/typescript/bin/tsc"), "--noEmit"];
  else
    args = [
      join(base, runner),
      command.kind === "manifest" ? "--write-suite-manifest" : "--self-check",
    ];
  return spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, ...args], {
    cwd: join(base, workspace),
    env: { ...env, PIKAR_OFFLINE_FIXTURES: "1" },
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}
function copySnapshot(destination) {
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  assert.equal(listed.status, 0);
  const manifest = [];
  for (const path of listed.stdout.split("\0").filter(Boolean)) {
    // No local secrets, auth state or historical output is needed by these offline tests.
    if (/(^|\/)\.env($|\.)|(^|\/)\.auth\/|^output\//.test(path)) continue;
    if (!existsSync(join(root, path))) continue;
    mkdirSync(dirname(join(destination, path)), { recursive: true });
    copyFileSync(join(root, path), join(destination, path));
    manifest.push({ path, sha256: hash(readFileSync(join(destination, path))) });
  }
  writeFileSync(join(destination, "snapshot-manifest.json"), `${JSON.stringify(manifest)}\n`);
  for (const path of [
    "",
    "apps/web",
    ...readdirSync(join(root, "packages")).map((name) => `packages/${name}`),
  ]) {
    if (existsSync(join(root, path, "node_modules"))) {
      mkdirSync(join(destination, path), { recursive: true });
      symlinkSync(
        join(root, path, "node_modules"),
        join(destination, path, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );
    }
  }
  return hash(JSON.stringify(manifest));
}
/** Explicit package exports precede the generic source wildcard in the isolated Vitest copy. */
export function exactExportAliases(packageName, packageDirectory, exports) {
  return Object.entries(exports ?? {}).flatMap(([key, value]) => {
    if (key.includes("*") || typeof value !== "string" || !value.startsWith("./")) return [];
    const specifier = key === "." ? packageName : `${packageName}/${key.slice(2)}`;
    return [
      {
        find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
        replacement: join(packageDirectory, value),
      },
    ];
  });
}
function configure(base) {
  const preload = join(base, "offline.mjs");
  writeFileSync(
    preload,
    `import http from 'node:http'; import https from 'node:https'; import net from 'node:net'; import tls from 'node:tls'; import {syncBuiltinESMExports} from 'node:module'; const deny=()=>{throw new Error('PHASE23_NETWORK_FORBIDDEN')}; globalThis.fetch=deny; http.request=http.get=https.request=https.get=net.connect=net.createConnection=tls.connect=deny; syncBuiltinESMExports();\n`,
  );
  const alias = readdirSync(join(base, "packages"))
    .flatMap((name) => {
      const manifest = join(base, "packages", name, "package.json");
      if (!existsSync(manifest)) return [];
      const { name: packageName, exports } = JSON.parse(readFileSync(manifest, "utf8"));
      if (!packageName?.startsWith("@pikar/")) return [];
      return [
        ...exactExportAliases(packageName, join(base, "packages", name), exports).map(
          (entry) => `{find:${entry.find},replacement:${JSON.stringify(entry.replacement)}}`,
        ),
        `{find:/^${packageName.replaceAll("/", "\\/")}$/,replacement:${JSON.stringify(join(base, "packages", name, "src/index.ts"))}}`,
        `{find:/^${packageName.replaceAll("/", "\\/")}\\/(.+)$/,replacement:${JSON.stringify(join(base, "packages", name, "src/$1.ts"))}}`,
      ];
    })
    .join(",");
  for (const workspace of ["packages/backend", "packages/contracts", "apps/web"]) {
    const original = join(base, workspace, "vitest.config.mts");
    const baseImport = existsSync(original)
      ? `import base from ${JSON.stringify(original)};`
      : "const base={};";
    writeFileSync(
      join(base, workspace, "mutation.config.mjs"),
      `${baseImport}\nexport default {...base,cacheDir:${JSON.stringify(join(base, ".cache", workspace))},resolve:{...base.resolve,alias:[${alias}]},test:{...base.test,watch:false,setupFiles:[${JSON.stringify(preload)}]}};\n`,
    );
  }
  return preload;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--check-entry" && args.length === 3 && ["live", "revenue"].includes(args[2])) {
    assertEntryPreflight(read(args[1], runner), args[2]);
    return;
  }
  if (args.length === 1 && args[0] === "--self-check") {
    plan();
    const result = spawnSync(
      process.execPath,
      ["--test", join(root, "scripts/check-phase23-mutation-proofs.test.mjs")],
      { cwd: root, env, encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(result.status, 0, "lightweight mutation harness checks must pass");
    process.stdout.write(
      `Phase 23 mutation harness: ${cases.length} anchors and patch-engine checks passed; deliberate mutants NOT executed.\n`,
    );
    return;
  }
  if (args.length === 1 && args[0] === "--plan") {
    process.stdout.write(
      `${JSON.stringify({ schema: "phase23-mutation-plan.v1", cases: plan(), executed: false })}\n`,
    );
    return;
  }
  assert.ok(
    args[0] === "--run" && args.length <= 2,
    "Use --plan (no tests), or --run [exact-case-id] (offline serial tests).",
  );
  plan();
  const selected = args[1] ? cases.filter((item) => item.id === args[1]) : cases;
  assert.ok(selected.length > 0, "unknown exact case id");
  const base = join(root, ".tmp", `phase23-mutation-${Date.now()}`);
  mkdirSync(base, { recursive: true });
  const harnessBytes = readFileSync(fileURLToPath(import.meta.url));
  const harnessSha256 = hash(harnessBytes);
  writeFileSync(join(base, "harness.mjs"), harnessBytes);
  const snapshotSha256 = copySnapshot(base);
  const snapshot = JSON.parse(read(base, "snapshot-manifest.json"));
  const preload = configure(base);
  const receipts = [];
  for (const item of selected) {
    const paths = [
      ...new Set([
        ...[...(item.setup ?? []), ...item.edits].map((change) => change.path),
        ...(item.command.kind === "runner"
          ? [skill, "packages/backend/scripts/eval-suite-manifest.json"]
          : []),
      ]),
    ];
    const originals = new Map(paths.map((path) => [path, readFileSync(join(base, path))]));
    const liveBefore = paths.map((path) => ({
      path,
      sha256: hash(readFileSync(join(root, path))),
    }));
    verifySourceHashes(snapshot, liveBefore, liveBefore);
    let result;
    try {
      apply(base, item.setup);
      const controlHashes = paths.map((path) => ({
        path,
        sha256: hash(readFileSync(join(base, path))),
      }));
      const clean = execute(item.command, base, preload);
      writeFileSync(
        join(base, `${item.id}.clean.log`),
        `${clean.stdout ?? ""}${clean.stderr ?? ""}`,
      );
      assert.equal(
        clean.status,
        0,
        `${item.id}: clean control failed (receipt directory retained)`,
      );
      apply(base, item.edits);
      let copiedEvaluatorRevision;
      if (item.command.kind === "runner") {
        copiedEvaluatorRevision = computeEvaluatorRevision(base);
        const source = read(base, skill);
        const current = source
          .slice(source.indexOf("export const AGENT_EVAL_SUITE"))
          .match(/revision:\s*"([^"]+)"/);
        assert.ok(current, "copy evaluator revision must be present");
        writeFileSync(
          join(base, skill),
          patched(
            source,
            edit(skill, current[1], copiedEvaluatorRevision, "export const AGENT_EVAL_SUITE"),
          ),
        );
        const manifest = execute({ kind: "manifest" }, base, preload);
        assert.equal(manifest.status, 0, "disposable manifest regeneration must succeed");
      }
      const mutationHashes = paths.map((path) => ({
        path,
        sha256: hash(readFileSync(join(base, path))),
      }));
      const red = execute(item.command, base, preload);
      const output = `${red.stdout ?? ""}${red.stderr ?? ""}`;
      writeFileSync(join(base, `${item.id}.log`), output);
      assert.equal(red.status, 1, `${item.id}: expected deliberate rejection`);
      assert.ok(
        output.includes(item.expected ?? item.command.test),
        `${item.id}: expected named oracle absent`,
      );
      for (const [path, bytes] of originals) writeFileSync(join(base, path), bytes);
      apply(base, item.setup);
      const restored = execute(item.command, base, preload);
      writeFileSync(
        join(base, `${item.id}.restored.log`),
        `${restored.stdout ?? ""}${restored.stderr ?? ""}`,
      );
      assert.equal(restored.status, 0, `${item.id}: fresh restored control failed`);
      const restoredSnapshotHashes = paths.map((path) => ({
        path,
        sha256: hash(readFileSync(join(base, path))),
      }));
      assert.deepEqual(
        restoredSnapshotHashes,
        controlHashes,
        `${item.id}: restored control bytes differ`,
      );
      result = {
        id: item.id,
        qualification: item.qualification ?? "single source guard mutation",
        cleanExit: clean.status,
        redExit: red.status,
        restoredExit: restored.status,
        sourceHashes: liveBefore,
        sourceAfterHashes: paths.map((path) => ({
          path,
          sha256: hash(readFileSync(join(root, path))),
        })),
        controlHashes,
        mutationHashes,
        copiedEvaluatorRevision,
        restoredSnapshotHashes,
      };
      verifySourceHashes(snapshot, result.sourceHashes, result.sourceAfterHashes);
    } finally {
      for (const [path, bytes] of originals) writeFileSync(join(base, path), bytes);
      for (const entry of liveBefore)
        assert.equal(
          hash(readFileSync(join(root, entry.path))),
          entry.sha256,
          `active source drift: ${entry.path}`,
        );
      assert.equal(
        hash(readFileSync(fileURLToPath(import.meta.url))),
        harnessSha256,
        "running harness source changed",
      );
    }
    receipts.push(result);
    writeFileSync(
      join(base, "receipts.json"),
      `${JSON.stringify({ schema: "phase23-current-mutation-proof.v2", harnessSha256, snapshotSha256, sourceWritten: false, isolatedCopiesWritten: true, networkDisabled: true, cases: receipts }, null, 2)}\n`,
    );
    process.stdout.write(`${item.id}: clean/red/restored; active source unchanged\n`);
  }
  process.stdout.write(`Receipts: ${base}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    process.stderr.write(`PHASE23_MUTATION_PROOF_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}
