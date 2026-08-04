#!/usr/bin/env node
// OQ-2 probe (Phase 16, D8): which model actually accepts `openai.tools.webSearch`?
//
// WHY THIS EXISTS: OpenAI's own guide and pricing page contradict each other, and guessing wrong
// fails SILENTLY. An unpriced/unsupported model makes `priceUsage` return Err({unknown_model}),
// `recordModelSpend` returns 0 (llm.ts), and a research run draws down NOTHING against the daily
// rail or the Phase-15 shared envelope. A research specialist that appears FREE is worse than one
// that errors — the governance rail would be absent for exactly the phase that spends most.
//
// Needs NO Convex deployment: a direct generateText against OpenAI (ponytail rung 5 — the
// already-installed dependency does it).
//
// ponytail: one-shot. No retries, no caching, no concurrency. This is a DECISION INSTRUMENT run
// once per model-lineup change, not a monitor. Upgrade path if it ever needs to run in CI: add a
// --json flag and assert on the parsed object, not on the printed text.

import assert from "node:assert/strict";
import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs } from "ai";

// The first is what the pricing page implies (and is cheapest); the rest are the guide's named
// list. `gpt-4.1-nano` (today's CHEAP_MODEL) is deliberately ABSENT — it appears in neither page.
const LADDER = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"];
const MAX_CALLS = 3;

// Published hosted-search fee: $10 per 1k calls.
const PUBLISHED_CALL_USD = 0.01;

// Dated on purpose: the answer cannot come from model memory, so an EMPTY sources array is a real
// signal rather than an artefact of an easy question.
const PROMPT =
  "Using web search, name one specific news item published in the last 30 days about OpenAI's" +
  " API pricing or model lineup. Give the headline, the publication, and the date. If you cannot" +
  " find one, say exactly: NO RESULTS.";

/** Collect every tool-call part across steps as {toolName, providerExecuted}. */
export function collectToolCalls(steps) {
  const out = [];
  for (const s of steps ?? []) {
    for (const part of s?.content ?? []) {
      if (part?.type === "tool-call") {
        out.push({ toolName: part.toolName, providerExecuted: part.providerExecuted === true });
      }
    }
  }
  return out;
}

/** Sources → parseable urls. Throws on an unparseable url, which is itself a finding. */
export function collectSources(sources) {
  const urls = [];
  for (const s of sources ?? []) {
    if (s?.sourceType === "url" && typeof s.url === "string") {
      new URL(s.url); // assert parseable
      urls.push({ url: s.url, title: s.title ?? "" });
    }
  }
  return urls;
}

export function formatReport({ model, ok, err, sources, usage, steps, toolCalls, text }) {
  const L = [];
  L.push(`--- candidate: ${model}`);
  if (!ok) {
    // The `model=` suffix on the verdict line is LOAD-BEARING, not formatting: the ladder records a
    // FAIL block for every earlier candidate, so a gate checking `probe: PASS` and the model id
    // independently would be satisfied by a PASS on one model and a pin to a different, failing
    // one. Printing the id ON the verdict line makes the gate a mechanical adjacency check.
    // It also kills the substring trap: `gpt-4.1` is a substring of `gpt-4.1-mini` AND `-nano`.
    L.push(`probe: FAIL model=${model} ${err}`);
    return L.join("\n");
  }
  L.push(`sources: ${sources.length}`);
  L.push(`text: ${JSON.stringify((text ?? "").slice(0, 300))}`);
  for (const s of sources) L.push(`  url: ${s.url}`);
  L.push(
    `usage: inputTokens=${usage?.inputTokens ?? "?"} outputTokens=${usage?.outputTokens ?? "?"}`,
  );
  L.push(`steps: ${steps}`);
  // Load-bearing and easy to skip: we do NOT know whether the SDK surfaces a provider-executed
  // call under OUR record key (`webResearch`) or the provider's own name (`web_search`). 16-05's
  // cost counting and every offline mock fixture MUST match what the provider actually emits, or
  // we ship tests that pass against a fiction.
  L.push(`toolCalls: ${JSON.stringify(toolCalls)}`);
  L.push(`estimated call fee: $${PUBLISHED_CALL_USD.toFixed(4)} (published $10/1k calls)`);
  L.push(`probe: PASS model=${model}`);
  return L.join("\n");
}

