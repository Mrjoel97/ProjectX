#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_LABEL = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/;
const TOKEN_COUNTERS = new Set([
  "input_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
]);

function addReason(reasons, code) {
  if (!reasons.includes(code)) reasons.push(code);
}

function numericCounters(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (
    entries.length === 0 ||
    entries.some(
      ([key, count]) => !TOKEN_COUNTERS.has(key) || !Number.isSafeInteger(count) || count < 0,
    )
  )
    return null;
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}

function equalCounters(left, right) {
  const leftKeys = Object.keys(left ?? {});
  const rightKeys = Object.keys(right ?? {});
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => rightKeys.includes(key) && left[key] === right[key])
  );
}

function sameCounterKeys(left, right) {
  return (
    left !== null &&
    right !== null &&
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every((key) => Object.hasOwn(right, key))
  );
}

function subtractCounters(current, previous) {
  if (!sameCounterKeys(current, previous)) return null;
  const delta = {};
  for (const key of Object.keys(current)) {
    if (current[key] < previous[key]) return null;
    delta[key] = current[key] - previous[key];
  }
  return delta;
}

function safeUuid(value) {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

function safeLabel(value) {
  return typeof value === "string" && SAFE_LABEL.test(value) ? value : null;
}

function readSessionMetadata(payload, reasons) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    addReason(reasons, "invalid_session_metadata");
    return null;
  }
  const id = safeUuid(payload.id);
  const sessionId = safeUuid(payload.session_id);
  if (!id || !sessionId) addReason(reasons, "invalid_session_identifiers");
  const source = payload.source?.subagent?.thread_spawn;
  const threadSource = safeLabel(payload.thread_source);
  const isSubagent = threadSource === "subagent" && source && typeof source === "object";
  return {
    thread_id: id,
    session_id: sessionId,
    parent_thread_id: safeUuid(payload.parent_thread_id),
    agent_role: isSubagent ? safeLabel(source.agent_role) : null,
    thread_source: threadSource,
    provider: safeLabel(payload.model_provider),
  };
}

function readTurnContext(payload, reasons) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    addReason(reasons, "invalid_turn_context");
    return null;
  }
  const model = safeLabel(payload.model);
  const turnId = safeUuid(payload.turn_id);
  if (!model) addReason(reasons, "turn_model_missing_or_invalid");
  if (!turnId) addReason(reasons, "turn_identifier_missing_or_invalid");
  return {
    turn_id: turnId,
    root_turn_id: safeUuid(payload.root_turn_id),
    model,
    effort: safeLabel(payload.effort),
  };
}

function readTokenCountEvent(payload, reasons) {
  const info = payload?.info;
  const total = numericCounters(info?.total_token_usage);
  const last = numericCounters(info?.last_token_usage);
  if (!total) addReason(reasons, "cumulative_token_snapshot_missing_or_invalid");
  return { total, last };
}

function readTokenUsageRecord(payload, reasons) {
  const responseId = safeLabel(payload?.response_id);
  const turnId = safeUuid(payload?.turn_id);
  const usage = numericCounters(payload?.usage);
  const turn = numericCounters(payload?.turn_token_usage);
  const thread = numericCounters(payload?.thread_token_usage);
  if (!responseId) addReason(reasons, "response_identifier_missing_or_invalid");
  if (!usage) addReason(reasons, "response_token_usage_missing_or_invalid");
  if (!thread) addReason(reasons, "thread_token_snapshot_missing_or_invalid");
  return { response_id: responseId, turn_id: turnId, usage, turn, thread };
}

