import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildReport,
  compareReports,
  createDispatchPlan,
  parseArgs,
  summarizeRolloutText,
} from "./report.mjs";

const threadId = "12345678-1234-4234-8234-123456789abc";
const sessionId = "22345678-1234-4234-8234-123456789abc";
const turnId = "32345678-1234-4234-8234-123456789abc";

function fixture({
  model = "gpt-6-luna",
  counters = { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
  tail = "\n",
} = {}) {
  const rows = [
    {
      type: "session_meta",
      payload: {
        id: threadId,
        session_id: sessionId,
        thread_source: "user",
        model_provider: "openai",
      },
    },
    { type: "turn_context", payload: { turn_id: turnId, model, effort: "high" } },
    {
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { total_token_usage: counters, last_token_usage: counters },
      },
    },
    { type: "event_msg", payload: { type: "task_complete" } },
  ];
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}${tail}`;
}

test("cumulative snapshots are not summed and repeated snapshots are harmless", () => {
  const first = fixture();
  const repeat = JSON.parse(first.split("\n")[2]);
  const text = `${first}${JSON.stringify(repeat)}\n`;
  const session = summarizeRolloutText(text, { role: "worker", expectedModel: "gpt-6-luna" });
  assert.deepEqual(session.usage.counters, {
    input_tokens: 10,
    output_tokens: 2,
    total_tokens: 12,
  });
  assert.equal(session.expected_model_status, "match");
  assert.equal(session.complete, true);
});

test("privacy sentinel in message/tool data never appears in serialized output", () => {
  const sentinel = "PRIVATE_PROMPT_AND_TOOL_ARGS_SENTINEL";
  const text = `${fixture()}${JSON.stringify({ type: "response_item", payload: { message: sentinel, tool_args: sentinel } })}\n`;
  const output = JSON.stringify(buildReport([summarizeRolloutText(text, { role: "worker" })]));
  assert.equal(output.includes(sentinel), false);
  assert.equal(output.includes("message"), false);
});

test("numeric counter keys are allowlisted and unknown keys never enter output", () => {
  const sentinel = "PRIVATE_COUNTER_SENTINEL";
  const session = summarizeRolloutText(fixture({ counters: { input_tokens: 3, [sentinel]: 9 } }), {
    role: "worker",
  });
  assert.equal(session.usage.status, "missing");
  assert.equal(JSON.stringify(session).includes(sentinel), false);
});

test("missing usage is missing, not zero", () => {
  const text = `${fixture()
    .split("\n")
    .filter((line) => !line.includes('"token_count"'))
    .join("\n")}\n`;
  const session = summarizeRolloutText(text, { role: "worker" });
  assert.equal(session.usage.status, "missing");
  assert.equal(session.usage.counters, null);
  assert.ok(session.reasons.includes("usage_missing"));
});

test("malformed and truncated inputs are visibly incomplete without exposing bytes", () => {
  const malformed = `${fixture()}{"payload":"DO_NOT_ECHO"`;
  const session = summarizeRolloutText(malformed, { role: "worker" });
  assert.equal(session.complete, false);
  assert.equal(session.malformed_records, 1);
  assert.ok(session.reasons.includes("malformed_json_line"));
  assert.ok(session.reasons.includes("missing_final_newline"));
  assert.equal(JSON.stringify(session).includes("DO_NOT_ECHO"), false);
});

test("expected host model rejects mismatch and missing model", () => {
  const mismatch = summarizeRolloutText(fixture({ model: "gpt-6-sol" }), {
    role: "worker",
    expectedModel: "gpt-6-luna",
  });
  assert.equal(mismatch.expected_model_status, "mismatch");
  const noModelText = fixture().replace(/\{"type":"turn_context"[^\n]*\}\n/, "");
  const missing = summarizeRolloutText(noModelText, {
    role: "worker",
    expectedModel: "gpt-6-luna",
  });
  assert.equal(missing.expected_model_status, "no_model");
  assert.equal(buildReport([mismatch]).complete, false);
  assert.equal(missing.provider_model_confirmed, false);
});

test("multiple model epochs make attribution unknown", () => {
  const switched = `${fixture()}${JSON.stringify({ type: "turn_context", payload: { turn_id: "52345678-1234-4234-8234-123456789abc", model: "gpt-6-sol", effort: "high" } })}\n`;
  const session = summarizeRolloutText(switched, { role: "worker" });
  assert.deepEqual(session.models, ["gpt-6-luna", "gpt-6-sol"]);
  assert.equal(session.model_attribution, "unknown_multiple_model_epochs");
});

test("interval subtraction requires same session and nondecreasing matching counters", () => {
  const old = summarizeRolloutText(fixture({ counters: { input_tokens: 10, output_tokens: 2 } }), {
    role: "root",
  });
  const next = summarizeRolloutText(fixture({ counters: { input_tokens: 17, output_tokens: 6 } }), {
    role: "root",
  });
  assert.deepEqual(compareReports(buildReport([old]), buildReport([next])).deltas[0].counters, {
    input_tokens: 7,
    output_tokens: 4,
  });
  const reset = summarizeRolloutText(fixture({ counters: { input_tokens: 9, output_tokens: 2 } }), {
    role: "root",
  });
  assert.throws(
    () => compareReports(buildReport([old]), buildReport([reset])),
    /counter_decrease_or_reset/,
  );
  const otherSession = summarizeRolloutText(
    fixture().replace(sessionId, "42345678-1234-4234-8234-123456789abc"),
    { role: "root" },
  );
  assert.throws(
    () => compareReports(buildReport([old]), buildReport([otherSession])),
    /session_identity_mismatch/,
  );
  assert.equal(
    compareReports(buildReport([old]), buildReport([next])).deltas[0].model_attribution,
    "single_host_reported_model_epoch",
  );
});

test("interval output preserves unknown multi-model attribution", () => {
  const switched = (inputTokens) =>
    `${fixture({ counters: { input_tokens: inputTokens, output_tokens: 2 } })}${JSON.stringify({
      type: "turn_context",
      payload: {
        turn_id: "52345678-1234-4234-8234-123456789abc",
        model: "gpt-6-sol",
        effort: "high",
      },
    })}\n`;
  const before = summarizeRolloutText(switched(10), { role: "worker" });
  const after = summarizeRolloutText(switched(15), { role: "worker" });
  const delta = compareReports(buildReport([before]), buildReport([after])).deltas[0];
  assert.equal(delta.model_attribution, "unknown_multiple_model_epochs");
  assert.deepEqual(delta.models, ["gpt-6-luna", "gpt-6-sol"]);
});

function usageRecord(responseId, usage, thread) {
  return {
    type: "token_usage_record",
    payload: {
      response_id: responseId,
      turn_id: turnId,
      usage,
      turn_token_usage: usage,
      thread_token_usage: thread,
    },
  };
}

function withResponseRecords(records) {
  const base = fixture()
    .split("\n")
    .filter((line) => !line.includes('"token_count"') && line.length > 0);
  return `${[...base, ...records.map(JSON.stringify)].join("\n")}\n`;
}

test("per-response records deduplicate repeated response IDs before reconciliation", () => {
  const one = { input_tokens: 5, output_tokens: 1, total_tokens: 6 };
  const two = { input_tokens: 10, output_tokens: 2, total_tokens: 12 };
  const session = summarizeRolloutText(
    withResponseRecords([
      usageRecord("response-1", one, one),
      usageRecord("response-1", one, one),
      usageRecord("response-2", one, two),
    ]),
    { role: "worker" },
  );
  assert.deepEqual(session.usage.counters, two);
  assert.equal(session.complete, true);
});

test("conflicting repeated response IDs and counter-source disagreement are incomplete", () => {
  const one = { input_tokens: 5, output_tokens: 1, total_tokens: 6 };
  const two = { input_tokens: 10, output_tokens: 2, total_tokens: 12 };
  const conflicting = summarizeRolloutText(
    withResponseRecords([usageRecord("response-1", one, one), usageRecord("response-1", two, two)]),
    { role: "worker" },
  );
  assert.ok(conflicting.reasons.includes("duplicate_response_usage_conflict"));
  assert.equal(conflicting.complete, false);

  const disagreement = summarizeRolloutText(
    withResponseRecords([usageRecord("response-1", one, one)]),
    { role: "worker" },
  );
  // Add a separate cumulative snapshot which is valid but differs from response/thread totals.
  const cumulative = JSON.stringify({
    type: "event_msg",
    payload: { type: "token_count", info: { total_token_usage: two, last_token_usage: two } },
  });
  const mixed = summarizeRolloutText(
    `${withResponseRecords([usageRecord("response-1", one, one)])}${cumulative}\n`,
    { role: "worker" },
  );
  assert.ok(mixed.reasons.includes("token_sources_disagree"));
  assert.equal(disagreement.complete, true);
});

test("report rejects repeated input rollout ids", () => {
  const session = summarizeRolloutText(fixture(), { role: "root" });
  const secondRole = { ...session, role: "worker" };
  assert.throws(() => buildReport([session, secondRole]), /duplicate_rollout_id/);
});

test("comparison rejects forged incomplete reports, bad counters, and non-native providers", () => {
  const session = summarizeRolloutText(fixture(), { role: "root" });
  const valid = buildReport([session]);
  assert.throws(() => compareReports({ ...valid, complete: false }, valid), /incomplete_snapshot/);
  const badCounter = structuredClone(valid);
  badCounter.sessions[0].usage.counters = { input_tokens: 1, PRIVATE_COUNTER_SENTINEL: 2 };
  assert.throws(() => compareReports(badCounter, valid), /invalid_token_counters/);
  const foreign = structuredClone(valid);
  foreign.sessions[0].provider = "third-party";
  assert.throws(() => compareReports(foreign, valid), /native_provider_unverified/);
  const invalidId = structuredClone(valid);
  invalidId.sessions[0].session_id = "not-a-uuid";
  assert.throws(() => compareReports(invalidId, valid), /invalid_session_id/);
});

test("expected-model options cannot name an unselected role", () => {
  const parsed = parseArgs([
    "report",
    "--session",
    "root=rollout.jsonl",
    "--expect-model",
    "orphan=gpt-6-luna",
  ]);
  assert.equal(parsed.error, "expected_model_role_not_selected");
});

test("matching expected model cannot make a missing provider native-verified", () => {
  const session = summarizeRolloutText(
    fixture().replace('"model_provider":"openai"', '"model_provider":"foreign"'),
    { role: "worker", expectedModel: "gpt-6-luna" },
  );
  assert.equal(session.expected_model_status, "match");
  assert.equal(session.native_route_status, "unverified");
  assert.equal(buildReport([session]).complete, false);
});

test("routing policy is native-only and yields plan-only explicit dispatch parameters", async () => {
  const policy = JSON.parse(
    await readFile(resolve("docs/agent-work/pikar-build-routing.json"), "utf8"),
  );
  const plan = createDispatchPlan(policy, "routine");
  assert.equal(plan.status, "plan_only_not_executed");
  assert.deepEqual(plan.spawn_parameters, {
    agent_type: "worker",
    model: "gpt-6-luna",
    reasoning_effort: "high",
    fork_turns: "none",
  });
  assert.equal(plan.external_router, false);
  assert.equal(plan.external_provider_keys, false);
  assert.equal(plan.recursion_allowed, false);
  for (const tier of ["straightforward", "complex"]) {
    assert.ok(
      ["gpt-5.6-terra", "gpt-6-sol"].includes(
        createDispatchPlan(policy, tier).spawn_parameters.model,
      ),
    );
  }
  assert.throws(
    () => createDispatchPlan({ ...policy, externalRouterAllowed: true }, "routine"),
    /routing_policy_not_native_safe/,
  );
  assert.throws(
    () =>
      createDispatchPlan(
        { ...policy, workers: { routine: { model: "external-router", reasoningEffort: "high" } } },
        "routine",
      ),
    /tier_or_model_not_supported/,
  );
  assert.throws(() => createDispatchPlan(policy, "unknown"), /tier_or_model_not_supported/);
});
