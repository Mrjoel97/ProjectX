import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// These files live in `apps/web`, outside this package. Reading them by path is the established
// repo idiom for asserting a guarantee that lives in the UI — see the profile source scan in
// `businessProfile.test.ts` and `traceParity.test.ts` in packages/backend.
const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8");

const WEB = "apps/web/app/(app)";
const button = read(`${WEB}/_components/DisconnectGoogle.tsx`);
const connectPage = read(`${WEB}/connect-gmail/page.tsx`);

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
