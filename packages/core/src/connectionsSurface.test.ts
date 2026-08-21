import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { GOOGLE_SCOPES } from "./calendar";
import { MICROSOFT_SCOPES } from "./microsoft";

// These files live in `apps/web`, outside this package. Reading them by path is the established
// repo idiom for asserting a guarantee that lives in the UI — see the profile source scan in
// `businessProfile.test.ts` and `traceParity.test.ts` in packages/backend.
const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8");

const WEB = "apps/web/app/(app)";
const button = read(`${WEB}/_components/DisconnectGoogle.tsx`);
const connectPage = read(`${WEB}/connect-gmail/page.tsx`);
const msButton = read(`${WEB}/_components/DisconnectMicrosoft.tsx`);
const msConnectPage = read(`${WEB}/connect-microsoft/page.tsx`);
const panel = read(`${WEB}/dashboard/profile/ConnectionsPanel.tsx`);
const data = read(`${WEB}/dashboard/profile/connections.ts`);
const profilePage = read(`${WEB}/dashboard/profile/page.tsx`);
// NOT under `${WEB}` — the policy is a public page, outside the authenticated app.
const privacyPage = read("apps/web/app/privacy/page.tsx");

// The exact user-facing sentence. If the Google scope changes, this string changes in ONE place.
const CONFIRM =
  "Disconnect Google? Pikar will lose access to your mail, your calendar AND your Drive.";

describe("DisconnectGoogle is the single writer of the disconnect copy", () => {
  // Non-vacuity FIRST. Every assertion below is a `not.toContain`, and a `not.toContain` over an
  // empty or wrong string passes forever. `readFileSync` throws on a missing path; this catches
  // the subtler case of reading a file that no longer holds what we think it does.
  test("both files are really being scanned", () => {
    expect(button.length).toBeGreaterThan(300);
    expect(button).toContain("export function DisconnectGoogle");
    expect(connectPage.length).toBeGreaterThan(500);
    expect(connectPage).toContain("api.gmailAuth.gmailConnectUrl");
  });

  test("the confirm copy lives in the shared component", () => {
    expect(button).toContain(CONFIRM);
  });

  test("connect-gmail no longer declares its own copy of the confirm or the action", () => {
    expect(connectPage).not.toContain(CONFIRM);
    expect(connectPage).not.toContain("api.gmailAuth.disconnectGoogle");
    expect(connectPage).toContain("DisconnectGoogle");
  });

  test("a revoke that Google did not confirm is not reported as a clean disconnect", () => {
    // deleteTokens runs UNCONDITIONALLY in the action, so `revoked: false` means our copy is gone
    // but Google may still hold the grant. The component must branch on it.
    expect(button).toContain("revoked");
    expect(button).toContain("myaccount.google.com/permissions");
  });
});

// Finds the substring between `<condition> ? (` and the matching close-paren by counting
// parens, so nested JSX inside the branch (extra `(` / `)` from other expressions) doesn't fool a
// naive regex. Returns null if the exact ternary literal isn't present at all.
function ternaryTrueBranch(source: string, condition: string): string | null {
  const marker = `${condition} ? (`;
  const openIdx = source.indexOf(marker) + marker.length - 1; // index of the opening "("
  if (openIdx < marker.length - 1) return null; // indexOf returned -1
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) return source.slice(openIdx + 1, i);
    }
  }
  return null;
}

