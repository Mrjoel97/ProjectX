// @vitest-environment node
//
// ACTN-02 trace parity: every `agentSteps.tool` literal has a human VERB, and every VERB key is a
// real schema literal. Asserted BOTH ways.
//
// Why the node pragma (17-01 Task 1f): backend vitest runs `edge-runtime`, which has no `node:fs`.
// `importGuard.test.ts:5-6` works around that with `import.meta.glob` — unavailable here, because
// this test must read `apps/web/.../cards.tsx`, which is OUTSIDE `packages/backend` and therefore
// outside the module-graph root `import.meta.glob` can reach. `cockpitTools.test.ts:1` is the
// in-repo precedent for the pragma.
//
// Why this test exists: a tool literal with no VERB entry does not throw and does not fail any
// other test — it silently renders the generic "Working…"/"Done" FALLBACK in the workspace trace.
// That is precisely how `replyToMessage` (Phase 3.11, RPLY-01) stayed broken from the day it
// shipped until 17-01 found it by specifying this test.
//
// Do NOT "fix" a failure here by adding a text/label/detail field to `agentSteps` — that re-opens
// exactly the §4 hole the closed union closed (`schema.ts:411-415`).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const REPO = join(__dirname, "..", "..", "..");
const SCHEMA = join(REPO, "packages", "backend", "convex", "schema.ts");
const CARDS = join(REPO, "apps", "web", "app", "(app)", "dashboard", "workspace", "cards.tsx");

/** Slice from an opening anchor to the first line that closes it at the given indent. */
function sliceBlock(src: string, anchor: string, closer: string): string {
  const start = src.indexOf(anchor);
  if (start === -1) throw new Error(`traceParity: anchor not found: ${anchor}`);
  const end = src.indexOf(closer, start + anchor.length);
  if (end === -1) throw new Error(`traceParity: closer not found after: ${anchor}`);
  return src.slice(start, end);
}

/** The literals of the agentSteps.tool union ONLY — not every v.literal in schema.ts. */
function schemaToolLiterals(): string[] {
  const block = sliceBlock(readFileSync(SCHEMA, "utf8"), "    tool: v.union(", "\n    ),");
  return [...block.matchAll(/v\.literal\("([^"]+)"\)/g)].map((m) => m[1] as string);
}

/** The keys of the VERB record in cards.tsx. */
function verbKeys(): string[] {
  const block = sliceBlock(
    readFileSync(CARDS, "utf8"),
    "const VERB: Record<string, [running: string, done: string]> = {",
    "\n};",
  );
  // Record keys only: `name: [` at one indent level. Comment lines never match (they start `//`).
  return [...block.matchAll(/^ {2}([A-Za-z_$][\w$]*):\s*\[/gm)].map((m) => m[1] as string);
}

// Non-vacuity floor (house rule) — a regex that stops matching must fail LOUDLY, not pass by
// finding nothing. 22 was the count before Phases 16+17; the sets only grow.
test("the extractors actually found the two sets", () => {
  expect(schemaToolLiterals().length).toBeGreaterThanOrEqual(22);
  expect(verbKeys().length).toBeGreaterThanOrEqual(22);
});

test("every agentSteps.tool literal has a VERB, and every VERB key is a real literal", () => {
  const literals = new Set(schemaToolLiterals());
  const verbs = new Set(verbKeys());

  const missingVerb = [...literals].filter((t) => !verbs.has(t));
  const orphanVerb = [...verbs].filter((v) => !literals.has(v));

  // Named mutation that turns this RED: delete the `checkAvailability` VERB entry from cards.tsx
  // while leaving its schema literal in place.
  expect(
    missingVerb,
    `agentSteps.tool literals with no VERB entry — their trace rows render the generic ` +
      `"Working…"/"Done" fallback. Add them to VERB in cards.tsx: ${missingVerb.join(", ")}`,
  ).toEqual([]);

  expect(
    orphanVerb,
    `VERB keys that are not agentSteps.tool literals — dead entries that can never render. ` +
      `Remove them or add the schema literal: ${orphanVerb.join(", ")}`,
  ).toEqual([]);
});
