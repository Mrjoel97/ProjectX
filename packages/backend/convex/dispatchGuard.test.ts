// @vitest-environment node
//
// Static-scan enforcement of Phase 15's structural invariants (DISP-01 / ACTN-01). Mirrors the
// llmRedaction.test.ts / auditImmutability.test.ts idiom: read the source off disk, strip comments
// (prose may NAME the forbidden thing — that is the documentation), assert on what remains.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const convexDir = dirname(fileURLToPath(import.meta.url));
/** Source with line comments stripped — the invariant is about the CODE surface. */
const readCode = (file: string): string =>
  readFileSync(join(convexDir, file), "utf8").replace(/\/\/[^\n]*/g, "");

// ── SC #2: dispatch is a SEQUENTIAL second loop, never a loop nested inside a tool ────────────
//
// A `generateText` inside a tool's `execute` would be a second agent loop running INSIDE the
// first one's step budget. Two things break at once: the daily spend window is billed twice for
// one turn while `preCall` only ever sees the outer call, and `stopWhen: stepCountIs(8)` stops
// meaning anything (the inner loop's steps are invisible to the outer bound, so an 8-step cap
// becomes 8 × N). The fix is architectural, not a limit: dispatch RETURNS to the orchestrator,
// which starts the specialist loop as its own governed call.

test("dispatch.ts contains ZERO generateText call sites (the dispatcher never runs a loop itself)", () => {
  const src = readCode("dispatch.ts");
  expect(
    src.match(/generateText/g) ?? [],
    "dispatch.ts calls generateText — a nested loop double-bills the daily budget and voids stopWhen",
  ).toHaveLength(0);
});

/** The argument text of every `generateText(...)` call in a file, balanced-paren sliced. */
function generateTextCalls(file: string): string[] {
  const src = readCode(file);
  const out: string[] = [];
  for (const m of src.matchAll(/generateText\(/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    out.push(src.slice(m.index, i));
  }
  return out;
}

test("llm.ts has EXACTLY ONE TOOL-BEARING generateText call site (one agent loop, not two)", () => {
  const calls = generateTextCalls("llm.ts");
  // Non-vacuity: a rename would otherwise make every count below trivially 0.
  expect(
    calls.length,
    "no generateText call sites in llm.ts — was the loop renamed?",
  ).toBeGreaterThan(0);

  // The count that matters is TOOL-BEARING calls, not total calls. llm.ts deliberately holds
  // several TOOLLESS generateText calls (digestInbox / draftReply / draftCockpit) — that is the
  // untrusted-content ingestion firewall (agent-runtime.md invariant 10), and llmRedaction.test.ts
  // already pins each of them as toolless. Counting raw call sites would therefore break every
  // time the firewall grew a legitimate member, while still missing a second loop hidden inside a
  // tool. Equality, not `<=`: a second loop must fail the day it appears.
  // `[,:]` — runAgentLoop passes the tool set by SHORTHAND (`tools,`), not `tools:`.
  const toolBearing = calls.filter((c) => /\btools\s*[,:]/.test(c));
  expect(
    toolBearing.length,
    `llm.ts has ${toolBearing.length} tool-bearing generateText call sites — runAgentLoop must ` +
      `remain THE one loop. A second one double-bills the daily spend window (preCall only ever ` +
      `sees the outer call) and voids stopWhen: stepCountIs(8).`,
  ).toBe(1);
});

// 15-05 adds: the Approve gate is a `tenantMutation`, never a tool (ACTN-01 — the human gate
// cannot be reachable from the model's tool surface). Append below this marker so the two lanes'
// additions to this file do not collide.

// ── SC #4: the human Approve gate is a tenantMutation, never a tool ───────────────────────────
//
// The standing v2.0 architecture rule: every capability is ONE of two shapes — a read-only tool
// returning content in-loop, or a WRITE staged into the plan for the human Approve mutation. There
// is no third mechanism. `executePlan` is that Approve mutation: the single point of irreversible
// consent (it seeds the requests rows and starts the ONLY `workflow.start(deliverApprovedPlan)`
// call site). A model that can call it has removed the human from the loop — so it must be
// unreachable from the tool surface by CONSTRUCTION, not by skill wording. Generalizing the
// executor (15-05) is exactly the moment that could slip: an "action executor" is a tempting thing
// to hand the agent.
//
// Block comments are stripped too here — the doc comments in these files legitimately NAME
// executePlan and deliverApprovedPlan; that prose IS the documentation, not a call path.
const readExecutableCode = (file: string): string =>
  readFileSync(join(convexDir, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

test("cockpit.ts declares executePlan as a tenantMutation (not an action, not a tool wrapper)", () => {
  expect(
    readExecutableCode("cockpit.ts"),
    "executePlan is no longer declared `export const executePlan = tenantMutation({` — the Approve " +
      "gate must stay a tenant-scoped MUTATION: an action could be invoked from the tool loop, and " +
      "the CAS on plan.status that makes a double-approve send once needs mutation serializability.",
  ).toContain("export const executePlan = tenantMutation({");
});

test("executePlan / approvePlan / deliverApprovedPlan are absent from the cockpit TOOL record", () => {
  const src = readExecutableCode("llm.ts");
  // Every key of the record buildCockpitTools returns is declared `name: tool({`.
  const toolKeys = [...src.matchAll(/^\s*([A-Za-z_$][\w$]*):\s*tool\(\{/gm)].map((m) => m[1]);
  // Non-vacuity floor: the record holds 20 keys today and only grows (Phases 16-19 add tools). A
  // zero here would mean the scan stopped seeing the tool surface, not that the gate is safe.
  expect(
    toolKeys.length,
    "no `name: tool({` keys found in llm.ts — did the tool idiom change?",
  ).toBeGreaterThanOrEqual(20);

  for (const forbidden of ["executePlan", "approvePlan", "deliverApprovedPlan"]) {
    expect(
      toolKeys,
      `${forbidden} is a KEY in the cockpit tool record — the model can now approve/deliver without ` +
        `a human. Approve is the single point of irreversible consent; stage the write into the plan ` +
        `row instead and let the human call api.cockpit.executePlan.`,
    ).not.toContain(forbidden);
  }
});

test("llm.ts holds NO reference to the Approve gate or the fan-out at all (not even by name)", () => {
  const src = readExecutableCode("llm.ts");
  // Not just "absent as a tool key" — absent as a callable reference. A tool that internally did
  // `ctx.runMutation(internal.cockpit.executePlan, …)` under any OTHER key would defeat the scan
  // above, and so would a scheduler.runAfter to it.
  for (const ref of [/\b(?:internal|api)\.cockpit\.executePlan\b/, /\bdeliverApprovedPlan\b/]) {
    expect(
      src.match(ref) ?? [],
      `llm.ts references ${ref.source} — the agent loop must have NO path to Approve or to the ` +
        `gmail fan-out, directly or by name. executePlan is the SOLE starter of deliverApprovedPlan.`,
    ).toHaveLength(0);
  }
});