describe("DisconnectGoogle's revoked:false warning is reachable — it must outlive connected:false", () => {
  // The whole bug this guards: `disconnectGoogle` deletes the local token row UNCONDITIONALLY
  // before returning, so `gmailStatus` flips to `connected: false` the instant the action
  // resolves — including on a partial revoke (`revoked: false`). If the CALLER decided whether to
  // mount <DisconnectGoogle /> from that same `connected` flag, the component (and its warning)
  // would unmount before a human could ever read it. The fix: the component owns its own
  // subscription and neither call site gates its mount on connection state.

  test("DisconnectGoogle carries its own gmailStatus subscription", () => {
    expect(button).toContain("useQuery(api.gmailAuth.gmailStatus)");
  });

  test("ConnectionsPanel does not wrap <DisconnectGoogle /> inside a status.connected ternary", () => {
    const branch = ternaryTrueBranch(panel, "status.connected");
    // No such ternary at all is fine (that's the fixed shape); if one exists, it must not be
    // the thing gating the button's mount.
    if (branch !== null) expect(branch).not.toContain("DisconnectGoogle");
    // Guard the guard: the panel must still actually render the control somewhere unconditional.
    expect(panel).toContain("<DisconnectGoogle");
  });

  test("connect-gmail does not wrap <DisconnectGoogle /> inside a status.connected ternary", () => {
    const branch = ternaryTrueBranch(connectPage, "status.connected");
    if (branch !== null) expect(branch).not.toContain("DisconnectGoogle");
    expect(connectPage).toContain("<DisconnectGoogle");
  });
});

describe("the blocked rows are information, not decoration", () => {
  test("the data module and panel are really being scanned", () => {
    expect(data.length).toBeGreaterThan(300);
    expect(data).toContain("export const BLOCKED");
    expect(panel).toContain("export function ConnectionsPanel");
  });

  // `connections.ts` holds ONLY the array, so these two keys cannot collide with anything else in
  // the file — which is why the data lives in its own module instead of inside the .tsx.
  test("every blocked entry carries a non-empty blocker", () => {
    const labels = data.match(/^\s*label:/gm) ?? [];
    const blockers = data.match(/^\s*blocker:/gm) ?? [];
    expect(labels.length).toBeGreaterThanOrEqual(3);
    expect(blockers.length).toBe(labels.length);
    expect(data).not.toMatch(/blocker:\s*""/);
  });

  test("every blocked entry carries a ponytail comment naming what clears it", () => {
    const ponytails = data.match(/ponytail:/g) ?? [];
    const labels = data.match(/^\s*label:/gm) ?? [];
    expect(ponytails.length).toBe(labels.length);
  });

  // A dead "Connect" button that does nothing is the exact failure this tab exists to avoid.
  test("the blocked rows expose no interactive control", () => {
    const start = panel.indexOf("BLOCKED.map(");
    expect(start, "BLOCKED.map( not found — the scan below would be vacuous").toBeGreaterThan(-1);
    const block = panel.slice(start, panel.indexOf("</section>", start));
    expect(block.length).toBeGreaterThan(100);
    expect(block).not.toContain("onClick");
    expect(block).not.toContain("<button");
    expect(block).not.toContain("href");
  });

  test("loading is never rendered as disconnected", () => {
    // A false "Not connected" invites reconnecting an already-connected account.
    expect(panel).toContain("Checking…");
    expect(panel).toContain("status === undefined");
  });

  test("the profile page mounts the tab", () => {
    expect(profilePage).toContain('id: "connections"');
    expect(profilePage).toContain("<ConnectionsPanel />");
  });
});

// ── The scope-copy sweep (15.3-09 follow-up) ─────────────────────────────────
//
// THE DEFECT THIS EXISTS FOR, WHICH ALREADY HAPPENED ONCE. 15.3-09 appended `drive.readonly` to
// GOOGLE_SCOPES and updated NONE of the three surfaces that tell a human what the grant covers:
// the consent page still promised only mail and calendar, the disconnect confirm still named only
// mail and calendar, and the connections row was still labelled "Gmail & Calendar". The user was
// therefore asked to grant read access to their entire Drive on a page that did not mention Drive.
//
// A scope is a PROMISE to a person, not a config value. These assertions make the promise and the
// grant fail together: add a fourth capability to GOOGLE_SCOPES and this suite is red until every
// surface that speaks to the user has been told about it.

