#!/usr/bin/env node
// Opt-in development-only DeepSeek worker. Never imports application runtime or writes a key.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const MODEL = "deepseek/deepseek-v4-flash-0731";
export const PROVIDER = "pikar_dev_openrouter";
export const KEY_NAME_IN_FILE = "OPEN_ROUTER_API_KEY";
const KEY_NAME_FOR_CODEX = "OPENROUTER_API_KEY";
const BASE_URL = "https://openrouter.ai/api/v1";
const POLICY_PATH = resolve(ROOT, "docs/agent-work/pikar-flash-routing.json");
const QUICK_OUTPUT_DIR = resolve(ROOT, "docs/agent-work/flash-output");
const SAFE_ENV_NAMES = [
  "PATH",
  "Path",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "COMSPEC",
  "PATHEXT",
  "USERNAME",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "CommonProgramFiles",
  "PSModulePath",
];

export function readExistingKey(envText) {
  const lines = envText.split(/\r?\n/);
  const matches = lines.filter((line) => /^\s*OPEN_ROUTER_API_KEY\s*=/.test(line));
  if (matches.length !== 1) throw new Error("app_openrouter_key_missing_or_duplicated");
  const raw = matches[0].slice(matches[0].indexOf("=") + 1).trim();
  const key = raw.replace(/^(["'])(.*)\1$/, "$2");
  if (!/^sk-or-[A-Za-z0-9_-]{20,}$/.test(key)) throw new Error("app_openrouter_key_invalid_format");
  return key;
}

export function validateFlashPolicy(policy) {
  if (
    policy?.schemaVersion !== 1 ||
    policy.scope !== "development-only" ||
    policy.status !== "opt-in" ||
    policy.root !== "astra-planning-and-batched-review" ||
    policy.worker?.provider !== "openrouter" ||
    policy.worker?.transport !== "responses" ||
    policy.worker?.model !== MODEL ||
    policy.worker?.entrypoint !== "scripts/dev-orchestration/flash-worker.mjs" ||
    policy.worker?.keySource !== `.env:${KEY_NAME_IN_FILE}` ||
    policy.worker?.keyHandling !== "process-memory-only" ||
    policy.worker?.defaultMode !== "read-only" ||
    policy.worker?.writeModeRequiresExplicitFlag !== true ||
    policy.worker?.providerRetries !== 0 ||
    policy.fallback !== "no-silent-fallback-to-native-or-another-external-model" ||
    policy.evidence?.probeBeforeClaimingRoute !== true ||
    policy.evidence?.usageCountersRequired !== true ||
    policy.evidence?.rootReviewRequired !== true ||
    policy.application?.runtimeModelRoutingChanged !== false ||
    policy.application?.openRouterDeploymentVariableChanged !== false ||
    policy.application?.productDependencyAdded !== false
  )
    throw new Error("flash_policy_not_dev_safe");
  return policy;
}

export function isolatedEnvironment(parent, key) {
  const child = {};
  for (const name of SAFE_ENV_NAMES) if (parent[name]) child[name] = parent[name];
  child[KEY_NAME_FOR_CODEX] = key;
  child.NO_COLOR = "1";
  return child;
}

export function codexArgs({ mode = "read-only", workspace = ROOT } = {}) {
  if (!["read-only", "workspace-write"].includes(mode)) throw new Error("invalid_worker_mode");
  if (resolve(workspace) !== resolve(ROOT))
    throw new Error("worker_workspace_must_be_project_root");
  const config = [
    `model_provider="${PROVIDER}"`,
    `model_providers.${PROVIDER}.name="Pikar Dev OpenRouter"`,
    `model_providers.${PROVIDER}.base_url="${BASE_URL}"`,
    `model_providers.${PROVIDER}.env_key="${KEY_NAME_FOR_CODEX}"`,
    `model_providers.${PROVIDER}.wire_api="responses"`,
    `model_providers.${PROVIDER}.request_max_retries=0`,
    `model_providers.${PROVIDER}.stream_max_retries=0`,
    "shell_environment_policy.ignore_default_excludes=false",
    "sandbox_workspace_write.network_access=false",
  ];
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--strict-config",
    "--skip-git-repo-check",
    "--sandbox",
    mode,
    "--model",
    MODEL,
    "--cd",
    resolve(workspace),
    ...config.flatMap((value) => ["--config", value]),
    "-",
  ];
}

function safeText(value) {
  return String(value ?? "")
    .replace(/sk-or-[A-Za-z0-9_-]+/g, "[REDACTED_KEY]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .slice(0, 300);
}

export function summarizeCodexJsonl(output, { probe = false } = {}) {
  let threadId = null;
  let completed = false;
  let failed = false;
  let usage = null;
  let probeMarker = false;
  const types = new Set();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof event.type !== "string") continue;
    types.add(event.type);
    if (event.type === "thread.started" && typeof event.thread_id === "string")
      threadId = event.thread_id;
    if (event.type === "turn.completed") {
      completed = true;
      const value = event.usage;
      if (value && Number.isFinite(value.input_tokens) && Number.isFinite(value.output_tokens))
        usage = {
          input_tokens: value.input_tokens,
          cached_input_tokens: Number.isFinite(value.cached_input_tokens)
            ? value.cached_input_tokens
            : null,
          output_tokens: value.output_tokens,
        };
    }
    if (event.type === "turn.failed" || event.type === "error") failed = true;
    if (probe && event.type === "item.completed" && event.item?.type === "agent_message")
      probeMarker ||= event.item.text?.trim() === "PIKAR_FLASH_ROUTE_OK";
  }
  return {
    thread_id: threadId,
    completed,
    failed,
    usage,
    probe_marker: probe ? probeMarker : null,
    event_types: [...types].sort(),
  };
}

function cliPath(env) {
  const path = resolve(env.APPDATA ?? "", "npm/node_modules/@openai/codex/bin/codex.js");
  if (!env.APPDATA || !existsSync(path)) throw new Error("codex_cli_not_found");
  return path;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command === "plan" && rest.length === 0) return { command };
  if (command === "probe" && rest.length === 0) return { command };
  if (command === "quick-probe" && rest.length === 0) return { command };
  if (command === "quick" && rest.length === 4 && rest[0] === "--brief" && rest[2] === "--out")
    return { command, brief: rest[1], out: rest[3] };
  if (command === "run" && rest.length >= 2 && rest[0] === "--brief") {
    const brief = rest[1];
    const write = rest.length === 3 && rest[2] === "--write";
    if (rest.length === 2 || write) return { command, brief, write };
  }
  throw new Error(
    "usage: flash-worker.mjs plan | quick-probe | quick --brief <file> --out <name.md> | probe | run --brief <file> [--write]",
  );
}

