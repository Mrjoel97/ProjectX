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
  expect(calls.length, "no generateText call sites in llm.ts — was the loop renamed?").toBeGreaterThan(0);

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