// ── The Microsoft scope-copy sweep (17-06, ADR-018) ──────────────────────────
//
// Same rule as the Google sweep below, with one extra edge that makes it MORE necessary here, not
// less: ADR-018 requests the union grant so the user consents once, which means `Mail.Send` and
// `Mail.Read` are granted NOW while no mail code ships until 25-06. A consent screen describing
// only "the calendar feature shipping this week" would be asking for a permission it does not
// mention — ADR-018 consequence 6 names that as the defect these assertions exist to prevent.
describe("every user-facing surface names every capability in the Microsoft grant", () => {
  // Keep in step with `MICROSOFT_SCOPES` in microsoft.ts.
  const MS_CAPABILITIES = ["calendar", "mail"] as const;

  // Comments stripped for the same reason the Google sweep strips them: the ⚠ comment beside the
  // consent copy naturally says "mail" while EXPLAINING the rule, and would satisfy every assertion
  // on its own. Only rendered copy counts.
  const copyOnly = (src: string): string =>
    src.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "").replace(/\/\/[^\n]*/g, "");

  const msConnectCopy = copyOnly(msConnectPage);
  const msPanelCopy = copyOnly(panel);
  const msConfirmCopy = copyOnly(msButton);

  test("the scan is reading real copy, not an empty string", () => {
    expect(msConnectPage.length).toBeGreaterThan(500);
    expect(msConnectCopy).toContain("Pikar needs your consent");
    expect(msButton).toContain("export function DisconnectMicrosoft");
    expect(msConfirmCopy).toContain("Disconnect Microsoft?");
  });

  test("the consent page names all of them — it IS the consent", () => {
    for (const capability of MS_CAPABILITIES) {
      expect(
        new RegExp(capability, "i").test(msConnectCopy),
        `the Microsoft connect page never says "${capability}" — a user cannot consent to a ` +
          `capability the consent screen does not mention. Widen MICROSOFT_SCOPES, widen this sentence.`,
      ).toBe(true);
    }
  });

  test("the consent page is honest that mail is granted before it is used", () => {
    // The specific ADR-018 consequence-6 promise: not merely naming mail, but saying WHY it is
    // being requested now. Without this the page reads as over-asking.
    expect(msConnectCopy).toMatch(/not switched on yet|only have to approve/i);
  });

  test("the disconnect confirm names all of them — it is what the user gives up", () => {
    for (const capability of MS_CAPABILITIES) {
      expect(
        new RegExp(capability, "i").test(msConfirmCopy),
        `the Microsoft disconnect copy never says "${capability}" — someone reading "disconnect ` +
          `Microsoft" would not expect that capability to stop working.`,
      ).toBe(true);
    }
  });

  // THE DIVERGENCE FROM GOOGLE THAT MUST NOT BE QUIETLY "FIXED". There is no revocation endpoint
  // in the v2 delegated flow, so every surface must say the grant survives on the user's account.
  // A future edit that copies DisconnectGoogle's wording wholesale turns this red.
  test("the Microsoft disconnect never claims a revocation it cannot perform", () => {
    // 25-06 Task 2, decided 2026-08-17: naming "My Apps" ALONE used to satisfy this test, and it
    // was WRONG for most users. My Apps is the work/school portal; a personal Microsoft account
    // holder sent there lands somewhere that will never list Pikar. The private beta is expected to
    // be mostly personal accounts, so the old assertion passed while the majority path misdirected.
    // BOTH routes must be named — this is strictly stronger than the assertion it replaces, and it
    // matches what `DataControls.tsx` and the privacy page already shipped.
    expect(msConfirmCopy).toMatch(/account\.microsoft\.com/i);
    expect(msConfirmCopy).toMatch(/myapps\.microsoft\.com/i);
    expect(msConfirmCopy).toMatch(/does NOT remove|still lists Pikar/i);
    // And it must not borrow Google's revocation destination.
    expect(msConfirmCopy).not.toContain("myaccount.google.com");
  });

  test("the connections row names all of them and reads BOTH readiness flags", () => {
    for (const capability of MS_CAPABILITIES) {
      expect(
        new RegExp(capability, "i").test(msPanelCopy),
        `the connections row never says "${capability}" — this tab is the answer to "what is Pikar ` +
          `connected to", so an unnamed capability is invisible.`,
      ).toBe(true);
    }
    // `connected` alone cannot distinguish a half-grant: Microsoft may return LESS than requested.
    // Without both flags a tenant with calendar-only access is reported as healthy while every
    // Outlook send fails — the same class of bug the Google row's `driveReady` line exists for.
    expect(
      panel,
      "the connections row does not read calendarReady — a partial Microsoft grant is then " +
        "reported as healthy while every calendar call 403s.",
    ).toContain("calendarReady");
    expect(
      panel,
      "the connections row does not read mailReady — a calendar-only Microsoft grant is then " +
        "reported as healthy while every Outlook send fails.",
    ).toContain("mailReady");
  });

  // The query value is attacker-controllable; rendering it would reflect arbitrary text.
  //
  // Asserted against STRIPPED source, and the first run is why: the page's own ⚠ comment writes
  // `{errorCode}` verbatim while explaining that rendering it is forbidden, so the raw-source
  // version failed on the documentation rather than on the code. Same trap as the capability
  // sweeps, in the opposite direction — there a comment satisfied an assertion it shouldn't,
  // here a comment violated one it shouldn't.
  test("the connect page renders the mapped message, never the raw error code", () => {
    expect(msConnectCopy).toContain("microsoftCallbackMessage(errorCode)");
    expect(msConnectCopy).not.toMatch(/\{\s*errorCode\s*\}/);
  });

  test("DisconnectMicrosoft carries its own microsoftStatus subscription", () => {
    expect(msButton).toContain("useQuery(api.microsoftAuth.microsoftStatus)");
  });

  test("neither call site gates <DisconnectMicrosoft /> on a status.connected ternary", () => {
    for (const [src, name] of [
      [panel, "ConnectionsPanel"],
      [msConnectPage, "connect-microsoft"],
    ] as const) {
      const branch = ternaryTrueBranch(src, "status.connected");
      if (branch !== null) expect(branch, name).not.toContain("DisconnectMicrosoft");
      expect(src, name).toContain("<DisconnectMicrosoft");
    }
  });
});