function taskPrompt(brief, write) {
  if (/sk-or-|OPEN_ROUTER_API_KEY\s*=|OPENROUTER_API_KEY\s*=/.test(brief))
    throw new Error("brief_contains_secret_marker");
  return (
    `You are one development-only Pikar AI worker. The Astra root owns planning and final review.\n` +
    `Do not read .env files, secrets, credentials, customer records, or production data; do not modify application OpenRouter configuration.\n` +
    `Do not spawn agents or invoke paid providers. Preserve all unrelated edits in this dirty shared workspace.\n` +
    `Mode: ${write ? "bounded implementation in the named files only" : "read-only analysis"}.\n` +
    `Report files changed, tests, unresolved risks, and stop conditions.\n\nTask brief:\n${brief}`
  );
}

export function quickRequestBody(input, { probe = false } = {}) {
  if (typeof input !== "string" || input.length > 20_000) throw new Error("quick_input_too_large");
  return {
    model: MODEL,
    instructions: probe
      ? "Reply with exactly PIKAR_FLASH_ROUTE_OK. No other text."
      : "You are a development-only worker. Complete the bounded task from the supplied brief. Do not invent test results or touch app runtime. Return a concise proposal for Astra root review.",
    input,
    max_output_tokens: probe ? 256 : 2_048,
    store: false,
  };
}

export function summarizeOpenRouterResponse(body, { probe = false } = {}) {
  const output =
    typeof body?.output_text === "string"
      ? body.output_text
      : (body?.output ?? [])
          .flatMap((item) => item?.content ?? [])
          .filter((part) => part?.type === "output_text" && typeof part.text === "string")
          .map((part) => part.text)
          .join("");
  const counters = body?.usage;
  const usage =
    Number.isFinite(counters?.input_tokens) && Number.isFinite(counters?.output_tokens)
      ? {
          input_tokens: counters.input_tokens,
          cached_input_tokens: Number.isFinite(counters.input_tokens_details?.cached_tokens)
            ? counters.input_tokens_details.cached_tokens
            : null,
          output_tokens: counters.output_tokens,
          reasoning_tokens: Number.isFinite(counters.output_tokens_details?.reasoning_tokens)
            ? counters.output_tokens_details.reasoning_tokens
            : null,
        }
      : null;
  const metadata = body?.openrouter_metadata;
  const provider =
    typeof metadata?.provider_name === "string"
      ? metadata.provider_name
      : typeof metadata?.provider === "string"
        ? metadata.provider
        : null;
  return {
    response_id: typeof body?.id === "string" ? body.id : null,
    model_reported: typeof body?.model === "string" ? body.model : null,
    provider_reported: provider,
    status: body?.status === "completed" ? "completed" : "incomplete",
    response_status: typeof body?.status === "string" ? body.status : null,
    output_chars: output.length,
    usage,
    output,
    probe_marker: probe ? output.trim() === "PIKAR_FLASH_ROUTE_OK" : null,
  };
}

