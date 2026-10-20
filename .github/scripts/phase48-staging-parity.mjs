// Dry-run only. Never apply, seed, change configuration or read provider credentials.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const root = fileURLToPath(new URL("../../", import.meta.url));
const backend = resolve(root, "packages/backend");
const dashboard = "https://dashboard.convex.dev/d/woozy-wren-368";
const origin = "https://pikar-ai-staging-joelferuzi.vercel.app";
const fingerprint = "b389a2014e514c7a35e08480dcef446aeb46b360861e2b8b72f9e67fc61f412e";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const demand = (ok) => {
  if (!ok) throw Error("PHASE48_STAGING_PARITY_REFUSED");
};
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v, names) => object(v) && Object.keys(v).sort().join() === [...names].sort().join();

export function childEnvironment(env) {
  // Installed CLI treats project/preview keys differently for `deploy` (implicitProd)
  // and read commands. Admit only this exact deployment-scoped selector, never a
  // broader key that could make the dry-run target differ from the snapshots.
  demand(
    typeof env.STAGING_CONVEX_DEPLOY_KEY === "string" &&
      /^dev:woozy-wren-368\|[^\s|]+$/.test(env.STAGING_CONVEX_DEPLOY_KEY),
  );
  const result = {};
  for (const name of [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
  ])
    if (env[name] !== undefined) result[name] = env[name];
  return {
    ...result,
    CONVEX_DEPLOY_KEY: env.STAGING_CONVEX_DEPLOY_KEY,
    CI: "true",
    GITHUB_ACTIONS: "true",
    NO_COLOR: "1",
    DO_NOT_TRACK: "1",
  };
}

// Installed CLI components.ts emits FinishPushDiff JSON only with --verbose. Missing,
// ambiguous or extended shapes cannot establish parity. No raw diff text is printed.
export function summarizeDiff(output) {
  const text = stripVTControlCharacters(output);
  const found = [];
  for (const match of text.matchAll(/^\{/gm)) {
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let end = match.index; end < text.length; end++) {
      const char = text[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        try {
          const value = JSON.parse(text.slice(match.index, end + 1));
          if (object(value) && "componentDiffs" in value) found.push(value);
        } catch {
          /* unknown */
        }
        break;
      }
    }
  }
  const unknown = { diffStatus: "unknown", parityEstablished: false };
  if (found.length !== 1) return unknown;
  const diff = found[0];
  if (
    !keys(diff, ["authDiff", "definitionDiffs", "componentDiffs"]) ||
    !keys(diff.authDiff, ["added", "removed"]) ||
    !object(diff.definitionDiffs) ||
    !object(diff.componentDiffs)
  )
    return unknown;
  let changes = 0;
  const count = (v) => {
    demand(Array.isArray(v));
    changes += v.length;
  };
  try {
    count(diff.authDiff.added);
    count(diff.authDiff.removed);
    if (Object.keys(diff.definitionDiffs).length) return unknown;
    for (const item of Object.values(diff.componentDiffs)) {
      if (
        !keys(item, [
          "diffType",
          "moduleDiff",
          "udfConfigDiff",
          "cronDiff",
          "indexDiff",
          "schemaDiff",
        ]) ||
        !keys(item.diffType, ["type"]) ||
        !["modify", "create", "unmount", "remount"].includes(item.diffType.type)
      )
        return unknown;
      if (item.diffType.type !== "modify") changes++;
      if (
        !keys(item.moduleDiff, ["added", "removed"]) ||
        !keys(item.cronDiff, ["added", "updated", "deleted"])
      )
        return unknown;
      Object.values(item.moduleDiff).forEach(count);
      Object.values(item.cronDiff).forEach(count);
      if (
        !object(item.indexDiff) ||
        !["added_indexes", "removed_indexes"].every((k) => Object.hasOwn(item.indexDiff, k)) ||
        Object.keys(item.indexDiff).some(
          (k) =>
            !["added_indexes", "removed_indexes", "enabled_indexes", "disabled_indexes"].includes(
              k,
            ),
        )
      )
        return unknown;
      Object.values(item.indexDiff).forEach(count);
      for (const [value, previous, next] of [
        [item.udfConfigDiff, "previous_version", "next_version"],
        [item.schemaDiff, "previous_schema", "next_schema"],
      ]) {
        if (value !== null) {
          if (!keys(value, [previous, next])) return unknown;
          if (value[previous] !== value[next]) changes++;
        }
      }
    }
  } catch {
    return unknown;
  }
  const headers = [
    ...text.matchAll(
      /Remote config would be overwritten with the following changes:\r?\n([^\r\n]*)/g,
    ),
  ];
  if (headers.length !== 1) return unknown;
  if (headers[0][1].trim() !== "") changes++;
  return {
    diffStatus: changes ? "changes" : "zero",
    parityEstablished: changes === 0,
    changedItemCount: changes,
    structuredDiffSha256: hash(JSON.stringify(diff)),
  };
}