function analyzeResponseRecords(records, reasons) {
  const unique = new Map();
  let previousThread = null;
  for (const record of records) {
    if (record.thread) {
      if (
        previousThread &&
        (!sameCounterKeys(record.thread, previousThread) ||
          !subtractCounters(record.thread, previousThread))
      ) {
        addReason(reasons, "thread_token_counters_decreased_or_reset");
      }
      previousThread = record.thread;
    }
    if (!record.response_id || !record.usage) continue;
    const prior = unique.get(record.response_id);
    if (prior && !equalCounters(prior, record.usage)) {
      addReason(reasons, "duplicate_response_usage_conflict");
      continue;
    }
    if (!prior) unique.set(record.response_id, record.usage);
  }
  const values = [...unique.values()];
  if (values.length === 0) return { counters: null, responseTotal: null };
  const keys = values[0];
  const responseTotal = Object.fromEntries(Object.keys(keys).map((key) => [key, 0]));
  for (const value of values) {
    if (!sameCounterKeys(value, keys)) {
      addReason(reasons, "response_token_counter_schema_changed");
      return { counters: null, responseTotal: null };
    }
    for (const key of Object.keys(responseTotal)) responseTotal[key] += value[key];
  }
  if (previousThread && !equalCounters(responseTotal, previousThread))
    addReason(reasons, "response_and_thread_counters_disagree");
  return { counters: previousThread ?? responseTotal, responseTotal };
}

function createAccumulator({ role = "unspecified", expectedModel = null } = {}) {
  return {
    role,
    expectedModel,
    reasons: [],
    modelsByTurn: new Map(),
    unkeyedModels: new Set(),
    latestTokenSnapshot: null,
    priorTokenSnapshot: null,
    responseRecords: [],
    metadata: null,
    taskCompleteEvents: 0,
    malformedLines: 0,
    recordsSeen: 0,
  };
}

function consumeLine(state, line) {
  if (!line.trim()) return;
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    state.malformedLines += 1;
    addReason(state.reasons, "malformed_json_line");
    return;
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    state.malformedLines += 1;
    addReason(state.reasons, "invalid_record_shape");
    return;
  }
  state.recordsSeen += 1;
  const payload = record.payload;
  if (record.type === "session_meta") {
    const parsed = readSessionMetadata(payload, state.reasons);
    if (state.metadata && parsed && state.metadata.thread_id !== parsed.thread_id)
      addReason(state.reasons, "conflicting_session_metadata");
    state.metadata ??= parsed;
  } else if (record.type === "turn_context") {
    const turn = readTurnContext(payload, state.reasons);
    if (turn?.model) {
      if (turn.turn_id) {
        const models = state.modelsByTurn.get(turn.turn_id) ?? new Set();
        models.add(turn.model);
        state.modelsByTurn.set(turn.turn_id, models);
      } else {
        state.unkeyedModels.add(turn.model);
      }
    }
  } else if (record.type === "event_msg" && payload?.type === "token_count") {
    const snapshot = readTokenCountEvent(payload, state.reasons).total;
    if (snapshot) {
      if (state.priorTokenSnapshot && !sameCounterKeys(snapshot, state.priorTokenSnapshot)) {
        addReason(state.reasons, "token_counter_schema_changed");
      } else if (
        state.priorTokenSnapshot &&
        !subtractCounters(snapshot, state.priorTokenSnapshot)
      ) {
        addReason(state.reasons, "token_counters_decreased_or_reset");
      } else {
        state.priorTokenSnapshot = snapshot;
        state.latestTokenSnapshot = snapshot;
      }
    }
  } else if (record.type === "token_usage_record") {
    state.responseRecords.push(readTokenUsageRecord(payload, state.reasons));
  } else if (record.type === "event_msg" && payload?.type === "task_complete") {
    state.taskCompleteEvents += 1;
  }
}

