#!/usr/bin/env node
/**
 * probe-gemini — does the `google/` half of `resolveModel` actually work on THIS deployment?
 *
 * Gemini and OpenAI ALTERNATE (owner decision 2026-08-07): `DEFAULT_MODEL` is Gemini and
 * `CHEAP_MODEL` is OpenAI, so `runAgentLoop`'s existing primary → fallback step is cross-vendor
 * credit failover. The unit suite is offline by design and typechecking proves compilation, not that
 * a request returns — this script is the one thing that turns "it compiles" into "it answered".
 *
 * It is a thin wrapper. The work happens in `llm:probeGemini`, INSIDE the deployment, because that
 * is the only place that proves the real thing: the env var Convex actually holds, the installed
 * provider version, the deployment's own egress. A credential that works on a laptop proves nothing
 * about a backend that has no filesystem to read it from.
 *
 * IT HAS EARNED ITS KEEP. Every one of these was found by RUNNING it, not by reading code:
 * billing disabled on three separate GCP projects; a service-account JSON mangled by `convex env
 * set` on Windows (hence base64); `gemini-2.5-flash` listed but closed to new keys; Gemini 3.x
 * returning a 200 with EMPTY text because reasoning ate a 16-token budget; and two bugs in this very
 * file (a `lastIndexOf("{")` that parsed the nested `usage` object, and cmd.exe eating the JSON
 * argument's quotes).
 *
 * THREE OUTCOMES, and the third is the whole point:
 *   0  PASS         the model answered with real prose AND the response priced against PRICING
 *   1  REFUSED      we reached the deployment and it told us why Gemini did not work — actionable
 *   2  UNREACHABLE  the action never ran (no deployment, no CLI, bad args). NOT a verdict on Gemini
 *
 * Exit 2 must NEVER collapse into 0 — a probe that reports green when it never asked manufactures
 * confidence, which is the exact defect `docs/playbooks/ci-gate.md` documents in `skillopt.yml`,
 * where `|| true` turned a call that never happened into a passing check. It must not collapse into
 * 1 either: "your service account lacks a role" and "you have no deployment running" are different
 * jobs for different people. **There is no `|| true` anywhere in this file, deliberately.**
 *
 * NOT a vitest test, for the same reasons as check-fal-catalog: it costs money (a few tokens), needs
 * a live deployment and credentials, and would make `pnpm test` non-offline and flaky.
 *
 * `--grounded` PROBES THE RESEARCH PATH, not just the model. It attaches the production hosted-search
 * tool and adds three failing verdicts for 200-OK responses that read as success: `no_search_call`,
 * `no_sources`, `tool_vendor_mismatch`. The Gemini research pins have never executed a grounded call
 * (see the debt at `RESEARCH_MODEL` in packages/cost/src/cost.ts), and the Phase-16 eval CANNOT be
 * trusted until both pins return PASS here — a green gate on an unproven grounding path certifies
 * nothing. Run it against BOTH: the fallback is reached by `isFallbackEligible` and is equally
 * unproven. A grounded run costs a few tokens plus one real search fee (~$0.035, Google's rate).
 *
 * Usage, from packages/backend (the Convex CLI only resolves the deployment from here):
 *   node scripts/probe-gemini.mjs
 *   node scripts/probe-gemini.mjs google/gemini-3.5-flash-lite
 *   node scripts/probe-gemini.mjs --grounded                              # RESEARCH_MODEL
 *   node scripts/probe-gemini.mjs google/gemini-3.5-flash-lite --grounded # RESEARCH_FALLBACK_MODEL
 */
import { spawnSync } from "node:child_process";

const grounded = process.argv.includes("--grounded");
// Skip flags, so `--grounded` alone does not get sent as a model id and probed as `google/`-less.
const model = process.argv.slice(2).find((a) => !a.startsWith("--"));
// `shell: true` is needed for `npx` on Windows, and cmd.exe STRIPS the inner double quotes from a
// JSON argument — `{"model":"x"}` arrives as `{model:x}` and the CLI rejects it. The no-arg `{}`
// form has no quotes, which is why the default probe passed while the explicit-model form failed.
// Re-quote and escape for cmd; POSIX shells need neither.
const argJson =
  model || grounded
    ? JSON.stringify({ ...(model ? { model } : {}), ...(grounded ? { grounded: true } : {}) })
    : "{}";
const argQuoted = process.platform === "win32" ? `"${argJson.replace(/"/g, '\\"')}"` : argJson;
const args = ["convex", "run", "llm:probeGemini", argQuoted];

// This repo's local sqlite backend is ~464 MB and does NOT start inside Convex's 30 s default —
// observed here 2026-08-07, and the reason `turbo.json` passes this var through at all. Carrying
// the documented 180 s means a caller cannot get a spurious UNREACHABLE by forgetting it; an
// explicit value in the environment still wins.
const run = spawnSync("npx", args, {
  encoding: "utf8",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS:
      process.env.CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS ?? "180",
  },
});