describe("every user-facing surface names every capability in the Google grant", () => {
  // Keep this list in step with `GOOGLE_SCOPES` in calendar.ts.
  const CAPABILITIES = ["mail", "calendar", "Drive"] as const;

  // ⚠ COMMENTS STRIPPED, and the mutation run is why. The first version of this scan read the raw
  // file, so the ⚠ comment sitting BESIDE the consent copy — which naturally says the word "Drive"
  // several times while explaining the rule — satisfied every assertion on its own. Deleting Drive
  // from the actual sentence left all 16 tests green. Prose that NAMES the thing is documentation,
  // not evidence; only the rendered copy counts. Same idiom, and the same reason, as
  // `readExecutableCode` in dispatchGuard.test.ts.
  const copyOnly = (src: string): string =>
    src.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "").replace(/\/\/[^\n]*/g, "");

  const connectCopy = copyOnly(connectPage);
  const panelCopy = copyOnly(panel);

  test("the scan is reading real copy, not an empty string", () => {
    expect(connectCopy).toContain("Pikar needs your consent");
    expect(panelCopy).toContain("Google —");
  });

  test("the consent page names all of them — it IS the consent", () => {
    for (const capability of CAPABILITIES) {
      expect(
        new RegExp(capability, "i").test(connectCopy),
        `the connect page never says "${capability}" — a user cannot consent to a capability the ` +
          `consent screen does not mention. Widen GOOGLE_SCOPES, widen this sentence.`,
      ).toBe(true);
    }
  });

  test("the disconnect confirm names all of them — it is what the user gives up", () => {
    for (const capability of CAPABILITIES) {
      expect(
        new RegExp(capability, "i").test(CONFIRM),
        `the disconnect copy never says "${capability}" — someone reading "disconnect Gmail" would ` +
          `not expect that capability to stop working.`,
      ).toBe(true);
    }
  });

  test("the connections row names all of them, and reports Drive separately", () => {
    for (const capability of CAPABILITIES) {
      expect(
        new RegExp(capability, "i").test(panelCopy),
        `the connections row never says "${capability}" — this tab is the answer to "what is Pikar ` +
          `connected to", so an unnamed capability is invisible.`,
      ).toBe(true);
    }
    // `connected` alone cannot distinguish a pre-widening grant from a complete one:
    // `include_granted_scopes` is FORWARD-only, so an old token refreshes fine and holds no Drive
    // scope. Without this branch the shortfall is visible only inside the vault.
    expect(
      panel,
      "the connections row does not read driveReady — a tenant connected before the Drive widening " +
        "is then reported as healthy while every Drive import 403s.",
    ).toContain("driveReady");
  });
});