function finalizeAccumulator(state) {
  const {
    role,
    expectedModel,
    reasons,
    modelsByTurn,
    unkeyedModels,
    latestTokenSnapshot,
    responseRecords,
    metadata,
    taskCompleteEvents,
    malformedLines,
    recordsSeen,
  } = state;
  if (recordsSeen === 0) addReason(reasons, "empty_input");
  if (!metadata) addReason(reasons, "session_metadata_missing");
  if (taskCompleteEvents === 0) addReason(reasons, "task_completion_missing");
  if (modelsByTurn.size === 0 && unkeyedModels.size === 0)
    addReason(reasons, "turn_model_metadata_missing");

  const modelForTurn = [...modelsByTurn.entries()].flatMap(([turnId, models]) =>
    [...models].map((model) => ({ turn_id: turnId, model })),
  );
  const models = [...new Set([...modelForTurn.map((turn) => turn.model), ...unkeyedModels])].sort();
  const expected = safeLabel(expectedModel);
  let expectedModelStatus = "not_checked";
  if (expectedModel !== null) {
    if (!expected) expectedModelStatus = "invalid_expectation";
    else if (models.length === 0) expectedModelStatus = "no_model";
    else if (models.some((model) => model !== expected)) expectedModelStatus = "mismatch";
    else expectedModelStatus = "match";
  }
  if ([...modelsByTurn.values()].some((set) => set.size > 1))
    addReason(reasons, "model_changed_within_turn");

  const cumulative = latestTokenSnapshot;
  const records = analyzeResponseRecords(responseRecords, reasons);
  if (cumulative && records.counters && !equalCounters(cumulative, records.counters))
    addReason(reasons, "token_sources_disagree");
  const usageCounters = cumulative ?? records.counters;
  const usageSource = cumulative
    ? "token_count_cumulative_snapshots"
    : records.counters
      ? "deduplicated_response_usage_with_thread_snapshot"
      : "missing";
  if (!usageCounters) addReason(reasons, "usage_missing");
  if (reasons.length > 0) {
    // Expected-model mismatches are a verification failure; preserve the observed counters while
    // keeping input/usage incompleteness explicit and machine-checkable.
  }

  const turnList = modelForTurn
    .sort((left, right) => left.turn_id.localeCompare(right.turn_id))
    .map((turn) => ({ turn_id: turn.turn_id, model: turn.model }));
  const attribution =
    models.length === 0
      ? "unknown_no_model"
      : models.length > 1 || reasons.includes("model_changed_within_turn")
        ? "unknown_multiple_model_epochs"
        : "single_host_reported_model_epoch";
  const isComplete = reasons.length === 0 && usageCounters !== null;
  return {
    role: safeLabel(role) ?? "invalid_role",
    rollout_id: metadata?.thread_id ?? null,
    session_id: metadata?.session_id ?? null,
    parent_thread_id: metadata?.parent_thread_id ?? null,
    agent_role: metadata?.agent_role ?? null,
    thread_source: metadata?.thread_source ?? null,
    provider: metadata?.provider ?? null,
    route_observation:
      metadata?.provider === "openai"
        ? "host_reported_native_openai_model_selection"
        : "provider_metadata_not_native_openai_or_missing",
    native_route_status: metadata?.provider === "openai" ? "host_provider_openai" : "unverified",
    provider_model_confirmed: false,
    models,
    turns: turnList,
    expected_model: expected,
    expected_model_status: expectedModelStatus,
    model_attribution: attribution,
    usage: {
      status: usageCounters ? (isComplete ? "complete" : "incomplete") : "missing",
      source: usageSource,
      scope: "rollout_lifetime_cumulative",
      counters: usageCounters,
      billed_cost: null,
    },
    complete: isComplete,
    malformed_records: malformedLines,
    completion_markers: taskCompleteEvents,
    reasons,
  };
}

export function summarizeRolloutText(text, options = {}) {
  const state = createAccumulator(options);
  for (const reason of options.additionalReasons ?? []) addReason(state.reasons, reason);
  if (typeof text !== "string" || text.length === 0) {
    addReason(state.reasons, "empty_input");
  } else {
    if (!text.endsWith("\n")) addReason(state.reasons, "missing_final_newline");
    for (const line of text.split(/\r?\n/)) consumeLine(state, line);
  }
  return finalizeAccumulator(state);
}