// The CLI itself failed: no deployment, not logged in, wrong cwd, convex not installed. We never
// asked Gemini anything, so this cannot be reported as a Gemini verdict in either direction.
if (run.error || run.status !== 0) {
  console.error("UNREACHABLE — `npx convex run llm:probeGemini` did not complete.\n");
  console.error(run.stderr?.trim() || run.error?.message || `exit ${run.status}`);
  console.error(
    "\nThis says NOTHING about Gemini. In observed order of likelihood:\n" +
      "  1. `Could not find function for 'llm:probeGemini'` — the function exists in source but is not\n" +
      "     PUSHED. Run `npx convex dev` (leave it running) and re-run this probe. Seen 2026-08-07.\n" +
      "  2. Not run from packages/backend — the Convex CLI resolves the deployment from there only.\n" +
      "  3. No local backend running, or not logged in for a cloud deployment.",
  );
  process.exit(2);
}

// `convex run` prints the return value as JSON on stdout, but log lines can precede it.
//
// Anchor on a brace at COLUMN 0, not `lastIndexOf("{")`. The CLI PRETTY-PRINTS the result across
// several lines, so the last `{` in the stream is the nested `"usage": {` — slicing from there
// parsed a fragment and reported UNREACHABLE on a run that had actually succeeded. Observed
// 2026-08-07 against a real PASS, which is the only reason it was caught.
const out = run.stdout ?? "";
const starts = [...out.matchAll(/^\{/gm)].map((m) => m.index);
let res;
try {
  if (starts.length === 0) throw new Error("no top-level JSON object in output");
  res = JSON.parse(out.slice(starts[starts.length - 1]));
} catch (e) {
  console.error("UNREACHABLE — could not parse the action's return value.\n");
  console.error(out.trim() || "(empty stdout)");
  console.error(`\nParse error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}

const FIXES = {
  no_credential:
    "Two doors to the same models. Pick one (Convex has no filesystem, so both are env vars):\n" +
    "  FREE  — AI Studio: get a key at https://aistudio.google.com/apikey, then\n" +
    "          npx convex env set GOOGLE_GENERATIVE_AI_API_KEY '<key>'\n" +
    "  PAID  — Vertex: needs a LINKED BILLING ACCOUNT, and is the only door to Imagen/Veo\n" +
    "          npx convex env set GOOGLE_SERVICE_ACCOUNT_JSON \"$(node -e \"console.log(require('fs').readFileSync(process.argv[1]).toString('base64'))\" key.json)\"\n" +
    "The AI Studio key WINS when both are set.",
  bad_credential:
    "The env var is set but is not a usable service-account key. Re-copy the whole JSON file, including its braces.",
  provider_refused:
    "The provider was reached and refused. Reaching this verdict at all means the credential PARSED\n" +
    "and AUTHENTICATED. **CHECK THE DOOR FIRST** — the causes below are VERTEX ones, and if\n" +
    "GOOGLE_GENERATIVE_AI_API_KEY is set then `resolveModel` used AI STUDIO and none of them apply.\n" +
    "\n" +
    "  QUOTA (a 429 'exceeded your current quota') — and this is where --grounded lands. OBSERVED\n" +
    "  2026-08-07 on AI Studio: BOTH research pins answered a plain prompt and BOTH were refused with\n" +
    "  the SAME prompt once `googleSearch` was attached. Plain PASS + grounded 429 on one key is not\n" +
    "  an exhausted key — it means Google Search grounding is quota'd SEPARATELY and the free tier's\n" +
    "  grounding allowance is the one you are out of. Enable billing on the AI Studio project (or use\n" +
    "  a billed Vertex door); no code change makes a free key grounded.\n" +
    "  Note it is RETRYABLE, so isFallbackEligible is true — production would roll from RESEARCH_MODEL\n" +
    "  to RESEARCH_FALLBACK_MODEL, which shares the vendor and the quota, and fail twice.\n" +
    "\n" +
    "VERTEX-only causes, in observed order:\n" +
    "  1. BILLING NOT ENABLED — observed 2026-08-07, and the first thing to check.\n" +
    "     **VERTEX AI HAS NO FREE TIER.** A service account alone cannot call it; the project needs\n" +
    "     an active billing account. If the goal was to avoid paying, Vertex is the wrong door —\n" +
    "     Google AI Studio (aistudio.google.com) has a free tier but takes an API KEY, not a\n" +
    "     service account, and is a different provider package (@ai-sdk/google).\n" +
    "  2. Vertex AI API not enabled → console: APIs & Services → enable 'Vertex AI API'\n" +
    "  3. Service account lacks the 'Vertex AI User' role → IAM → add the role\n" +
    "  4. Model not served in GOOGLE_VERTEX_LOCATION (default us-central1) → set that env var",
  unpriced:
    "Gemini ANSWERED but has no PRICING row, so it would bill $0 against DAILY_BUDGET_CENTS.\n" +
    "Add the row in packages/cost/src/cost.ts — a constant and its price land together, always.",
  empty_text:
    "A 200 with no prose. Gemini 3.x REASONS BY DEFAULT and spends thinking tokens from the same\n" +
    "maxOutputTokens budget, so a tight cap returns empty text with a nonzero output count and NO\n" +
    "error. Raise maxOutputTokens, or disable thinking via providerOptions, at the CALL SITE that\n" +
    "produced this. Treat it as a real failure: downstream code expecting prose gets an empty string.",
  tool_vendor_mismatch:
    "`buildWebResearchTool` (llm.ts) picks its vendor from RESEARCH_MODEL, not from the id you passed,\n" +
    "so it would have sent OpenAI's hosted search to a Gemini model — a guaranteed 400 that would say\n" +
    "nothing about Gemini. This is the expected state after reverting the pins to OpenAI. Either probe\n" +
    "the OpenAI path with scripts/run-probe-websearch.mjs, or repoint RESEARCH_MODEL back to google/.",
  no_search_call:
    "A 200 that READS as success. Two unrelated causes, and the toolCalls line above separates them:\n" +
    "  EMPTY toolCalls        — the model answered from memory. It is a prompt/model problem: the probe\n" +
    "                           prompt is dated so it CANNOT be answered from memory, so a model that\n" +
    "                           did not search here will not search for the specialist either.\n" +
    "  toolCalls WITHOUT providerExecuted:true — worse. The call happened and the SDK did not flag it.\n" +
    "                           `runAgentLoop` counts hosted calls on that flag ALONE (llm.ts, the\n" +
    "                           webSearchCalls filter), so every research run would bill $0 of search\n" +
    "                           fee against DAILY_BUDGET_CENTS — a research plane that looks FREE, the\n" +
    "                           exact failure the 16-02 OpenAI probe exists to prevent. Fix the counter\n" +
    "                           to match what @ai-sdk/google actually emits; do NOT relax this probe.",
  no_sources:
    'It searched, and nothing came back as a `sourceType:"url"` source. **Do not run the eval on this.**\n' +
    "The specialist's honesty verdict is `declaredQuestionScope && sources.length === 0` (llm.ts), so\n" +
    "a grounding shape the SDK does not map into `res.sources` makes EVERY Gemini research run claim it\n" +
    "found nothing — fixtures 32 and 34 would go red for a reason that has nothing to do with the skill\n" +
    "body, and money would be spent chasing prose. Check whether @ai-sdk/google surfaces Google's\n" +
    "groundingMetadata as sources at the installed version before touching any skill.",
};

/** The grounded evidence, printed on PASS *and* on every failing verdict — on a failure it is the
 *  only thing that tells the two `no_search_call` causes apart. `toolCalls` is printed VERBATIM
 *  because the emitted name is the PROVIDER's, not our `webResearch` record key, and every offline
 *  mock fixture must be built against what Google really sends. */
const groundedLines = (r, log) => {
  if (r.searchCalls === undefined) return;
  log(`  search: ${r.searchCalls} provider-executed call(s)`);
  log(`  tools : ${JSON.stringify(r.toolCalls ?? [])}`);
  log(`  srcs  : ${(r.sources ?? []).length}`);
  for (const s of r.sources ?? []) log(`          ${s.url}`);
  log(`  fee   : $${(r.feeUsd ?? 0).toFixed(4)} (searchFeeUsd × calls — on TOP of tokens)`);
};

if (res.verdict === "ok") {
  const cost = typeof res.costUsd === "number" ? res.costUsd : 0;
  console.log(`PASS — ${res.model} answered and is priceable.`);
  console.log(`  reply : ${JSON.stringify(res.text)}`);
  console.log(
    `  usage : in=${res.usage?.inputTokens ?? "?"} out=${res.usage?.outputTokens ?? "?"}`,
  );
  // Sub-cent probes are normal; print enough precision that a real number is distinguishable from 0.
  console.log(
    `  cost  : $${cost.toFixed(6)} (NOT drawn against any rail — this is an operator tool)`,
  );
  groundedLines(res, (l) => console.log(l));
  console.log(
    grounded
      ? "\nThe research path works end to end on this deployment: the model ACCEPTED the production\n" +
          "hosted-search tool, the SDK flagged the call as provider-executed (so the fee is counted),\n" +
          "and grounding sources reached `res.sources` (so the honesty verdict is not stuck at\n" +
          '"found nothing"). Probe the OTHER research pin before running the gate.'
      : "\nThe google/ branch of resolveModel works end to end on this deployment.\n" +
          "It does NOT prove GROUNDING works — re-run with --grounded before trusting the Phase-16 eval.",
  );
  console.log(
    "It does NOT prove the price is CORRECT — the Gemini rows are pinned unverified. Check them\n" +
      "against Google's Vertex pricing page before routing production traffic here.",
  );
  process.exit(0);
}

console.error(`REFUSED — verdict: ${res.verdict}`);
console.error(`  model : ${res.model}`);
console.error(`  detail: ${res.detail}`);
if (res.text !== undefined) console.error(`  reply : ${JSON.stringify(res.text)}`);
groundedLines(res, (l) => console.error(l));
const fix = FIXES[res.verdict];
if (fix) console.error(`\nHow to fix:\n${fix}`);
process.exit(1);