const retentionQuery = `
const interviews=await ctx.db.query("foundationInterviews").take(201);
if(interviews.length>200)throw Error("BOUND");
const fixtures=interviews.filter(x=>x.tenantId.startsWith("retention-qualification-"));
if(fixtures.length!==1)throw Error("FIXTURE");
const digest=async x=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(x))))).map(b=>b.toString(16).padStart(2,"0")).join("");
if(await digest([fixtures[0]._id,fixtures[0].tenantId,fixtures[0]._creationTime])!==${JSON.stringify(fingerprint)})throw Error("FIXTURE");
const rows=await ctx.db.query("foundationTranscripts").withIndex("by_tenant",q=>q.eq("tenantId",fixtures[0].tenantId)).take(2);
if(rows.length!==1||rows[0].eventId!=="retention-clock-probe"||Math.abs(rows[0]._creationTime-Date.parse("2026-10-17T10:18:29.493Z"))>1||rows[0].expiresAt!==Date.parse("2026-10-24T10:18:29.493Z")||Date.now()>=rows[0].expiresAt)throw Error("CLOCK");
return {sha256:await digest([fixtures[0],rows[0]]),checkpointCount:1};`;
const registrySelection = [
  ["cockpit-agent", "cockpitAgent", "cockpitAgentSkillBody"],
  ["offer-architect", "offerArchitect", "offerArchitectSkillBody"],
  ["money-model-designer", "moneyModelDesigner", "moneyModelDesignerSkillBody"],
  ["lead-engine", "leadEngine", "leadEngineSkillBody"],
  ["executive-router", "executiveRouter", "executiveRouterSkillBody"],
];
const registryQuery = `const rows=await ctx.db.query("skills").take(1001);if(rows.length>1000)throw Error("BOUND");const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,"0")).join("");const selected=[];for(const key of ${JSON.stringify(registrySelection.map(([key]) => key))}){const active=rows.filter(r=>r.name===key&&r.status==="active");selected.push({key,activeCount:active.length,active:await Promise.all(active.map(async r=>({id:String(r._id),version:r.version,bodyHash:await digest(r.body)})))});}return {count:rows.length,sha256:await digest(JSON.stringify(rows)),selected};`;

