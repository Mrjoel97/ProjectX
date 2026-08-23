"use node";
// ^ REQUIRED, and its absence blocked EVERY push to the deployment: Convex bundles every
// module under convex/ for the V8 runtime unless it declares this, so `foglamp`'s
// `node:http`/`node:async_hooks` imports failed to resolve and the whole deploy aborted.
// The comment below said only "use node" modules may import this file; the file itself
// never said it. Found 2026-08-23 when home.js:summary silently never reached :3210.

// Foglamp tracing — THE single `fog` instance for this deployment.
//
// WHY THIS FILE EXISTS AND WHY IT LIVES IN lib/: the `foglamp` entry point statically imports
// `node:async_hooks` (dist/config-*.mjs line 1, for the AsyncLocalStorage that backs `fog.run`).
// The Convex DEFAULT (V8) runtime does not provide that module, so any module importing this one
// is a NODE module by construction.
//
// ONLY `"use node"` MODULES MAY IMPORT THIS FILE. Importing it from a default-runtime module
// breaks that module at load time, not at call time — the failure is a deploy/bundle error, not a
// caught exception. Today's importers: llm.ts, dispatch.ts, intake.ts, vaultExtract.ts.
//
// The un-instrumented AI calls in blueprint.ts, onboarding.ts, vaultDigest.ts, vaultLlm.ts and
// voiceDoc.ts are NOT an oversight: those modules hold query/mutation builders, a `"use node"`
// module may hold ONLY actions, so they can never import this file. See docs/playbooks/tracing.md.
//
// The SDK is a silent no-op when FOGLAMP_API_KEY is unset, so this is safe in every environment
// (CI, convex-test, a fresh clone) without a guard.
import { foglamp } from "foglamp";

type Fog = ReturnType<typeof foglamp>;
type IntegrationInput = Parameters<Fog["integration"]>[0];
type IntegrationContext = Parameters<Fog["run"]>[0];

let instance: Fog | undefined;

/**
 * Construct on FIRST USE, never at module load.
 *
 * THIS IS LOAD-BEARING, not style. `foglamp()` starts a background flush `setInterval` that calls
 * `globalThis.fetch`, and every convex-test file pulls in EVERY module under `convex/` via
 * `import.meta.glob(["./**\/*.ts", "!./**\/*.test.ts"])`. Constructing at module load therefore
 * armed that timer inside all 95 test files — including ones that assert a code path issues no
 * fetch at all (media.test.ts "never buys a sandbox"), which failed with a phantom fetch.
 *
 * Lazily, a test file that never traces never builds the instance and never arms the timer.
 */
function fog(): Fog {
  instance ??= foglamp();
  return instance;
}

/**
 * Per-call trace binding for an AI SDK v7 call:
 * `telemetry: { integrations: [fogIntegration({ agentName: "..." })] }`.
 *
 * `agentName` / `traceName` MUST be a static string literal at the call site — never a variable,
 * template literal or concatenation. Dynamic values belong in `metadata`, `workflowRunId` or
 * `sessionId`, or they explode trace cardinality.
 */
export function fogIntegration(context: IntegrationInput) {
  return fog().integration(context);
}

/**
 * Drain queued spans before an action returns.
 *
 * Convex is serverless but it is NOT Vercel, so the SDK's automatic `waitUntil` path never fires;
 * without an explicit drain the spans die with the invocation.
 *
 * Never throws, and never constructs the instance just to flush it: telemetry must not be able to
 * fail a governed action, and a dropped span is strictly preferable to a dead-lettered request.
 */
export async function flushTelemetry(): Promise<void> {
  if (!instance) return;
  try {
    await instance.flush();
  } catch {
    // ponytail: swallowed on purpose — a lost trace must never become a pipeline terminal.
    // Upgrade path: count these into the OPSG telemetry rail if traces start going missing.
  }
}

/**
 * Bind ambient trace context around one agent turn AND drain on the way out.
 *
 * Used at the seams where the AGENT IDENTITY is known but the model call is not: `runAgentLoop`
 * and `runSpecialistTurn` are shared by the cockpit and every specialist, and `agentName` must be
 * a static literal, so the name has to be bound by the caller rather than at the call. Ambient
 * context layers UNDER the per-call integration, so the shared call site keeps its own
 * `traceName` while the caller supplies the agent identity.
 *
 * The `finally` is the point: an agent turn that throws is exactly the turn worth having a trace
 * for, and without it the spans die with the invocation.
 */
export async function traced<T>(context: IntegrationContext, fn: () => Promise<T>): Promise<T> {
  try {
    return await fog().run(context, fn);
  } finally {
    await flushTelemetry();
  }
}
