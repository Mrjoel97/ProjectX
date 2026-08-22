import { expect, test as setup } from "@playwright/test";

/**
 * ONE-OFF: create the e2e account through the REAL invite-gated signup form (26-17).
 *
 * Not part of any project in `playwright.config.ts` — run it explicitly with
 * `npx playwright test e2e/seed-user.setup.ts --project=setup` when a deployment has no e2e
 * account whose password is still known. `auth.setup.ts` only ever SIGNS IN; this is the door
 * before it, and it exists because `/signup` is invite-gated (BETA-01) so an account cannot be
 * conjured from the CLI.
 *
 * Requires: E2E_USER_EMAIL, E2E_USER_PASSWORD, E2E_INVITE_CODE — the last one minted by
 * `npx convex run invites:__seedInvite '{"email":"…"}'` against the same deployment.
 */
setup("seed the e2e account", async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  const code = process.env.E2E_INVITE_CODE;
  if (!email || !password || !code) {
    throw new Error("E2E_USER_EMAIL / E2E_USER_PASSWORD / E2E_INVITE_CODE must all be set.");
  }

  await page.goto(`/signup?invite=${encodeURIComponent(code)}`);
  await page.getByLabel("Invite code").fill(code);
  // The form disables its submit until `invites.preflight` recognises the code, so waiting for
  // that sentence is the honest readiness signal rather than a sleep.
  await expect(page.getByText(/Invite recognised for/)).toBeVisible({ timeout: 20_000 });

  await page.getByLabel("Full Name").fill("E2E Reports");
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByRole("button", { name: /create account/i }).click();

  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
});
