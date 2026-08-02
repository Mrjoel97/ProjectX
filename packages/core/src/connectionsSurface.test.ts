import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// These files live in `apps/web`, outside this package. Reading them by path is the established
// repo idiom for asserting a guarantee that lives in the UI — see the profile source scan in
// `businessProfile.test.ts` and `traceParity.test.ts` in packages/backend.
const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8");

const WEB = "apps/web/app/(app)";
const button = read(`${WEB}/_components/DisconnectGoogle.tsx`);
const connectPage = read(`${WEB}/connect-gmail/page.tsx`);
const panel = read(`${WEB}/dashboard/profile/ConnectionsPanel.tsx`);
const data = read(`${WEB}/dashboard/profile/connections.ts`);
const profilePage = read(`${WEB}/dashboard/profile/page.tsx`);

// The exact user-facing sentence. If the Google scope changes, this string changes in ONE place.
const CONFIRM = "Disconnect Google? Pikar will lose access to your mail AND your calendar.";

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