export function buildReport(sessions) {
  const seenRollouts = new Set();
  const seenRoles = new Set();
  for (const session of sessions) {
    if (!safeLabel(session.role)) throw new Error("invalid_role");
    if (seenRoles.has(session.role)) throw new Error("duplicate_role");
    seenRoles.add(session.role);
    if (!session.rollout_id) continue;
    if (seenRollouts.has(session.rollout_id)) throw new Error("duplicate_rollout_id");
    seenRollouts.add(session.rollout_id);
  }
  const roleById = new Map(sessions.map((session) => [session.rollout_id, session.role]));
  const outputSessions = sessions.map((session) => ({
    ...session,
    parent_role: session.parent_thread_id ? (roleById.get(session.parent_thread_id) ?? null) : null,
  }));
  const expectedFailure = outputSessions.some(
    (session) =>
      !["not_checked", "match"].includes(session.expected_model_status) ||
      session.native_route_status !== "host_provider_openai",
  );
  return {
    schema_version: 1,
    report_type: "codex_rollout_metadata",
    complete: outputSessions.every((session) => session.complete) && !expectedFailure,
    route_verification: "host_reported_selection_only",
    sessions: outputSessions,
  };
}

async function finalByteIsNewline(path, size) {
  if (size === 0) return false;
  const handle = await open(path, "r");
  try {
    const last = Buffer.alloc(1);
    await handle.read(last, 0, 1, size - 1);
    return last[0] === 10;
  } finally {
    await handle.close();
  }
}

export async function readRolloutFile(path, options = {}) {
  let size;
  let finalNewline;
  let initialStat;
  try {
    initialStat = await stat(path);
    size = initialStat.size;
    finalNewline = await finalByteIsNewline(path, size);
  } catch {
    return summarizeRolloutText("", optionsWithReason(options, "input_unreadable"));
  }
  const state = createAccumulator(options);
  for (const reason of options.additionalReasons ?? []) addReason(state.reasons, reason);
  const lines = readline.createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of lines) consumeLine(state, line);
  } catch {
    addReason(state.reasons, "input_read_failed");
  }
  try {
    const finalStat = await stat(path);
    if (finalStat.size !== initialStat.size || finalStat.mtimeMs !== initialStat.mtimeMs)
      addReason(state.reasons, "input_changed_during_read");
  } catch {
    addReason(state.reasons, "input_stat_failed_after_read");
  }
  if (!finalNewline) addReason(state.reasons, "missing_final_newline");
  return finalizeAccumulator(state);
}

function optionsWithReason(options, reason) {
  return { ...options, additionalReasons: [reason] };
}

function reportFailures(report) {
  return (
    report.sessions.some(
      (session) =>
        !session.complete || !["not_checked", "match"].includes(session.expected_model_status),
    ) || !report.complete
  );
}

function validateSnapshot(report) {
  if (
    report?.schema_version !== 1 ||
    report.report_type !== "codex_rollout_metadata" ||
    !Array.isArray(report.sessions) ||
    report.sessions.length === 0
  )
    throw new Error("invalid_snapshot_schema");
  if (report.complete !== true || report.route_verification !== "host_reported_selection_only")
    throw new Error("incomplete_snapshot");
  const seen = new Set();
  const roles = new Set();
  for (const session of report.sessions) {
    if (!session || !safeLabel(session.role)) throw new Error("invalid_role");
    if (roles.has(session.role)) throw new Error("duplicate_role");
    roles.add(session.role);
    if (!safeUuid(session.rollout_id) || seen.has(session.rollout_id))
      throw new Error("duplicate_or_invalid_rollout_id");
    if (!safeUuid(session.session_id)) throw new Error("invalid_session_id");
    if (session.parent_thread_id !== null && !safeUuid(session.parent_thread_id))
      throw new Error("invalid_parent_thread_id");
    if (session.provider !== "openai" || session.native_route_status !== "host_provider_openai")
      throw new Error("native_provider_unverified");
    if (!session.complete || !["not_checked", "match"].includes(session.expected_model_status))
      throw new Error("incomplete_snapshot");
    if (
      !Array.isArray(session.models) ||
      session.models.some((model) => !safeLabel(model)) ||
      ![
        "unknown_no_model",
        "unknown_multiple_model_epochs",
        "single_host_reported_model_epoch",
      ].includes(session.model_attribution)
    )
      throw new Error("invalid_model_attribution");
    if (
      (session.expected_model_status === "not_checked" && session.expected_model !== null) ||
      (session.expected_model_status === "match" &&
        (!safeLabel(session.expected_model) ||
          session.models.length === 0 ||
          session.models.some((model) => model !== session.expected_model)))
    )
      throw new Error("invalid_expected_model_status");
    if (
      session.usage?.status !== "complete" ||
      session.usage?.scope !== "rollout_lifetime_cumulative"
    )
      throw new Error("incomplete_snapshot");
    const counters = numericCounters(session.usage?.counters);
    if (!counters) throw new Error("invalid_token_counters");
    seen.add(session.rollout_id);
  }
}