// ── The privacy policy is a user-facing surface too (added 2026-08-16) ────────────────────────
//
// THIS IS THE GAP THE SWEEPS ABOVE LEFT OPEN, and it stayed open through two verification passes.
// Every surface they cover — the connect pages, the disconnect confirm, the connections row — named
// Drive correctly, while §4 of the privacy policy still said Pikar requests `gmail.modify` alone.
// Three scopes had been added since that sentence was written. The consent screen and the policy
// are two different promises made to the same person about the same grant; only one was under test.
//
// A policy is also the surface with the LONGEST feedback loop: nobody reads it in review, and being
// wrong there is a regulatory exposure rather than a bug report. So it gets the same treatment as
// the consent copy — widen a scope constant, and this suite is red until the policy has been told.
//
// Asserted against the SCOPE CONSTANTS, not a hand-copied list, for the reason the file's other
// sweeps exist: a literal list here would be one more place to forget.
describe("the privacy policy names every scope in both grants", () => {
  // Same comment-stripping rule as the sweeps above, and for the same reason: prose that NAMES a
  // scope while explaining a rule is documentation, not disclosure. Only rendered copy counts.
  const policyCopy = privacyPage.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "").replace(/\/\/[^\n]*/g, "");

  test("the scan is reading the real policy, not an empty string", () => {
    expect(policyCopy.length).toBeGreaterThan(2000);
    expect(policyCopy).toContain("Privacy Policy");
    expect(policyCopy).toContain("4. Google user data");
  });

  // `gmail.modify`, `calendar.freebusy`, `calendar.events`, `drive.readonly` — the policy names the
  // short form, which is also how Google's own consent screen names them to the user.
  test("every Google scope is disclosed", () => {
    for (const scope of GOOGLE_SCOPES.split(" ")) {
      const shortName = scope.split("/").pop() as string;
      expect(
        policyCopy.includes(shortName),
        `the privacy policy never says "${shortName}" — it is in GOOGLE_SCOPES, so the app asks ` +
          `for it. A policy that under-states the grant is worse than one that says nothing: §4 ` +
          `is the section written to be maximally candid about how much access we hold.`,
      ).toBe(true);
    }
  });

  // Includes Mail.Send / Mail.Read, which are granted NOW and unused until 25-06 (ADR-018's
  // consent-once union grant). An undisclosed granted-but-unused permission is the exact defect
  // ADR-018 consequence 6 warns about, one surface further out than the consent screen.
  test("every Microsoft scope is disclosed, including the ones not yet used", () => {
    for (const scope of MICROSOFT_SCOPES.split(" ")) {
      expect(
        policyCopy.includes(scope),
        `the privacy policy never says "${scope}" — it is in MICROSOFT_SCOPES, so the consent ` +
          `screen asks for it. Scopes we hold but do not yet use still have to be disclosed.`,
      ).toBe(true);
    }
  });

  test("the policy does not claim model requests route through the Vercel AI Gateway", () => {
    // `llm.ts` resolves models against @ai-sdk/openai directly — "The Vercel AI Gateway is NOT
    // used" (decision 2026-07-13). The policy asserted the opposite for a year.
    expect(
      /AI Gateway/i.test(policyCopy),
      "the privacy policy still names the Vercel AI Gateway as a processor of message content, " +
        "but llm.ts calls OpenAI directly. Naming a processor that never sees the data is as " +
        "wrong as omitting one that does.",
    ).toBe(false);
  });
});
