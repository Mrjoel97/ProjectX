import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  codexArgs,
  isolatedEnvironment,
  MODEL,
  main,
  quickRequestBody,
  ROOT,
  readExistingKey,
  summarizeCodexJsonl,
  summarizeOpenRouterResponse,
  validateFlashPolicy,
} from "./flash-worker.mjs";

const policy = JSON.parse(
  readFileSync(resolve(ROOT, "docs/agent-work/pikar-flash-routing.json"), "utf8"),
);

test("opt-in Flash policy is separate from application and native route", () => {
  assert.equal(validateFlashPolicy(policy), policy);
  assert.throws(
    () =>
      validateFlashPolicy({
        ...policy,
        application: { ...policy.application, runtimeModelRoutingChanged: true },
      }),
    /flash_policy_not_dev_safe/,
  );
  assert.throws(
    () => validateFlashPolicy({ ...policy, worker: { ...policy.worker, model: "moving-alias" } }),
    /flash_policy_not_dev_safe/,
  );
  const plan = main(["plan"], {});
  assert.equal(plan.status, "plan_only_not_executed");
  assert.equal(plan.model, MODEL);
  assert.equal(plan.app_configuration_changed, false);
});

test("existing .env key is read in memory with no duplicate or multiline acceptance", () => {
  const fake = `sk-or-${"x".repeat(24)}`;
  assert.equal(readExistingKey(`OTHER=a\nOPEN_ROUTER_API_KEY="${fake}"\n`), fake);
  assert.throws(() => readExistingKey("OTHER=a\n"), /missing_or_duplicated/);
  assert.throws(
    () => readExistingKey(`OPEN_ROUTER_API_KEY=${fake}\nOPEN_ROUTER_API_KEY=${fake}\n`),
    /missing_or_duplicated/,
  );
  assert.throws(() => readExistingKey("OPEN_ROUTER_API_KEY=wrong"), /invalid_format/);
});

test("Codex worker has one pinned OpenRouter Responses provider and no retries", () => {
  const args = codexArgs();
  const text = args.join(" ");
  assert.match(text, /deepseek\/deepseek-v4-flash-0731/);
  assert.match(text, /model_provider="pikar_dev_openrouter"/);
  assert.match(text, /base_url="https:\/\/openrouter.ai\/api\/v1"/);
  assert.match(text, /wire_api="responses"/);
  assert.match(text, /request_max_retries=0/);
  assert.match(text, /stream_max_retries=0/);
  assert.match(text, /shell_environment_policy.ignore_default_excludes=false/);
  assert.ok(args.includes("read-only"));
  assert.ok(!text.includes("sk-or-"));
  assert.ok(codexArgs({ mode: "workspace-write" }).includes("workspace-write"));
  assert.throws(() => codexArgs({ mode: "danger-full-access" }), /invalid_worker_mode/);
});

test("child environment contains only minimal system variables and provider key", () => {
  const env = isolatedEnvironment(
    { PATH: "path", APPDATA: "appdata", CONVEX_DEPLOY_KEY: "secret", OPENAI_API_KEY: "other" },
    "synthetic-key",
  );
  assert.equal(env.OPENROUTER_API_KEY, "synthetic-key");
  assert.equal(env.CONVEX_DEPLOY_KEY, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
});

test("usage report uses completed event counters and does not echo model text", () => {
  const events = [
    { type: "thread.started", thread_id: "t1" },
    { type: "item.completed", item: { type: "agent_message", text: "PIKAR_FLASH_ROUTE_OK" } },
    {
      type: "turn.completed",
      usage: { input_tokens: 12, cached_input_tokens: 3, output_tokens: 4 },
    },
  ]
    .map(JSON.stringify)
    .join("\n");
  const summary = summarizeCodexJsonl(events, { probe: true });
  assert.equal(summary.thread_id, "t1");
  assert.equal(summary.completed, true);
  assert.equal(summary.probe_marker, true);
  assert.deepEqual(summary.usage, { input_tokens: 12, cached_input_tokens: 3, output_tokens: 4 });
  assert.equal(JSON.stringify(summary).includes("PIKAR_FLASH_ROUTE_OK"), false);
  assert.equal(summarizeCodexJsonl('{"type":"turn.completed"}').usage, null);
  assert.equal(summarizeCodexJsonl('{"type":"error"}').failed, true);
});

test("direct Responses route is bounded and reports only model/provider/usage metadata", () => {
  const request = quickRequestBody("bounded synthetic brief");
  assert.equal(request.model, MODEL);
  assert.equal(request.max_output_tokens, 2_048);
  assert.equal(quickRequestBody("probe", { probe: true }).max_output_tokens, 256);
  assert.equal(request.store, false);
  assert.equal(request.tools, undefined);
  assert.throws(() => quickRequestBody("x".repeat(20_001)), /quick_input_too_large/);
  const summary = summarizeOpenRouterResponse(
    {
      id: "resp_test",
      model: MODEL,
      status: "completed",
      output: [
        { type: "message", content: [{ type: "output_text", text: "PIKAR_FLASH_ROUTE_OK" }] },
      ],
      usage: {
        input_tokens: 42,
        output_tokens: 6,
        input_tokens_details: { cached_tokens: 2 },
        output_tokens_details: { reasoning_tokens: 1 },
      },
      openrouter_metadata: { provider_name: "DeepSeek", secret_extra: "must not be surfaced" },
    },
    { probe: true },
  );
  assert.equal(summary.probe_marker, true);
  assert.equal(summary.provider_reported, "DeepSeek");
  assert.deepEqual(summary.usage, {
    input_tokens: 42,
    cached_input_tokens: 2,
    output_tokens: 6,
    reasoning_tokens: 1,
  });
  assert.equal(summary.response_status, "completed");
  assert.equal(summary.output_chars, 20);
  assert.equal(JSON.stringify(summary).includes("secret_extra"), false);
});