export async function runParity(env = process.env, execute = spawnSync, onPhase = () => {}) {
  onPhase("admission");
  demand(
    env.GITHUB_ACTIONS === "true" &&
      env.CI === "true" &&
      /^[a-f0-9]{40}$/.test(env.EXPECTED_SOURCE_SHA ?? "") &&
      /^[1-9]\d*$/.test(env.EXPECTED_CI_RUN_ID ?? "") &&
      Number.isSafeInteger(Number(env.EXPECTED_CI_RUN_ID)) &&
      env.STAGING_CONVEX_DEPLOY_KEY,
  );
  const childEnv = childEnvironment(env);
  const run = (file, args, cwd) => {
    const result = execute(file, args, {
      cwd,
      env: childEnv,
      encoding: "utf8",
      timeout: 600000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    demand(!result.error && result.status === 0);
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
  const git = (args) => run("git", args, root).stdout.trim();
  const cli = (args) =>
    run(process.execPath, [resolve(backend, "node_modules/convex/bin/main.js"), ...args], backend);
  const clean = () => {
    demand(git(["rev-parse", "HEAD"]) === env.EXPECTED_SOURCE_SHA);
    demand(git(["status", "--porcelain", "--untracked-files=all"]) === "");
    return git(["ls-files", "--stage"]);
  };
  const target = () => demand(cli(["dashboard", "--no-open"]).stdout.trim() === dashboard);
  const query = (source) => JSON.parse(cli(["run", "--inline-query", source]).stdout);
  const { ENV_MANIFEST, ORIGIN_ENV } = await import(
    new URL("../../packages/backend/convex/lib/env.ts", import.meta.url)
  );
  const sourceHashes = new Map();
  for (const [key, file, field] of registrySelection) {
    const source = await import(
      new URL(`../../packages/contracts/src/skills/${file}.ts`, import.meta.url)
    );
    demand(typeof source[field] === "string");
    sourceHashes.set(key, hash(source[field]));
  }
  const names = [
    ...new Set([
      ...ORIGIN_ENV.filter((name) => name !== "CONVEX_SITE_URL"),
      ...ENV_MANIFEST.filter((x) => /_(ENABLED|VERIFIED)$/.test(x.name)).map((x) => x.name),
    ]),
  ].sort();
  const snapshot = (when) => {
    onPhase(when === "before" ? "before_target" : "after_target");
    target();
    onPhase(when === "before" ? "before_configuration" : "after_configuration");
    const existing = new Set(cli(["env", "list", "--names-only"]).stdout.trim().split(/\r?\n/));
    const configuration = Object.fromEntries(
      names.map((name) => [
        name,
        existing.has(name) ? cli(["env", "get", name]).stdout.trim() : null,
      ]),
    );
    demand(configuration.SITE_URL === origin);
    for (const [name, value] of Object.entries(configuration))
      if (value !== null && /_(ENABLED|VERIFIED)$/.test(name))
        demand(["0", "1", "false", "true"].includes(value));
    onPhase(when === "before" ? "before_runtime_origins" : "after_runtime_origins");
    const runtimeOrigins = query(
      "return {site:process.env.CONVEX_SITE_URL,cloud:process.env.CONVEX_CLOUD_URL};",
    );
    demand(
      keys(runtimeOrigins, ["site", "cloud"]) &&
        runtimeOrigins.site === "https://woozy-wren-368.convex.site" &&
        runtimeOrigins.cloud === "https://woozy-wren-368.convex.cloud",
    );
    onPhase(when === "before" ? "before_retention" : "after_retention");
    const retention = query(retentionQuery);
    demand(
      keys(retention, ["sha256", "checkpointCount"]) &&
        retention.checkpointCount === 1 &&
        /^[a-f0-9]{64}$/.test(retention.sha256),
    );
    onPhase(when === "before" ? "before_registry" : "after_registry");
    const registry = query(registryQuery);
    demand(
      keys(registry, ["sha256", "count", "selected"]) &&
        Number.isSafeInteger(registry.count) &&
        registry.count > 0 &&
        registry.count <= 1000 &&
        /^[a-f0-9]{64}$/.test(registry.sha256),
    );
    demand(
      Array.isArray(registry.selected) && registry.selected.length === registrySelection.length,
    );
    const ids = new Set();
    for (const [index, selected] of registry.selected.entries()) {
      demand(
        keys(selected, ["key", "activeCount", "active"]) &&
          selected.key === registrySelection[index][0] &&
          Number.isSafeInteger(selected.activeCount) &&
          selected.activeCount >= 0 &&
          selected.activeCount <= registry.count &&
          Array.isArray(selected.active) &&
          selected.active.length === selected.activeCount,
      );
      for (const row of selected.active) {
        demand(
          keys(row, ["id", "version", "bodyHash"]) &&
            typeof row.id === "string" &&
            /^[a-zA-Z0-9]{1,128}$/.test(row.id) &&
            !ids.has(row.id) &&
            Number.isSafeInteger(row.version) &&
            row.version > 0 &&
            typeof row.bodyHash === "string" &&
            /^[a-f0-9]{64}$/.test(row.bodyHash),
        );
        ids.add(row.id);
      }
    }
    return { configuration, runtimeOrigins, retention, registry };
  };
  onPhase("source");
  const tracked = clean(),
    before = snapshot("before");
  let diff, dryError;
  try {
    onPhase("dry_run");
    const result = cli([
      "deploy",
      "--dry-run",
      "--typecheck",
      "enable",
      "--codegen",
      "disable",
      "--verbose",
      "--skip-workos-check",
    ]);
    diff = summarizeDiff(`${result.stdout}\n${result.stderr}`);
  } catch {
    dryError = true;
  }
  const after = snapshot("after");
  onPhase("preservation");
  demand(clean() === tracked && JSON.stringify(after) === JSON.stringify(before));
  if (dryError) onPhase("dry_run");
  demand(!dryError);
  return {
    schema: "phase48-staging-parity.v1",
    sourceSha: env.EXPECTED_SOURCE_SHA,
    ciRunId: env.EXPECTED_CI_RUN_ID,
    target: "woozy-wren-368",
    dryRunPassed: true,
    applyRequested: false,
    preservedStateVerified: true,
    configurationUnchanged: true,
    registryUnchanged: true,
    protectedRetentionUnchanged: true,
    watchedConfigurationSha256: hash(JSON.stringify(before.configuration)),
    registrySha256: before.registry.sha256,
    protectedRetentionSha256: before.retention.sha256,
    globalSkillPrerequisites: {
      allSelectedHaveExactlyOneActive: before.registry.selected.every((s) => s.activeCount === 1),
      allSelectedActiveBodiesMatchSource: before.registry.selected.every(
        (s) => s.activeCount === 1 && s.active[0].bodyHash === sourceHashes.get(s.key),
      ),
      semanticProof: false,
      selected: before.registry.selected.map((s) => ({
        ...s,
        sourceBodyHash: sourceHashes.get(s.key),
        active: s.active.map((row) => ({
          ...row,
          matchesSource: row.bodyHash === sourceHashes.get(s.key),
        })),
      })),
    },
    ...diff,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let lastPhase = "entry";
  try {
    demand(process.argv.length === 2);
    console.log(
      JSON.stringify(
        await runParity(process.env, spawnSync, (phase) => {
          lastPhase = phase;
        }),
      ),
    );
  } catch {
    console.error(
      JSON.stringify({ success: false, phase: lastPhase, privateDiagnosticsSuppressed: true }),
    );
    process.exitCode = 1;
  }
}
