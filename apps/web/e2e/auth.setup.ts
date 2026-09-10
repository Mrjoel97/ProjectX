import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test as setup } from "@playwright/test";

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
export const FOREIGN_STORAGE_STATE = "e2e/.auth/foreign.json";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/signin");
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 15_000 });
}

// Local CLI fixture calls can expire browser sessions. Resolve and seed BOTH users first,
// then authenticate both fresh. Never bootstrap ownership in setup: Phase 23 observes non-owner
// rendering before the separate irreversible grant, and keeps the foreign identity non-owner.
function preparePhase23Users(emails: string[]): [string, string] {
  const backend = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
  const run = (fn: string, args: Record<string, unknown>) => {
    const result = spawnSync(
      process.execPath,
      [resolve(backend, "node_modules/convex/bin/main.js"), "run", fn, JSON.stringify(args)],
      { cwd: backend, encoding: "utf8", timeout: 60_000 },
    );
    if (result.status !== 0 || result.error)
      throw new Error(
        "Phase 23 identity preparation failed; inspect deployment configuration separately.",
      );
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new Error("Phase 23 identity preparation returned an invalid result.");
    }
  };
  const ids = emails.map((email) => {
    const user = run("owner:findUserIdByEmail", { email });
    if (!user || user.owner !== false || typeof user.userId !== "string")
      throw new Error("Phase 23 requires two existing unambiguous non-owner identities.");
    return user.userId as string;
  });
  const [primaryId, foreignId] = ids;
  if (!primaryId || !foreignId || new Set(ids).size !== 2)
    throw new Error("Phase 23 requires distinct durable tenant identities.");
  for (const tenantId of ids) run("onboarding:__seedOnboardedTenant", { tenantId });
  return [primaryId, foreignId];
}

async function assertSubject(page: Page, expected: string) {
  const state = await page.context().storageState();
  const origin = new URL(page.url()).origin;
  const tokens = state.origins
    .filter((item) => item.origin === origin)
    .flatMap((item) => item.localStorage)
    .filter((item) => item.name.startsWith("__convexAuthJWT"));
  const token = tokens[0];
  if (tokens.length !== 1 || !token)
    throw new Error("Phase 23 auth state must contain one unambiguous JWT.");
  try {
    const payload = token.value.split(".")[1];
    if (!payload) throw new Error();
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      typeof claims.sub !== "string" ||
      claims.sub.split("|")[0] !== expected ||
      !Number.isFinite(claims.exp) ||
      claims.exp * 1000 <= Date.now()
    )
      throw new Error();
  } catch {
    throw new Error("Phase 23 JWT subject or expiry does not match the prepared identity.");
  }
}

setup("authenticate", async ({ page, browser }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "E2E_USER_EMAIL / E2E_USER_PASSWORD must be set to a seeded test user in the local Convex deployment (see e2e/README.md).",
    );
  }

  if (process.env.PIKAR_PHASE23_TWO_IDENTITIES !== "1") {
    await signIn(page, email, password);
    await page.context().storageState({ path: STORAGE_STATE });
    return;
  }
  setup.setTimeout(300_000);
  const foreignEmail = process.env.E2E_FOREIGN_USER_EMAIL;
  const foreignPassword = process.env.E2E_FOREIGN_USER_PASSWORD;
  if (
    !foreignEmail ||
    !foreignPassword ||
    foreignEmail.trim().toLowerCase() === email.trim().toLowerCase()
  )
    throw new Error(
      "Phase 23 requires distinct E2E_FOREIGN_USER_EMAIL / E2E_FOREIGN_USER_PASSWORD.",
    );
  const ids = preparePhase23Users([email, foreignEmail]);
  await signIn(page, email, password);
  await assertSubject(page, ids[0]);
  const foreignContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const foreignPage = await foreignContext.newPage();
    await signIn(foreignPage, foreignEmail, foreignPassword);
    await assertSubject(foreignPage, ids[1]);
    // Save only after BOTH identities pass. Neither credentials nor decoded JWTs are attached.
    await page.context().storageState({ path: STORAGE_STATE });
    await foreignContext.storageState({ path: FOREIGN_STORAGE_STATE });
  } finally {
    await foreignContext.close();
  }
});