function selfCheck() {
  // Zero network, zero spend.
  const fakeSteps = [
    {
      content: [
        { type: "tool-call", toolName: "web_search", providerExecuted: true },
        { type: "text", text: "irrelevant" },
      ],
    },
    { content: [{ type: "tool-call", toolName: "web_search", providerExecuted: true }] },
  ];
  assert.deepEqual(collectToolCalls(fakeSteps), [
    { toolName: "web_search", providerExecuted: true },
    { toolName: "web_search", providerExecuted: true },
  ]);
  assert.deepEqual(collectToolCalls(undefined), []);

  assert.deepEqual(
    collectSources([
      { sourceType: "url", url: "https://example.com/a", title: "A" },
      { sourceType: "document" },
    ]),
    [{ url: "https://example.com/a", title: "A" }],
  );
  assert.throws(() => collectSources([{ sourceType: "url", url: "not a url" }]));

  const pass = formatReport({
    model: "gpt-4o-mini",
    ok: true,
    sources: [{ url: "https://example.com/a", title: "A" }],
    usage: { inputTokens: 10, outputTokens: 20 },
    steps: 2,
    toolCalls: [{ toolName: "web_search", providerExecuted: true }],
  });
  // The gate Task 3 relies on: verdict and id on ONE line.
  assert.match(pass, /^probe: PASS model=gpt-4o-mini$/m);
  assert.ok(pass.includes("providerExecuted"));
  assert.ok(pass.includes("sources: 1"));

  const fail = formatReport({ model: "gpt-4.1", ok: false, err: "APICallError: bad tool" });
  assert.match(fail, /^probe: FAIL model=gpt-4\.1 /m);
  assert.ok(!fail.includes("probe: PASS"));

  assert.equal(LADDER.length, MAX_CALLS);
  assert.ok(!LADDER.includes("gpt-4.1-nano"), "nano is in neither OpenAI page — keep it out");

  console.log("self-check: PASS (no network, no spend)");
}

async function probeOne(model) {
  const argPrompt = process.argv.find((a) => a.startsWith("--prompt="));
  const res = await generateText({
    model: openai(model),
    prompt: argPrompt ? argPrompt.slice("--prompt=".length) : PROMPT,
    tools: { web_search: openai.tools.webSearch({ searchContextSize: "medium" }) },
    stopWhen: stepCountIs(4),
  });
  return formatReport({
    model,
    ok: true,
    sources: collectSources(res.sources),
    usage: res.usage,
    steps: res.steps?.length ?? 0,
    text: res.text,
    toolCalls: collectToolCalls(res.steps),
  });
}

async function main() {
  if (process.argv.includes("--self-check")) {
    selfCheck();
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set.");
    console.error("run from packages/backend: npx convex env get OPENAI_API_KEY");
    process.exit(1);
  }

  console.log(`# OQ-2 hosted web-search probe — ${new Date().toISOString()}`);
  console.log(`# ladder: ${LADDER.join(" -> ")} (stops at first PASS, hard cap ${MAX_CALLS})`);

  // --model=<id> probes ONE candidate (used to prove the FALLBACK also supports the tool:
  // isFallbackEligible returns false for a non-retryable 4xx, so an unsupported-tool 400 on the
  // fallback would propagate loudly — the good failure mode ONLY if the fallback is not itself
  // the unsupported one).
  const only = process.argv.find((a) => a.startsWith("--model="));
  const ladder = only ? [only.slice("--model=".length)] : LADDER.slice(0, MAX_CALLS);
  let passed = null;
  for (const model of ladder) {
    try {
      const report = await probeOne(model);
      console.log(report);
      passed = model;
      break; // first PASS wins — that is what keeps this ~1 call / ~$0.01
    } catch (e) {
      const head = String(e?.message ?? e)
        .split("\n")[0]
        .slice(0, 160);
      console.log(formatReport({ model, ok: false, err: `${e?.name ?? "Error"}: ${head}` }));
    }
  }

  if (!passed) {
    console.error("");
    console.error("EVERY candidate failed. Do NOT invent a fourth candidate and do NOT fall back");
    console.error("to DEFAULT_MODEL — a phase built on an unsupported tool is a phase-level");
    console.error("replan. Record the failures verbatim and stop.");
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
