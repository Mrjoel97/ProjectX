// @vitest-environment node
//
// Static-scan enforcement of Phase 15's structural invariants (DISP-01 / ACTN-01). Mirrors the
// llmRedaction.test.ts / auditImmutability.test.ts idiom: read the source off disk, strip comments
// (prose may NAME the forbidden thing — that is the documentation), assert on what remains.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const convexDir = dirname(fileURLToPath(import.meta.url));
/** Source with line comments stripped — the invariant is about the CODE surface. */
const readCode = (file: string): string =>
  readFileSync(join(convexDir, file), "utf8").replace(/\/\/[^\n]*/g, "");
const readExecutableCode = (file: string): string =>
  readFileSync(join(convexDir, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

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

// ── Phase 17: Calendar writes remain unreachable from the model tool surface (ACTN-02) ─────────

test("calendar write modules are absent from llm.ts while the governed freeBusy read stays wired", () => {
  const src = readExecutableCode("llm.ts");
  expect(
    src,
    "llm.ts no longer calls internal.calendar.freeBusy — deleting the Calendar tools would make " +
      "the write-absence scan pass vacuously.",
  ).toMatch(/\binternal\.calendar\.freeBusy\b/);

  for (const ref of [
    /\b(?:internal|api)\.calendar\.createEvent\b/,
    /\b(?:internal|api)\.calendarComplete\.onCreateComplete\b/,
    /\b(?:internal|api)\.calendarComplete\b/,
  ]) {
    expect(
      src.match(ref) ?? [],
      `llm.ts references ${ref.source} — mutation: add ctx.runAction(internal.calendar.createEvent, …) ` +
        `inside proposeCalendarEvent. The model may stage an event but can never reach its write or terminal.`,
    ).toHaveLength(0);
  }
});

test("calendar.ts has exactly the two named POST targets and no hidden token/write endpoint", () => {
  const src = readCode("calendar.ts");
  const postTargets = [
    ...src.matchAll(/fetch\(\s*([^,\s]+)\s*,\s*\{\s*method:\s*["']POST["']/g),
  ].map((match) => match[1]);
  expect(
    [...postTargets].sort(),
    "calendar.ts POST target names changed — mutation: add a third POST. Only FREEBUSY_ENDPOINT " +
      "and EVENTS_INSERT_ENDPOINT are allowed.",
  ).toEqual(["EVENTS_INSERT_ENDPOINT", "FREEBUSY_ENDPOINT"]);
  expect(
    src.match(/\bmethod:\s*["']POST["']/g) ?? [],
    "calendar.ts has a hidden POST — mutation: add a third POST. The shared token endpoint must stay " +
      "inside freshAccessToken in gmail.ts, not be redefined here.",
  ).toHaveLength(2);
});

test("the Google Calendar events.insert URL exists in exactly one non-test Convex module", () => {
  const eventsUrl = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  const owners = readdirSync(convexDir)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .filter((file) => readFileSync(join(convexDir, file), "utf8").includes(eventsUrl));
  expect(
    owners.length,
    "no Convex module owns the events.insert URL — deleting calendar.ts would make uniqueness vacuous.",
  ).toBeGreaterThanOrEqual(1);
  expect(
    owners,
    "events.insert has another outbound path — mutation: paste the Calendar events URL into a second " +
      "Convex module. The approved retrier action must be its sole owner.",
  ).toEqual(["calendar.ts"]);
});

test("calendar event bodies cannot address guests or configure Google invitation delivery", () => {
  const src = readExecutableCode("calendar.ts");
  expect(
    src,
    "calendar.ts no longer contains summary:, so the guest-field absence scan is not reading a real event body.",
  ).toContain("summary:");
  for (const forbidden of ["attendees", "sendUpdates"]) {
    expect(
      src,
      `calendar.ts contains ${forbidden} — mutation: add sendUpdates: "none". events.insert guest ` +
        `delivery is an outbound communication with no plan, requests row, audit event, DLQ, or PII scan.`,
    ).not.toContain(forbidden);
  }
});

test("both Calendar actions check stored scope before the shared token refresh", () => {
  const src = readCode("calendar.ts");
  for (const fn of ["export const freeBusy", "export const createEvent"]) {
    const start = src.indexOf(fn);
    expect(start, `${fn} not found`).toBeGreaterThanOrEqual(0);
    const rest = src.slice(start);
    const end = rest.indexOf("\nexport const", 1);
    const block = end >= 0 ? rest.slice(0, end) : rest;

    const fixtureAt = block.indexOf("getCalendarFixture");
    const scopeAt = block.indexOf("hasScope");
    const tokenAt = block.search(/freshAccessToken\s*\(/);
    expect(scopeAt, `${fn} never checks hasScope`).toBeGreaterThanOrEqual(0);
    expect(tokenAt, `${fn} never CALLS freshAccessToken`).toBeGreaterThanOrEqual(0);
    expect(
      scopeAt,
      `${fn} refreshes before checking scope — mutation: move createEvent's hasScope call below ` +
        `freshAccessToken. A refresh can succeed for a grant that cannot call Calendar.`,
    ).toBeLessThan(tokenAt);
    if (fn.endsWith("freeBusy")) {
      expect(fixtureAt, "freeBusy never checks the calendarFixtures seam").toBeGreaterThanOrEqual(0);
      expect(
        fixtureAt,
        "freeBusy must check the fixture before scope so offline reads need no Google grant.",
      ).toBeLessThan(scopeAt);
    }
  }
});

// 20-07 UPDATED. The arm generalized: its retrier wiring MOVED from inside the switch case into
// `EXTERNAL_TARGETS`, one thunk per occupant. The guard's subject moved with it, so the scan now
// covers BOTH — the table (which target each type gets) and the case (what it may never reach).
// Weakening it to "the arm exists" would have been the easy read of this failure and the wrong one.
test("the externalAction arm wires each occupant's OWN retrier action and non-Node terminal", () => {
  const src = readExecutableCode("cockpit.ts");
  const tableStart = src.indexOf("const EXTERNAL_TARGETS = {");
  expect(tableStart, "cockpit.ts has no EXTERNAL_TARGETS table").toBeGreaterThanOrEqual(0);
  const table = src.slice(tableStart, src.indexOf("} satisfies Record<ExternalActionType", tableStart));

  const start = src.indexOf('case "externalAction"');
  expect(start, "cockpit.ts has no externalAction case").toBeGreaterThanOrEqual(0);
  const rest = src.slice(start);
  const end = rest.indexOf('\n      case "', 1);
  const arm = end >= 0 ? rest.slice(0, end) : rest;

  for (const required of [
    "retrier.run(",
    // Calendar's pair, unchanged — the terminal lives in a NON-node sibling because a "use node"
    // module may hold only actions.
    "internal.calendar.createEvent",
    "onComplete: internal.calendarComplete.onCreateComplete",
    // 20-07: media's pair. The arm's SECOND occupant must get its OWN target, never calendar's.
    "internal.media.submitBatch",
    "onComplete: internal.mediaComplete.onSubmitComplete",
  ]) {
    expect(
      table,
      `EXTERNAL_TARGETS lacks ${required} — mutation: point media's thunk at ` +
        `internal.calendar.createEvent, and a media approval silently books a calendar event.`,
    ).toContain(required);
  }

  // The arm dispatches THROUGH the table rather than naming a target itself — that is what makes a
  // third occupant a compile error at `Record<ExternalActionType, …>` instead of a missed branch.
  expect(
    arm,
    "the externalAction case names a retrier target directly — mutation: inline retrier.run(...) " +
      "back into the case, and a new external type inherits whichever target the code fell through to.",
  ).toContain("EXTERNAL_TARGETS[");

  // 20-07: the MONEY GATE is inside the arm, before the CAS. A media approval that reached the
  // retrier without reserving would spend outside the rail entirely.
  expect(
    arm,
    "the externalAction case does not call reserveJobInner — mutation: drop the media pre-step, " +
      "and a reel is generated with no reservation and no cap.",
  ).toContain("reserveJobInner");

  for (const forbidden of ["workflow.start", "deliverApprovedPlan"]) {
    expect(
      arm,
      `externalAction contains ${forbidden} — mutation: add await workflow.start(...) inside the ` +
        `case. Neither Calendar nor media may ever inherit the Gmail request fan-out.`,
    ).not.toContain(forbidden);
  }
});

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

// ── 15.3-09 (VALT-13): the Google Drive rail ──────────────────────────────────
//
// Two invariants, both statically pinned, because neither has a cheap behavioural test. The
// ordering one is pinned here rather than only in vaultDrive.test.ts so it survives a refactor of
// the test harness; the shared-drive one CANNOT be tested behaviourally at all — a stub is free to
// return whatever it likes, and the live symptom is HTTP 200 with an empty file list.

test("the Drive import checks stored scope before the shared token refresh", () => {
  const src = readCode("vaultDrive.ts");
  const start = src.indexOf("export const importDriveFolder");
  expect(start, "importDriveFolder not found").toBeGreaterThanOrEqual(0);
  const rest = src.slice(start);
  const end = rest.indexOf("\nexport const", 1);
  const block = end >= 0 ? rest.slice(0, end) : rest;

  const scopeAt = block.indexOf("hasScope");
  const tokenAt = block.search(/freshAccessToken\s*\(/);
  expect(scopeAt, "importDriveFolder never checks hasScope").toBeGreaterThanOrEqual(0);
  expect(tokenAt, "importDriveFolder never CALLS freshAccessToken").toBeGreaterThanOrEqual(0);
  expect(
    scopeAt,
    "importDriveFolder refreshes before checking scope — mutation: move the hasScope call below " +
      "freshAccessToken. `include_granted_scopes` is FORWARD-only, so every tenant connected before " +
      "the Drive widening holds a token that refreshes fine and 403s on the first Drive call. " +
      "Checking after the refresh turns a permanent reconnect condition into a provider failure.",
  ).toBeLessThan(tokenAt);
});

test("every Drive request carries the shared-drive parameters", () => {
  const src = readExecutableCode("vaultDrive.ts");

  // `supportsAllDrives` is set ONCE, in the URL builder every Drive call goes through — that is the
  // invariant, not "it appears N times". Pin the chokepoint instead of counting call sites.
  expect(
    src,
    "vaultDrive.ts no longer sets supportsAllDrives in driveUrl — mutation: delete it. A " +
      "shared-drive folder then returns HTTP 200 with an EMPTY files array and the product reports " +
      "'imported 0 files, folder complete'. A lying folder is worse than a failed one.",
  ).toMatch(/driveUrl[\s\S]{0,400}supportsAllDrives:\s*["']true["']/);

  const buildersBypassingHelper = [...src.matchAll(/fetch\(\s*`https:\/\/www\.googleapis\.com/g)];
  expect(
    buildersBypassingHelper,
    "vaultDrive.ts builds a googleapis URL inline instead of through driveUrl — that path would " +
      "carry neither shared-drive parameter.",
  ).toHaveLength(0);

  expect(
    src,
    "vaultDrive.ts no longer sets includeItemsFromAllDrives — mutation: delete it from the " +
      "files.list projection. supportsAllDrives alone does NOT make a shared drive's children " +
      "visible to files.list; both are required, and only on the list call.",
  ).toContain('includeItemsFromAllDrives: "true"');
});

test("the Drive audit payload cannot carry a file or folder NAME", () => {
  const src = readExecutableCode("vaultDrive.ts");
  const payloads = [...src.matchAll(/payload:\s*\{([\s\S]*?)\n {6}\}/g)].map((m) => m[1] ?? "");
  expect(payloads.length, "no Drive audit payload found — the scan is vacuous").toBeGreaterThan(0);
  for (const payload of payloads) {
    for (const forbidden of ["name", "title", "fileNames", "filename"]) {
      // Matches BOTH `name: x` and the shorthand `name,`. Testing only for `name:` was the first
      // version of this assertion, and the mutation run walked straight through it — `{ name, }`
      // is exactly how a leak would actually be written.
      expect(
        new RegExp(`(^|[{,\\s])${forbidden}\\s*[,:}\\n]`).test(payload),
        `a vaultDrive audit payload carries \`${forbidden}\` — mutation: add a fileNames array. ` +
          `A Drive file name is user content and §4 makes audit refs/hashes/ids/counts ONLY.`,
      ).toBe(false);
    }
  }
});
