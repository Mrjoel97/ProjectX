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
import { describe, expect, test } from "vitest";

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

// ── The calendar-management review card (17-05, ACTN-02 gap closure) ──────────────────────────
//
// Same source-scan idiom and the same file, because this is the ONE test in the repo that already
// reaches `apps/web/.../cards.tsx` from the backend (the node pragma at the top exists for it).
// `apps/web`'s own vitest config is node-only with no jsdom, so a render test is not available
// here; `crmCard.test.ts` records that as a deliberate ceiling.
//
// What is asserted is not cosmetics. A management card that renders after the email chrome is
// UNREACHABLE — the email branch returns first — so the user would approve a calendar deletion
// through a card that says "Send to N recipients". That failure is invisible to every other test.
describe("the calendar_manage review card", () => {
  const cards = () => readFileSync(CARDS, "utf8");

  /** The management branch's source, from its `if` to the line that closes it at 2-space indent.
   *  EOL-agnostic on purpose: `cards.tsx` is CRLF in this working tree and LF in the index, and a
   *  `\n  }\n` literal silently found nothing on the first run (2026-08-11). */
  function manageBranch(src: string): string {
    const start = src.indexOf('if (plan.kind === "calendar_manage") {');
    if (start === -1) throw new Error("calendar_manage branch not found in cards.tsx");
    const closer = /\r?\n {2}\}\r?\n/.exec(src.slice(start));
    if (!closer) throw new Error("calendar_manage branch has no closer");
    return src.slice(start, start + closer.index);
  }

  test("the branch exists and carries its own testid", () => {
    const branch = manageBranch(cards());
    expect(branch.length).toBeGreaterThan(500); // non-vacuity floor
    expect(branch).toContain('data-testid="calendar-manage-plan-card"');
  });

  // Named mutation that turns this RED: move the `calendar_manage` branch below the final email
  // `return (` in PlanCard. Every other assertion in this file stays green while the card becomes
  // dead code.
  test("the branch renders BEFORE the email chrome, or it can never render at all", () => {
    const src = cards();
    const branchAt = src.indexOf('if (plan.kind === "calendar_manage") {');
    // The email default return is the only place this string appears — it is the recipient-chip
    // empty state, i.e. the first line of the chrome that must not reach a calendar change.
    const chromeAt = src.indexOf("No recipients yet.");
    expect(branchAt).toBeGreaterThan(-1);
    expect(chromeAt).toBeGreaterThan(-1);
    expect(
      branchAt,
      "the calendar_manage branch sits after the email chrome — the email return fires first, so " +
        "the management card is unreachable",
    ).toBeLessThan(chromeAt);
  });

  // Two operations, two promises. "Approve & send" or a single shared label would claim an act
  // that did not happen (BRAND §1), and a delete labelled "update" is worse than unlabelled.
  test("the Approve label names the operation, exactly", () => {
    const branch = manageBranch(cards());
    expect(branch).toContain('"Approve & remove from calendar"');
    expect(branch).toContain('"Approve & update calendar"');
    expect(branch).not.toContain("Approve & send");
  });

  // §4/§2-D: a calendar change has no recipients, and the provider's attendee-notification flows
  // (Google `sendUpdates`, Graph `/cancel`) are out of the whole subsystem. The card must not
  // render a recipient list or name an attendee surface — asserted on the ABSENT slot rather than
  // on a word, because the honest copy legitimately says "Nothing is sent to anyone."
  test("the card renders no recipients and names no attendee-notification surface", () => {
    const branch = manageBranch(cards());
    expect(branch).not.toContain("plan.recipients");
    expect(branch).not.toContain("recipientBodies");
    expect(branch).not.toMatch(/sendUpdates|attendee/i);
  });

  // The two reserved literals are the point of the parity test above; naming them here makes the
  // 17-09 hand-off explicit rather than implied by a set comparison.
  test("both management trace literals have VERB entries", () => {
    const literals = new Set(schemaToolLiterals());
    const verbs = new Set(verbKeys());
    for (const tool of ["listManagedCalendarEvents", "proposeCalendarChange"]) {
      expect(literals.has(tool), `${tool} is missing from the agentSteps.tool union`).toBe(true);
      expect(verbs.has(tool), `${tool} is missing from cards.tsx VERB`).toBe(true);
    }
  });
});
