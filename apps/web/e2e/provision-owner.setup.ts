import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  durableUserId,
  inviteCode,
  jsonValue,
  noOutputReason,
  onboardedTenant,
  ownerGrant,
} from "./provision-owner.diagnostics";

// 27-11: PROVISION THE OWNER THE BROWSER EVIDENCE PLANE NEEDS. Local dev only, and it is a SETUP
// project rather than a spec — it creates state, it asserts nothing about the product.
//
// WHY IT EXISTS. `auth.setup.ts` signs an EXISTING user in through the real /signin form. Nothing
// creates that user, signup is invite-gated (`admitIdentity` throws inside the auth transaction),
// and `listPackCandidates` is owner-only — so on a fresh machine there is no account that can reach
// a candidate pack, and the browser evidence plane cannot be earned by anyone. This walks the two
// internal seams that close that gap: `invites:__seedInvite` then `owner:bootstrapOwner`.
//
// IT IS IDEMPOTENT AND IT NEVER WEAKENS THE GATE. The invite seam is `internalMutation` (not
// client-callable — `isolation.test.ts` scans for exactly that), the signup goes through the REAL
// form and the REAL auth transaction, and owner is granted by a deliberate CLI call rather than by
// anything the browser can ask for. If the user already exists, the sign-up is skipped and only the
// owner grant is re-applied.
//
// NEVER RUN THIS AGAINST A DEPLOYMENT THAT IS NOT LOCAL. It is guarded on the deployment URL below.

const backendDir =
  process.env.PIKAR_E2E_BACKEND_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");
const appOrigin = process.env.PIKAR_E2E_BASE_URL ?? "http://127.0.0.1:3111";

function convexRun(fn: string, args: Record<string, unknown>): string {
  const r = spawnSync(process.execPath, [convexBin, "run", fn, JSON.stringify(args)], {
    cwd: backendDir,
    encoding: "utf8",
    timeout: 60_000,
  });
  const stdout = (r.stdout ?? "").trim();
  // On Windows, the local CLI can report a non-zero exit during Node teardown after printing a
  // successful result, so stdout remains authoritative. When it prints nothing, expose only a
  // closed transport reason: raw stderr could carry the invite payload or deployment detail.
  if (!stdout) {
    throw new Error(`${fn} returned no output (${noOutputReason(r)})`);
  }
  const stderr = r.stderr ?? "";
  if (/Failed to run function|isn't running|not listening/.test(stderr)) {
    throw new Error(`${fn} failed (local CLI transport)`);
  }
  try {
    JSON.parse(stdout);
  } catch {
    throw new Error(`${fn} returned invalid JSON`);
  }
  return stdout;
}

function convexJson(fn: string, args: Record<string, unknown>): unknown {
  return jsonValue(fn, convexRun(fn, args));
}

// Three CLI round trips and a real signup — comfortably past Playwright's 30s default, and the
// first run proved it: the owner WAS provisioned and the test then failed on the clock.
test.setTimeout(180_000);

test("provision an owner account for the candidate preview", async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("E2E_USER_EMAIL / E2E_USER_PASSWORD must be set (see e2e/README.md).");
  }
  // LOCAL ONLY. Granting owner is not something to do by accident against anything shared.
  const deployment = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  expect(
    /127\.0\.0\.1|localhost/.test(deployment) || deployment === "",
    `refusing to provision an owner against ${deployment}`,
  ).toBe(true);

  // 1. DOES THE ACCOUNT ALREADY EXIST? Ask FIRST, because signing up twice cannot work and the
  //    failure is confusing: the invite is REDEEMED by the first successful signup, so the second
  //    run's preflight rejects the code and leaves Create Account disabled forever. Measured — this
  //    step exists because the second run failed exactly that way.
  const existing = convexJson("owner:findUserIdByEmail", { email });
  const already = durableUserId(existing) ?? undefined;

  if (already === undefined) {
    // 2. The invite, then sign up through the REAL form, so the account is created by the
    //    product's own auth transaction rather than by a fixture that could diverge from it.
    const seeded = convexJson("invites:__seedInvite", { email });
    const code = inviteCode(seeded);
    if (!code) {
      throw new Error("invites:__seedInvite returned an invalid invite-code shape");
    }

    await page.goto(`${appOrigin}/signup?invite=${code}`);
    const emailField = page.getByPlaceholder("name@company.com");
    await expect(emailField).toBeVisible({ timeout: 30_000 });

    await page.getByPlaceholder("John Doe").fill("Pack Evidence Owner");
    await emailField.fill(email);
    await page.getByPlaceholder("Create a password").fill(password);
    await page.getByPlaceholder("Confirm password").fill(password);

    const submit = page.getByRole("button", { name: /Create Account/i });
    await expect(submit).toBeEnabled({ timeout: 30_000 }); // waits for the invite preflight
    await submit.click();
    await page
      .waitForURL((u) => !u.pathname.startsWith("/signup"), { timeout: 60_000 })
      .catch(() => undefined);
  }

  // 3. The owner grant, by id, from the CLI. `bootstrapOwner` is `internalMutation`; nothing the
  //    browser can reach grants authority.
  const found = convexJson("owner:findUserIdByEmail", { email });
  const userId = durableUserId(found);
  if (!userId) {
    throw new Error("owner lookup did not return a durable user-id shape after signup");
  }
  if (!ownerGrant(convexJson("owner:bootstrapOwner", { userId }), userId)) {
    throw new Error("owner:bootstrapOwner returned an invalid grant result");
  }

  // 4. Past the ONBOARDING GATE. The `(app)` layout force-redirects a tenant with no committed
  //    business profile to /dashboard/onboarding and lets it reach NO other route, so without this
  //    the workspace — and therefore every candidate card — is unreachable for a fresh account.
  //    `__seedOnboardedTenant` is the sanctioned way past it (e2e/README.md): idempotent, offline,
  //    no credits. The tenant id IS the user id (`requireTenant` returns the subject before '|').
  if (!onboardedTenant(convexJson("onboarding:__seedOnboardedTenant", { tenantId: userId }))) {
    throw new Error("onboarding:__seedOnboardedTenant returned an invalid seed result");
  }
  console.log("provisioned disposable owner and seeded onboarding");
});