export function compareReports(before, after) {
  validateSnapshot(before);
  validateSnapshot(after);
  const afterByRole = new Map(after.sessions.map((session) => [session.role, session]));
  if (
    afterByRole.size !== after.sessions.length ||
    before.sessions.length !== after.sessions.length
  )
    throw new Error("session_set_mismatch");
  const deltas = [];
  for (const older of before.sessions) {
    const newer = afterByRole.get(older.role);
    if (!newer) throw new Error("session_set_mismatch");
    if (older.rollout_id !== newer.rollout_id || older.session_id !== newer.session_id)
      throw new Error("session_identity_mismatch");
    if (!older.complete || !newer.complete) throw new Error("incomplete_snapshot");
    const oldCounters = older.usage?.counters;
    const newCounters = newer.usage?.counters;
    if (!sameCounterKeys(oldCounters, newCounters)) throw new Error("counter_schema_mismatch");
    const delta = subtractCounters(newCounters, oldCounters);
    if (!delta) throw new Error("counter_decrease_or_reset");
    const sameModels = equalStringArrays(older.models, newer.models);
    deltas.push({
      role: older.role,
      rollout_id: older.rollout_id,
      counters: delta,
      models: sameModels ? older.models : null,
      model_attribution:
        older.model_attribution === "unknown_multiple_model_epochs" ||
        newer.model_attribution === "unknown_multiple_model_epochs"
          ? "unknown_multiple_model_epochs"
          : sameModels && older.model_attribution === newer.model_attribution
            ? older.model_attribution
            : "unknown_model_epochs_changed_between_snapshots",
    });
  }
  return {
    schema_version: 1,
    report_type: "codex_rollout_usage_interval",
    status: "complete",
    billing_cost: null,
    deltas,
  };
}

