import { expect, test as setup } from "@playwright/test";

// The cockpit lives under the (app) auth gate, so every feature spec needs a signed-in
// browser. This setup project signs in ONCE via the real /signin password form and saves
// the resulting storageState (Convex Auth keeps its JWT in localStorage, which storageState
// captures) for the chromium project to reuse.
//
// Requires a seeded test user in the LIVE local deployment + its creds in env:
//   E2E_USER_EMAIL / E2E_USER_PASSWORD  (see e2e/README.md).
// ponytail: password-form sign-in (already in the app) over minting a token by hand —
// smallest path that reaches the authed shell. Swap to a token-mint helper only if the
// form login becomes flaky in CI.

export const STORAGE_STATE = "e2e/.auth/user.json";

setup("authenticate", async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "E2E_USER_EMAIL / E2E_USER_PASSWORD must be set to a seeded test user in the local Convex deployment (see e2e/README.md).",
    );
  }

  await page.goto("/signin");
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Land on the authed shell — the "Sign out" button only renders inside <Authenticated>.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 15_000 });

  await page.context().storageState({ path: STORAGE_STATE });
});
