// The cockpit CRM plan card's one piece of logic: turning a staged operation list into the exact
// sentences the human reads before Approve (19-06, ACTN-05).
//
// It is a pure function on purpose. The card must show EXACTLY what will be written, and the
// formatter reads the list through `parseCrmOperations` — the SAME validator `executePlan` runs at
// the apply boundary — so the card cannot promise something the server would refuse.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { describeCrmOperations } from "./cards";

const DUE = Date.parse("2026-08-14T09:00:00.000Z");

describe("describeCrmOperations (the CRM plan card's line list)", () => {
  test("one plain-language line per operation, in the staged order", () => {
    const lines = describeCrmOperations([
      { op: "addContact", email: "  Bob@X.com ", name: "Bob", origin: "user-entered" },
      { op: "addContact", email: "ann@y.com", origin: "mailbox-resolved" },
      { op: "addFollowUp", email: "bob@x.com", note: "chase the quote", dueAt: DUE },
      { op: "completeFollowUp", followUpRef: "k1" },
      { op: "cancelFollowUp", followUpRef: "k2" },
    ]);

    expect(lines).toHaveLength(5);
    // The address the card shows is the NORMALIZED one — the same key the row is written under, so
    // the card cannot name one person and the database another.
    expect(lines[0]).toBe("Add contact: bob@x.com (Bob)");
    expect(lines[1]).toBe("Add contact: ann@y.com");
    expect(lines[2]).toContain("Follow up with bob@x.com by ");
    expect(lines[2]).toContain(" — chase the quote");
    expect(lines[3]).toBe("Mark a follow-up done");
    expect(lines[4]).toBe("Cancel a follow-up");
  });

  // The card renders this as "nothing to approve" and hides the Approve button. A card offering to
  // approve a list the applier will refuse is worse than one that says it is broken.
  test("THROWS on a list the applier would refuse, rather than rendering a partial promise", () => {
    expect(() => describeCrmOperations([])).toThrow(/CRM_OPERATIONS_EMPTY/);
    expect(() => describeCrmOperations(undefined)).toThrow(/CRM_OPERATIONS_NOT_A_LIST/);
    expect(() =>
      describeCrmOperations([{ op: "addFollowUp", email: "bob@x.com", note: "no date" }]),
    ).toThrow(/CRM_FOLLOWUP_DUEAT_REQUIRED/);
  });
});

// ── THE CLOCKLESS-CALLER SCAN (phase-19 UAT step 7) ──────────────────────────────────
// **This is NOT the regression guard for that defect** — `e2e/pipeline-uat.spec.ts` step 7 is, and
// it has to be, because no unit test can observe that the SHIPPED browser never sent
// `clientContext`. Every offline layer was green while `stageCrmWrite` refused `no_clock` on every
// human turn for the whole of phase 17-19, and the eval gate supplied its own clock.
//
// What this DOES catch is the next instance of the same mistake: a NEW component wiring
// `sendCockpitMessage` up by hand and forgetting the clock again. The browser test only drives
// ChatPane, so it would stay green while a fresh caller shipped broken. Mutation that turns this
// red: replace `useSendCockpitMessage()` in any of the five callers with the raw `useAction`.
describe("every browser caller of sendCockpitMessage carries the trusted clock", () => {
  const hereDir = dirname(fileURLToPath(import.meta.url));
  const webApp = resolve(hereDir, "../../.."); // apps/web/app — every route lives under it
  const HOOK = join(hereDir, "useSendCockpitMessage.ts");

  const sources = (function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  })(webApp);

  test("the scan actually reads the app tree (non-vacuity)", () => {
    expect(sources.length).toBeGreaterThan(20);
    expect(sources).toContain(HOOK);
    // and the five known callers are really in it
    expect(
      sources.filter((f) => readFileSync(f, "utf8").includes("useSendCockpitMessage(")).length,
    ).toBeGreaterThanOrEqual(6); // 5 callers + the hook's own definition
  });

  test("no component constructs the action directly — the hook is the only door", () => {
    const raw = sources.filter(
      (file) =>
        file !== HOOK &&
        /useAction\(\s*api\.cockpit\.sendCockpitMessage\s*\)/.test(readFileSync(file, "utf8")),
    );
    expect(
      raw.map((f) => relative(webApp, f)),
      "these call sendCockpitMessage without clientContext — use useSendCockpitMessage()",
    ).toEqual([]);
  });

  test("the hook reads the clock at CALL time, not at render", () => {
    const src = readFileSync(HOOK, "utf8");
    // `Date.now()` must sit inside the returned callback; a mounted chat pane can be hours old.
    expect(src).toMatch(/useCallback\([\s\S]*Date\.now\(\)[\s\S]*\)/);
    expect(src).toContain("clientContext");
    // tz must never be undefined: `v.string()` would throw the whole turn away at the validator.
    expect(src).toContain('"UTC"');
  });
});