function equalStringArrays(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function createDispatchPlan(policy, tier) {
  const modelAllowlist = new Set(["gpt-6-sol", "gpt-6-luna", "gpt-5.6-terra"]);
  if (
    policy?.schemaVersion !== 1 ||
    policy.providerPolicy !== "current-openai-account-only" ||
    policy.externalRouterAllowed !== false ||
    policy.externalProviderKeysAllowed !== false ||
    policy.dispatch?.agentType !== "worker" ||
    policy.dispatch?.forkTurns !== "none" ||
    policy.dispatch?.explicitModelRequired !== true ||
    policy.dispatch?.verifyModelAdvertisedByHost !== true ||
    policy.dispatch?.silentFallbackAllowed !== false ||
    policy.dispatch?.recursiveDelegationAllowed !== false
  )
    throw new Error("routing_policy_not_native_safe");
  const selected = policy.workers?.[tier];
  if (!selected || !modelAllowlist.has(selected.model) || !safeLabel(selected.reasoningEffort))
    throw new Error("tier_or_model_not_supported");
  return {
    schema_version: 1,
    report_type: "native_worker_dispatch_plan",
    status: "plan_only_not_executed",
    provider_scope: "current_openai_account_only",
    external_router: false,
    external_provider_keys: false,
    tier,
    spawn_parameters: {
      agent_type: policy.dispatch.agentType,
      model: selected.model,
      reasoning_effort: selected.reasoningEffort,
      fork_turns: policy.dispatch.forkTurns,
    },
    recursion_allowed: false,
  };
}

function assignment(value) {
  const index = value.indexOf("=");
  if (index <= 0 || index === value.length - 1) return null;
  return [value.slice(0, index), value.slice(index + 1)];
}

export function parseArgs(argv) {
  const [command, ...args] = argv;
  if (command === "report") {
    const inputs = [];
    const expected = new Map();
    for (let i = 0; i < args.length; i++) {
      const flag = args[i];
      const value = args[++i];
      if (flag === "--session" && value) {
        const pair = assignment(value);
        if (!pair || !safeLabel(pair[0])) return { error: "invalid_session_argument" };
        inputs.push({ role: pair[0], path: pair[1] });
      } else if (flag === "--expect-model" && value) {
        const pair = assignment(value);
        if (!pair || !safeLabel(pair[0]) || !safeLabel(pair[1]) || expected.has(pair[0]))
          return { error: "invalid_expected_model_argument" };
        expected.set(pair[0], pair[1]);
      } else {
        return { error: "invalid_arguments" };
      }
    }
    if (inputs.length === 0) return { error: "session_required" };
    const inputRoles = new Set(inputs.map((input) => input.role));
    if ([...expected.keys()].some((role) => !inputRoles.has(role)))
      return { error: "expected_model_role_not_selected" };
    return { command, inputs, expected };
  }
  if (command === "compare") {
    const values = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!["--before", "--after"].includes(args[i]) || !args[i + 1] || values[args[i]])
        return { error: "invalid_compare_arguments" };
      values[args[i]] = args[i + 1];
    }
    if (!values["--before"] || !values["--after"]) return { error: "compare_snapshots_required" };
    return { command, beforePath: values["--before"], afterPath: values["--after"] };
  }
  if (command === "dispatch") {
    const values = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!["--policy", "--tier"].includes(args[i]) || !args[i + 1] || values[args[i]])
        return { error: "invalid_dispatch_arguments" };
      values[args[i]] = args[i + 1];
    }
    if (!values["--policy"] || !values["--tier"] || !SAFE_LABEL.test(values["--tier"]))
      return { error: "dispatch_policy_and_tier_required" };
    return { command, policyPath: values["--policy"], tier: values["--tier"] };
  }
  return { error: "command_required" };
}

async function readSummary(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("snapshot_unreadable_or_invalid");
  }
}

async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error) return { output: { error: { code: parsed.error } }, failed: true };
  if (parsed.command === "compare") {
    try {
      const result = compareReports(
        await readSummary(parsed.beforePath),
        await readSummary(parsed.afterPath),
      );
      return { output: result, failed: false };
    } catch (error) {
      return {
        output: { error: { code: error instanceof Error ? error.message : "comparison_failed" } },
        failed: true,
      };
    }
  }
  if (parsed.command === "dispatch") {
    let policy;
    try {
      policy = JSON.parse(await readFile(parsed.policyPath, "utf8"));
    } catch {
      return {
        output: { error: { code: "routing_policy_unreadable_or_invalid" } },
        failed: true,
      };
    }
    try {
      return { output: createDispatchPlan(policy, parsed.tier), failed: false };
    } catch (error) {
      return {
        output: {
          error: { code: error instanceof Error ? error.message : "dispatch_plan_failed" },
        },
        failed: true,
      };
    }
  }
  const sessions = [];
  for (const input of parsed.inputs) {
    sessions.push(
      await readRolloutFile(input.path, {
        role: input.role,
        expectedModel: parsed.expected.get(input.role) ?? null,
      }),
    );
  }
  try {
    const report = buildReport(sessions);
    return { output: report, failed: reportFailures(report) };
  } catch (error) {
    return {
      output: { error: { code: error instanceof Error ? error.message : "report_failed" } },
      failed: true,
    };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { output, failed } = await main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (failed) process.exitCode = 1;
}