async function quickCall(parsed, key) {
  const probe = parsed.command === "quick-probe";
  const briefPath = probe ? null : resolve(ROOT, parsed.brief);
  if (briefPath && !briefPath.startsWith(`${resolve(ROOT)}\\`))
    throw new Error("brief_outside_project");
  const brief = probe ? "Return the route marker." : readFileSync(briefPath, "utf8");
  if (/sk-or-|OPEN_ROUTER_API_KEY\s*=|OPENROUTER_API_KEY\s*=/.test(brief))
    throw new Error("brief_contains_secret_marker");
  const outputPath = probe ? null : resolve(QUICK_OUTPUT_DIR, parsed.out);
  if (
    outputPath &&
    (!outputPath.startsWith(`${QUICK_OUTPUT_DIR}\\`) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/.test(parsed.out))
  )
    throw new Error("invalid_quick_output_path");
  const response = await fetch(`${BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-OpenRouter-Metadata": "enabled",
      "X-Title": "Pikar Dev Flash",
    },
    body: JSON.stringify(quickRequestBody(brief, { probe })),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok)
    return {
      status: "failed",
      command: parsed.command,
      route_observed: false,
      http_status: response.status,
      error: "openrouter_response_not_ok",
    };
  const result = summarizeOpenRouterResponse(await response.json(), { probe });
  const ok =
    result.status === "completed" &&
    result.model_reported === MODEL &&
    result.usage !== null &&
    result.output.trim().length > 0 &&
    (!probe || result.probe_marker);
  if (ok && outputPath) {
    mkdirSync(QUICK_OUTPUT_DIR, { recursive: true });
    writeFileSync(outputPath, result.output.replaceAll(key, "[REDACTED_KEY]"), { flag: "wx" });
  }
  return {
    status: ok ? "completed" : "failed",
    scope: "development_only",
    command: parsed.command,
    model_requested: MODEL,
    model_reported: result.model_reported,
    provider_reported: result.provider_reported,
    route_observed: ok,
    response_id: result.response_id,
    usage: result.usage,
    usage_status: result.usage ? "observed_openrouter_response" : "missing",
    response_status: result.response_status,
    output_chars: result.output_chars,
    probe_marker: result.probe_marker,
    output_file: ok ? outputPath : null,
    http_status: response.status,
  };
}

export function main(argv = process.argv.slice(2), parent = process.env) {
  const parsed = parseArgs(argv);
  validateFlashPolicy(JSON.parse(readFileSync(POLICY_PATH, "utf8")));
  if (parsed.command === "plan")
    return {
      status: "plan_only_not_executed",
      scope: "development_only",
      model: MODEL,
      provider: "openrouter_responses",
      key_source: ".env:OPEN_ROUTER_API_KEY",
      app_configuration_changed: false,
      default_mode: "read-only",
      retry_count: 0,
    };
  const key = readExistingKey(readFileSync(resolve(ROOT, ".env"), "utf8"));
  if (parsed.command === "quick" || parsed.command === "quick-probe") return quickCall(parsed, key);
  const write = parsed.command === "run" && parsed.write;
  const mode = write ? "workspace-write" : "read-only";
  const briefPath = parsed.command === "run" ? resolve(ROOT, parsed.brief) : null;
  if (briefPath && !briefPath.startsWith(`${resolve(ROOT)}\\`) && briefPath !== resolve(ROOT))
    throw new Error("brief_outside_project");
  const brief = briefPath ? readFileSync(briefPath, "utf8") : null;
  const prompt =
    parsed.command === "probe"
      ? "Return exactly PIKAR_FLASH_ROUTE_OK and nothing else. Do not use tools."
      : taskPrompt(brief, write);
  const child = spawnSync(process.execPath, [cliPath(parent), ...codexArgs({ mode })], {
    cwd: ROOT,
    env: isolatedEnvironment(parent, key),
    input: prompt,
    encoding: "utf8",
    timeout: parsed.command === "probe" ? 120_000 : 1_800_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  const result = summarizeCodexJsonl(child.stdout ?? "", { probe: parsed.command === "probe" });
  const ok =
    child.status === 0 &&
    !child.error &&
    result.completed &&
    !result.failed &&
    (parsed.command !== "probe" || result.probe_marker);
  return {
    status: ok ? "completed" : "failed",
    scope: "development_only",
    model: MODEL,
    provider_config: "openrouter_responses_only",
    route_observed: ok,
    command: parsed.command,
    mode,
    usage: result.usage,
    usage_status: result.usage ? "observed_codex_turn" : "missing",
    thread_id: result.thread_id,
    probe_marker: result.probe_marker,
    exit_code: child.status,
    error: child.error ? safeText(child.error.message) : null,
    stderr_summary: ok
      ? null
      : safeText((child.stderr ?? "").split(/\r?\n/).filter(Boolean).at(-1)),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === "failed") process.exitCode = 1;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ status: "failed", error: safeText(error?.message) })}\n`,
    );
    process.exitCode = 1;
  }
}
