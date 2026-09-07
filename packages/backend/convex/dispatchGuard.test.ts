// @vitest-environment node
//
// Static-scan enforcement of Phase 15's structural invariants (DISP-01 / ACTN-01). Mirrors the
// llmRedaction.test.ts / auditImmutability.test.ts idiom: read the source off disk, strip comments
// (prose may NAME the forbidden thing — that is the documentation), assert on what remains.
import { readdirSync, readFileSync } from "node:fs";
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

/** Every `generateText(...)` call in a file, balanced-paren sliced, with its source offset (the
 *  offset is what lets a call be attributed to the function it sits in). */
function generateTextCalls(file: string): { text: string; index: number }[] {
  const src = readCode(file);
  const out: { text: string; index: number }[] = [];
  for (const m of src.matchAll(/generateText\(/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    out.push({ text: src.slice(m.index, i), index: m.index });
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
  const toolBearing = calls.filter((c) => /\btools\s*[,:]/.test(c.text));

  // `probeGemini` is the ONE deliberate exception (2026-08-07), excluded BY POSITION rather than by
  // relaxing the count to 2 — a bare `.toBe(2)` would silently admit a real second tenant loop the
  // day someone adds one, which is the entire failure this test exists to catch.
  //
  // Why it is genuinely exempt rather than grandfathered: it is an operator `internalAction`, never
  // nested inside `runAgentLoop` and never reached by a tenant request. It draws NO rail (it REPORTS
  // the cost it would have drawn), so it cannot double-bill the spend window, and it carries its own
  // `stopWhen`. It bears tools because that IS its job — sending the production hosted-search
  // descriptor is the only way to learn whether the vendor accepts it.
  const src = readCode("llm.ts");
  const probeStart = src.indexOf("export const probeGemini");
  expect(
    probeStart,
    "probeGemini is gone — DELETE this exclusion rather than leaving it dangling, or the next " +
      "tool-bearing loop added to llm.ts inherits its exemption",
  ).toBeGreaterThan(-1);
  // The next top-level `export` bounds the handler; slicing to end-of-file would exempt everything
  // written after it.
  const probeEnd = src.indexOf("\nexport ", probeStart + 1);
  const inProbe = toolBearing.filter(
    (c) => c.index > probeStart && (probeEnd < 0 || c.index < probeEnd),
  );
  // Non-vacuity in the OTHER direction, and it is the one that matters for Phase 16: if the probe
  // stops sending a tool, `probe:gemini --grounded` measures nothing while still printing PASS —
  // the vacuous green this whole probe was written to avoid.
  expect(
    inProbe.length,
    "probeGemini no longer passes `tools` — `--grounded` would report PASS having never asked the " +
      "vendor to search",
  ).toBe(1);

  expect(
    toolBearing.length - inProbe.length,
    `llm.ts has ${toolBearing.length - inProbe.length} tool-bearing generateText call sites ` +
      `outside probeGemini — runAgentLoop must remain THE one loop. A second one double-bills the ` +
      `daily spend window (preCall only ever sees the outer call) and voids stopWhen: stepCountIs(8).`,
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
    // 17-08: management is a WRITE behind the same Approve gate, so it inherits the same absence.
    // The model may propose a change (17-09 stages one); it may never perform it, and it may never
    // reach the terminal that records one as having happened.
    /\b(?:internal|api)\.calendar\.manageEvent\b/,
    /\b(?:internal|api)\.microsoftCalendar\.patchEvent\b/,
    // The registry WRITERS. A tool that could patch `calendarEvents` could make the row disagree
    // with the provider — and every refusal `manageability` returns reads from that row.
    /\b(?:internal|api)\.calendarEvents\.(?:upsertManaged|applyUpdate|markDeleted|migrateLegacyCalendarEvents)\b/,
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

  // `sendUpdates` has no legitimate read use — Google accepts it only as a REQUEST parameter, and
  // its only effect is to email people. Absent from the module entirely.
  expect(
    src,
    'calendar.ts contains sendUpdates — mutation: add sendUpdates: "none". Guest delivery is an ' +
      "outbound communication with no plan, requests row, audit event, DLQ, or PII scan.",
  ).not.toContain("sendUpdates");

  // `attendees` is NARROWER since 17-08, and deliberately so: management must READ the guest list
  // to refuse an event that grew one, so a blanket ban would forbid the very check that protects
  // people. What stays banned is the WRITE form — `attendees` as an object-literal key, which is
  // the only shape that can address anyone. `attendees?:` (a type field) and `body.attendees` (a
  // read) do not match; `attendees: [...]` in a request body does.
  expect(
    src,
    "calendar.ts uses attendees as an object-literal key — mutation: put attendees: [...] in an " +
      "event body. Reading the guest COUNT is the refusal; writing a guest list is an invitation.",
  ).not.toMatch(/attendees\s*:/);
  // Anti-vacuity: the read must actually still be there, or the ban above is guarding nothing and
  // the attendee refusal has silently stopped inspecting anything.
  expect(
    src,
    "calendar.ts no longer reads body.attendees — the attendee refusal cannot be inspecting a real " +
      "guest list, so the write-form ban above is vacuous.",
  ).toContain("body.attendees");
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
      expect(fixtureAt, "freeBusy never checks the calendarFixtures seam").toBeGreaterThanOrEqual(
        0,
      );
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
  const table = src.slice(
    tableStart,
    src.indexOf("} satisfies Record<ExternalActionType", tableStart),
  );

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
    // 17-08: management's pair. The arm's THIRD occupant. Its terminal is separate from
    // `onCreateComplete` because the two write different tables, different audit names and
    // different terminal states — a shared one would let a manage result mark a create done.
    "internal.calendar.manageEvent",
    "onComplete: internal.calendarComplete.onManageComplete",
  ]) {
    expect(
      table,
      `EXTERNAL_TARGETS lacks ${required} — mutation: point media's thunk at ` +
        `internal.calendar.createEvent, and a media approval silently books a calendar event.`,
    ).toContain(required);
  }

  // Three occupants, three DISTINCT pairs. The required strings above prove each one is PRESENT;
  // only counting distinct values proves none was REUSED — a manage thunk pointed at
  // `onCreateComplete` would satisfy every `toContain` above.
  const targets = [...table.matchAll(/internal\.\w+\.\w+,/g)].map((m) => m[0]);
  const terminals = [...table.matchAll(/onComplete: internal\.\w+\.\w+/g)].map((m) => m[0]);
  expect(new Set(targets).size, `EXTERNAL_TARGETS reuses a retrier action: ${targets}`).toBe(3);
  expect(
    new Set(terminals).size,
    `EXTERNAL_TARGETS reuses a terminal: ${terminals} — mutation: point calendar_manage at ` +
      `onCreateComplete, and a management result marks a CREATE plan done.`,
  ).toBe(3);

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

test("proposeCalendarChange is inspect-then-stage only; no provider writer or Approve gate is reachable", () => {
  const src = readExecutableCode("llm.ts");
  const start = src.indexOf("proposeCalendarChange: tool({");
  expect(start, "llm.ts has no proposeCalendarChange tool").toBeGreaterThanOrEqual(0);
  const end = src.indexOf("checkAvailability: tool({", start);
  expect(end, "calendar-management tool has no bounded source slice").toBeGreaterThan(start);
  const toolBody = src.slice(start, end);

  const inspect = toolBody.indexOf("internal.calendar.inspectEvent");
  const stage = toolBody.indexOf("internal.calendarEvents.stageChange");
  expect(inspect, "mutation: skip provider inspection and stage the stored etag").toBeGreaterThan(
    0,
  );
  expect(stage, "mutation: inspect but never persist the fresh snapshot").toBeGreaterThan(inspect);
  expect(toolBody.match(/internal\.calendarEvents\.stageChange/g)).toHaveLength(1);

  for (const forbidden of [
    "internal.calendar.createEvent",
    "internal.calendar.manageEvent",
    "internal.cockpit.executePlan",
    "internal.calendarComplete",
    "retrier.run",
    "fetch(",
  ]) {
    expect(
      toolBody,
      `calendar staging names ${forbidden} — a model-reachable proposal must perform no provider ` +
        "write, terminal transition, or approval",
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

// EVERY Drive action, not just the import. `listDriveFolders` is the one a pre-widening tenant hits
// FIRST — it is what draws the picker — so getting the ordering right only in the import would put
// the 403 on the very first click.
test("every Drive action checks stored scope before the shared token refresh", () => {
  const src = readCode("vaultDrive.ts");
  // 29-02: `findInDrive`'s gate moved into `runDriveSearch`, the ONE function both the cockpit
  // tool and the identity-less knowledge adapter route through. Scanning the wrapper would now
  // find no gate at all and pass vacuously, so the scan follows the gate — and the assertion
  // below pins that neither wrapper grew a second copy of it.
  for (const fn of [
    "export const importDriveFolder",
    "export const listDriveFolders",
    "async function runDriveSearch",
  ]) {
    const start = src.indexOf(fn);
    expect(start, `${fn} not found`).toBeGreaterThanOrEqual(0);
    const rest = src.slice(start);
    const end = rest.indexOf("\nexport const", 1);
    const block = end >= 0 ? rest.slice(0, end) : rest;

    const scopeAt = block.indexOf("hasScope");
    const tokenAt = block.search(/freshAccessToken\s*\(/);
    expect(scopeAt, `${fn} never checks hasScope`).toBeGreaterThanOrEqual(0);
    expect(tokenAt, `${fn} never CALLS freshAccessToken`).toBeGreaterThanOrEqual(0);
    expect(
      scopeAt,
      `${fn} refreshes before checking scope — mutation: move the hasScope call below ` +
        `freshAccessToken. \`include_granted_scopes\` is FORWARD-only, so every tenant connected ` +
        `before the Drive widening holds a token that refreshes fine and 403s on the first Drive ` +
        `call. Checking after the refresh turns a permanent reconnect condition into a provider ` +
        `failure.`,
    ).toBeLessThan(tokenAt);
  }
});

test("both Drive search entry points share ONE gate and neither re-implements it", () => {
  const src = readCode("vaultDrive.ts");
  for (const fn of ["export const findInDrive", "export const findInDriveForTenant"]) {
    const start = src.indexOf(fn);
    expect(start, `${fn} not found`).toBeGreaterThanOrEqual(0);
    const rest = src.slice(start);
    const end = rest.indexOf("\nexport const", 1);
    const block = end >= 0 ? rest.slice(0, end) : rest;

    expect(block, `${fn} does not route through runDriveSearch`).toContain("runDriveSearch(");
    expect(
      block,
      `${fn} calls freshAccessToken itself — mutation: inline the token gate into either ` +
        `wrapper. Two copies of a scope-before-refresh ordering is how one of them silently ` +
        `drifts, and the identity-less knowledge path is the copy nobody clicks.`,
    ).not.toMatch(/freshAccessToken\s*\(/);
    expect(block, `${fn} checks hasScope itself instead of through the shared gate`).not.toContain(
      "hasScope",
    );
  }
});

test("cockpit Drive reads cannot import, ingest, export, or enter specialist grants", () => {
  const src = readExecutableCode("llm.ts");
  const listStart = src.indexOf("listDriveFolders: tool(");
  const findStart = src.indexOf("findInDrive: tool(");
  const end = src.indexOf("searchVault: tool(", findStart);
  expect(listStart).toBeGreaterThanOrEqual(0);
  expect(findStart).toBeGreaterThan(listStart);
  expect(end).toBeGreaterThan(findStart);
  const driveTools = src.slice(listStart, end);

  expect(driveTools).toContain("api.vaultDrive.listDriveFolders");
  expect(driveTools).toContain("api.vaultDrive.findInDrive");
  for (const forbidden of [
    "importDriveFolder",
    "reserveFolder",
    "openRun",
    "exportOne",
    "landFile",
    "ingest",
  ]) {
    expect(driveTools, `Drive cockpit reads contain forbidden ${forbidden}`).not.toContain(
      forbidden,
    );
  }

  const specialists = readFileSync(join(convexDir, "../../core/src/specialists.ts"), "utf8");
  const grant = specialists.slice(
    specialists.indexOf("const SPECIALIST_TOOLS"),
    specialists.indexOf("export const SPECIALISTS"),
  );
  expect(grant).not.toContain("listDriveFolders");
  expect(grant).not.toContain("findInDrive");
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

// ── 17-08 Task 3: the management write surface, pinned by construction ────────────────────────
//
// ADR-023 makes an ABSENCE the product decision: Microsoft cancel/delete is not merely unused, it
// must be unreachable. An absence is exactly the thing a future executor "fixes" without noticing,
// so these read the source rather than the behaviour.

const CALENDAR_MODULES = [
  "calendar.ts",
  "microsoftCalendar.ts",
  "calendarComplete.ts",
  "calendarEvents.ts",
];

test("no calendar module can reach a provider CANCELLATION endpoint", () => {
  for (const file of CALENDAR_MODULES) {
    const src = readExecutableCode(file);
    // Graph's `/cancel` and Google's `sendUpdates` both EMAIL the attendees on the app's behalf —
    // an outbound external communication with no plan row, no audit event, no dead letter and no
    // redaction pass. They are out of the vocabulary entirely, not guarded by a parameter default.
    expect(
      src,
      `${file} contains /cancel — mutation: map a Microsoft delete to the /cancel action. It mails ` +
        `every attendee outside the governed send path.`,
    ).not.toContain("/cancel");
    expect(
      src,
      `${file} contains sendUpdates — mutation: add sendUpdates: "all" to a Calendar write.`,
    ).not.toContain("sendUpdates");
  }
});

test("microsoftCalendar.ts issues NO Graph DELETE outside the disposable probe", () => {
  const src = readExecutableCode("microsoftCalendar.ts");
  const probeAt = src.indexOf("export const graphConcurrencyProbe");
  expect(probeAt, "graphConcurrencyProbe is gone — the scan below has no landmark").toBeGreaterThan(
    0,
  );

  const deletes = [...src.matchAll(/method:\s*["']DELETE["']/g)].map((m) => m.index ?? -1);
  // Anti-vacuity: the probe DOES delete (it cleans up after itself), so a zero here means the
  // landmark moved or the scan stopped matching, not that the module got safer.
  expect(
    deletes.length,
    "no DELETE found in microsoftCalendar.ts at all — the probe cleans up after itself, so this " +
      "scan is no longer reading what it thinks it is.",
  ).toBeGreaterThan(0);
  for (const at of deletes) {
    expect(
      at,
      "microsoftCalendar.ts has a Graph DELETE outside graphConcurrencyProbe — mutation: let a " +
        "Microsoft delete fall through to a Graph DELETE. ADR-023: the 17-07 probe measured " +
        "staleDeleteStatus 204 with staleDeletePreserved false, so Graph IGNORES If-Match on event " +
        "DELETE and a stale delete destroys the event anyway. There is no safe version of this call.",
    ).toBeGreaterThan(probeAt);
  }
});

test("the Graph CALENDAR paths have exactly one non-test owner", () => {
  // Scoped to the CALENDAR paths, not the Graph base URL: `graph.ts` legitimately owns
  // `/me/sendMail` (DLVR-02, the Microsoft send adapter), and ADR-018 is precisely the decision
  // that ONE grant serves both planes from two modules. What must stay singular is the calendar
  // surface — otherwise "no Graph DELETE exists" is a claim about one file while another writes.
  const owners = readdirSync(convexDir)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .filter((file) => {
      const src = readFileSync(join(convexDir, file), "utf8");
      return src.includes("me/calendar/events") || src.includes("me/calendarView");
    });
  expect(
    owners,
    "a Graph calendar path has another outbound owner — mutation: paste the events URL into a " +
      "second Convex module. microsoftCalendar.ts must be its sole owner, or 'no Graph DELETE " +
      "exists' becomes a claim about one file while another one writes.",
  ).toEqual(["microsoftCalendar.ts"]);
});

test("the Microsoft PATCH body carries no guest, notification or content field", () => {
  const src = readExecutableCode("microsoftCalendar.ts");
  const at = src.indexOf("export const patchEvent");
  expect(at, "patchEvent is gone — this scan has nothing to read").toBeGreaterThan(0);
  // Scoped to the SERIALIZED EVENT OBJECT, not the whole function: the fetch init has its own
  // `body:` property (the request body), so a naive scan for "body:" flags the correct code.
  const fn = src.slice(at);
  const payloadAt = fn.indexOf("JSON.stringify({");
  expect(payloadAt, "patchEvent no longer serializes an event object").toBeGreaterThan(0);
  const body = fn.slice(payloadAt, fn.indexOf("}),", payloadAt));
  expect(
    body,
    "patchEvent no longer sends subject: — the field-absence scan below is not reading a real body.",
  ).toContain("subject:");
  for (const forbidden of ["attendees", "isReminderOn", "responseRequested", "body:", "location"]) {
    expect(
      body,
      `patchEvent sets ${forbidden} — mutation: add it to the PATCH body. A PATCH that adds guests ` +
        `mails them an invitation from an approved plan that never mentioned anyone.`,
    ).not.toContain(forbidden);
  }
  // The whole point of the write, and it lives in the HEADERS, not the serialized body.
  expect(
    fn,
    'patchEvent lost its If-Match header — mutation: drop "If-Match" and PATCH unconditionally. ' +
      "ADR-023 names this forbidden: the gap between the read and the write IS the race.",
  ).toContain('"If-Match"');
});

test("the Microsoft update gate is read from the probe, not from a constant", () => {
  const src = readExecutableCode("microsoftCalendar.ts");
  for (const required of ["microsoftUpdateEnabled", "parseGraphProbe", "PHASE17_GRAPH_PROBE"]) {
    expect(
      src,
      `microsoftCalendar.ts no longer references ${required} — mutation: replace the gate with ` +
        `\`const enabled = true\`, and Microsoft writes on a deployment nothing was ever measured on.`,
    ).toContain(required);
  }
  // `providerSupports` decides Microsoft DELETE and must NOT be reachable from the probe gate —
  // ADR-023 requires a superseding ADR to widen delete, never a measurement.
  expect(
    readExecutableCode("calendar.ts"),
    "calendar.ts no longer calls providerSupports — mutation: delete the call, and a Microsoft " +
      "cancel falls through to the provider branch instead of refusing before any token.",
  ).toContain("providerSupports(");
});

// ── 42-02: THE MONEY OPTION ON THE DURABLE STEP ───────────────────────────────────────────────
//
// The failure mode this guards is an OMISSION, which is why it is a source scan and not a
// behavioural test. `dispatchRun.ts`'s one `step.runAction` calls a PAID specialist turn. The
// shared WorkflowManager sets `retryActionsByDefault: true` with `maxAttempts: 3` (index.ts:10-11),
// and `runSpecialistTurn` bills the model and draws the rail down through `recordSpend` before any
// throw can be caught — so a step written without `{ retry: false }` re-bills a failed turn three
// times. The compiler accepts it, biome accepts it, and every behavioural test stays green.
//
// The whole point of ONE define with a `kind` switch rather than three defines is that one call
// site cannot be half-omitted. This test pins that arithmetic too: exactly one, carrying the option.

test("dispatchRun.ts has exactly ONE step.runAction and it carries { retry: false }", () => {
  const src = readExecutableCode("dispatchRun.ts");
  const calls = src.match(/step\.runAction\(/g) ?? [];
  // Non-vacuity floor: if the call disappears entirely, the `every` below would pass over nothing.
  expect(
    calls.length,
    "dispatchRun.ts no longer has exactly one step.runAction — mutation: split the one define " +
      "into several, and a retry option can be omitted from one of them unnoticed.",
  ).toBe(1);
  expect(
    src,
    "the durable step lost { retry: false } — mutation: delete the option, and a failed PAID " +
      "specialist turn is re-billed up to three times by the shared WorkflowManager's default.",
  ).toMatch(/step\.runAction\([^;]*retry:\s*false/);
});

// The other half of the same rule: the three ENTRY POINTS must no longer be started bare. A
// `scheduler.runAfter` straight at `internal.dispatch.run*` skips the workflow, so it skips the
// journal AND the onComplete terminal — a run that dies mid-action then leaves its plan row at
// `collecting` with nothing to land it.
test("no caller schedules a dispatch entry point directly any more (42-02)", () => {
  for (const file of ["evaluations.ts", "llm.ts"]) {
    expect(
      readExecutableCode(file),
      `${file} still schedules internal.dispatch.run* directly — mutation: revert a starter to ` +
        `scheduler.runAfter, and that run loses both the journal and its onComplete landing.`,
    ).not.toMatch(/runAfter\([^)]*internal\.dispatch\.run/);
  }
});
