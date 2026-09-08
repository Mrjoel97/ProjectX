import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * 44-01 — ERASURE DELETES THE BYTES, NOT ONLY THE ROWS.
 *
 * **The defect this exists to catch.** `deleteTenantDataPage` deleted every tenant row and left
 * every stored blob behind. Row counts were GREEN through the whole defect — the action's own
 * `deletedByTable` report, `tenantDelete.test.ts`, and the UI's "Erased — N rows across M tables"
 * sentence were all telling the truth about rows while the PDFs, renders and uploads stayed in
 * `_storage` forever. So the load-bearing assertion here is not a count of anything: it is that a
 * blob which EXISTED in `_storage` before the click is GONE from `_storage` after it.
 *
 * **Why this spec is destructive, and what that forces.** Erasure removes the person's ability to
 * sign in — `deleteAuthCredentials` deletes `authSessions`, `authRefreshTokens`,
 * `authVerificationCodes` and `authAccounts`, because a production run on 2026-08-16 deleted the
 * `users` row, left the `authAccounts` orphan, and PERMANENTLY LOCKED that identity out. Running
 * this against the shared `E2E_USER_EMAIL` account would therefore destroy the account every other
 * spec signs in as. It never touches that account: it MINTS ITS OWN disposable tenant through the
 * real invite-gated signup form, erases that one, and asserts the erasure landed.
 *
 * TWO GUARDS, both fail-closed:
 *   1. `PIKAR_E2E_ERASURE=1` — off by default, so a plain `pnpm test:e2e` never runs it.
 *   2. `CONVEX_DEPLOYMENT` in `packages/backend/.env.local` must start with `local:`. It creates an
 *      account AND erases one; neither belongs on a deployment anybody shares. Stricter than
 *      `provision-owner.setup.ts`, which also accepts an EMPTY deployment string — this one does not.
 *
 * It does NOT use the shared `storageState` (see `test.use` below) — it is its own user.
 *
 * PREREQUISITES (e2e/README.md): `convex dev` (NOT --once) and `next dev` on :3111, both live.
 * `PIKAR_E2E_BACKEND_DIR` must point at `packages/backend` if this is run from elsewhere.
 * $0: no provider, no model, no credits — one 30-byte PDF blob and one row.
 */

const backendDir =
  process.env.PIKAR_E2E_BACKEND_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");
const CLI_FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;

/** The Convex CLI, stdout only. Exit codes are deliberately ignored: CLI 1.42.1 on Windows prints a
 *  committed result and then exits non-zero on a libuv closing-handle assertion (approvals.spec.ts
 *  records the same quirk). The CLI's own failure prose IS treated as a failure, because it exits 0
 *  on some of those — which is how a spec ends up asserting against state that was never written. */
function cli(args: readonly string[]): string {
  const result = spawnSync(process.execPath, [convexBin, ...args], {
    cwd: backendDir,
    encoding: "utf8",
  });
  if (result.error) throw new Error(`spawn failed for convex ${args[0]}: ${result.error.message}`);
  const stderr = result.stderr ?? "";
  if (CLI_FAILURE.test(stderr)) {
    throw new Error(`convex ${args.join(" ")} failed:\n${stderr.trim()}\n${result.stdout ?? ""}`);
  }
  return result.stdout ?? "";
}

const run = (fn: string, args: Record<string, unknown>): string =>
  cli(["run", fn, JSON.stringify(args)]);

/**
 * THE ARTIFACT PROBE. `convex data _storage` reads the system table `ctx.db.system.get("_storage",
 * id)` reads — the exact existence check `deleteTenantDataPage` guards its `ctx.storage.delete`
 * with — so a blob that is present here is present to the product, and absent here is absent.
 *
 * ponytail: the shipped CLI over a new internal query — verified 2026-09-08 that `jsonLines` is
 * a documented choice of `convex data --format`, rather than assumed from its name. It needs no backend code, no schema change
 * and — unlike `ctx.storage.getUrl` — mints no bearer capability, which `llmRedaction.test.ts`
 * forbids outside a `tenantQuery` anyway.
 *
 * The window is the 1000 most recent blobs (`--order desc` is the CLI default). The fixture blob is
 * created seconds before the first probe and nothing creates blobs after it, so the window
 * strictly contains it for both probes; only 1000 NEWER blobs arriving mid-test could turn a
 * survivor into a false pass, and nothing in this spec or a local dev deployment does that.
 */
const blobExists = (storageId: string): boolean =>
  cli(["data", "_storage", "--limit", "1000", "--format", "jsonLines"]).includes(storageId);

/** The 2026-08-16 lockout guard: after erasure NO `authAccounts` row may still name this identity.
 *  A signed-out browser cannot see the difference — an orphaned account row and a deleted one both
 *  surface as "Wrong email or password." — so this asks the table, not the form. */
const authAccountExists = (email: string): boolean =>
  cli(["data", "authAccounts", "--limit", "1000", "--format", "jsonLines"]).includes(email);

/** The exact phrase `deleteTenantData` takes as `v.literal(...)`, and the exact phrase the UI arms
 *  on. Retyped here on purpose: if either side ever drifts, this spec is the thing that notices. */
const DELETE_PHRASE = "DELETE MY DATA";

// Its own user, so the shared session is never loaded and never destroyed. An explicit EMPTY state
// rather than `undefined`: `undefined` reads as "unset" and can fall back to the project's
// `storageState`, which is exactly the account this spec must not touch.
test.use({ storageState: { cookies: [], origins: [] } });

test("erasure deletes the tenant's stored blob, not only its rows", async ({ page }) => {
  test.skip(
    process.env.PIKAR_E2E_ERASURE !== "1",
    "destructive: mints and then erases a disposable tenant. Opt in with PIKAR_E2E_ERASURE=1.",
  );
  // A real signup, ~55 deletion pages at TENANT_DELETE_BATCH_SIZE=2, and two sign-ins.
  test.setTimeout(300_000);

  // ── GUARD 2: local deployment only ────────────────────────────────────────────────────────────
  // Read from the file the CLI itself resolves, not from the shell: `CONVEX_URL` is usually unset
  // in a Playwright shell, and a guard that passes on "unset" is not a guard.
  const envLocal = readFileSync(resolve(backendDir, ".env.local"), "utf8");
  const deployment = /^CONVEX_DEPLOYMENT=(\S*)/m.exec(envLocal)?.[1] ?? "";
  expect(
    deployment.startsWith("local:"),
    `refusing to create and erase a tenant on "${deployment}" — this spec is LOCAL ONLY`,
  ).toBe(true);
  const baseUrl = process.env.PIKAR_E2E_BASE_URL ?? "http://127.0.0.1:3111";
  expect(
    /127\.0\.0\.1|localhost/.test(baseUrl),
    `refusing to run the erasure spec against ${baseUrl}`,
  ).toBe(true);

  // ── A DISPOSABLE IDENTITY ─────────────────────────────────────────────────────────────────────
  // Fresh every run. The account is destroyed by the test itself, and the invite is redeemed by the
  // signup, so reusing one address would leave the second run staring at a permanently disabled
  // Create Account button (measured — provision-owner.setup.ts carries the same note).
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `erasure-${stamp}@pikar.test`;
  const password = `Erasure-${stamp}-Aa1!`;

  const seeded = run("invites:__seedInvite", { email });
  const code = /"code":\s*"([A-Z0-9-]+)"/.exec(seeded)?.[1];
  expect(code, `no invite code came back:\n${seeded}`).toBeTruthy();

  await page.goto(`${baseUrl}/signup?invite=${encodeURIComponent(code as string)}`);
  await page.getByLabel("Invite code").fill(code as string);
  // The form disables submit until `invites.preflight` recognises the code; that sentence is the
  // honest readiness signal rather than a sleep.
  await expect(page.getByText(/Invite recognised for/)).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Full Name").fill("Erasure Fixture");
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm Password").fill(password);
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page.getByRole("button", { name: /sign ?out/i })).toBeVisible({ timeout: 60_000 });

  // ── STAGE, THEN AUTHENTICATE (e2e/README.md) ──────────────────────────────────────────────────
  // Every `convex run` against a LOCAL (anonymous) deployment invalidates the browser session, so
  // all CLI work happens here and the spec signs in AFTER it. The tenant id is the user id —
  // `requireTenant` returns the JWT subject before '|' — and it is read from the CLI rather than
  // parsed out of a cookie, so a mis-read token can never stage the fixture on the wrong tenant.
  // KEYED, not positional. `findUserIdByEmail` returns `{ userId, owner }`, and the shipped
  // `provision-owner.setup.ts` already reads it with this exact regex — reusing it beats a
  // helper that greps the LAST 20+ character quoted token out of stdout and hopes it is the
  // right one. A positional match is one extra returned field away from staging this fixture
  // on the WRONG tenant, which would make the whole spec pass while proving nothing.
  const found = run("owner:findUserIdByEmail", { email });
  const tenantId = /"userId":\s*"([a-z0-9]+)"/.exec(found)?.[1];
  expect(tenantId, `no user row for ${email} after signup:\n${found}`).toBeTruthy();

  // The (app) layout force-redirects a tenant with no committed business profile to
  // /dashboard/onboarding and lets it reach no other route — /dashboard/settings included.
  run("onboarding:__seedOnboardedTenant", { tenantId: tenantId as string });

  // THE BLOB. `smoke:storeSmokePdf` writes fixed `%PDF-1.4` bytes; `vault:insertCreatedDoc` is the
  // created-artifact seam, which writes `vaultDocuments.storageId` STRAIGHT THROUGH from args and
  // deliberately runs NO ingest — so the fixture is one row and one blob with no scheduled work
  // that could still be in flight when the erasure walks past it.
  const marker = `E2E-ERASURE-${stamp}`;
  const stored = run("smoke:storeSmokePdf", { marker });
  const storageId = /"storageId":\s*"([^"]+)"/.exec(stored)?.[1];
  expect(storageId, `storeSmokePdf returned no storageId:\n${stored}`).toBeTruthy();

  run("vault:insertCreatedDoc", {
    tenantId: tenantId as string,
    title: `Erasure fixture ${stamp}`,
    form: "long", // `long` ⇒ storedMimeType application/pdf, matching the bytes above
    markdown: `# Erasure fixture ${stamp}\n\nNo personal data. Exists to be deleted.`,
    contentHash: `erasure-e2e-${stamp}`,
    storageId,
  });

  // THE PRE-CONDITION. Without this the post-condition is a check that cannot fail: "absent from
  // _storage" is trivially true for a blob that was never there.
  expect(blobExists(storageId as string), "fixture blob was not in _storage before erasure").toBe(
    true,
  );
  expect(authAccountExists(email), "no authAccounts row for the disposable identity").toBe(true);

  // ── THE UI FLOW ───────────────────────────────────────────────────────────────────────────────
  await page.goto(`${baseUrl}/signin`);
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("button", { name: /sign ?out/i })).toBeVisible({ timeout: 30_000 });

  await page.goto(`${baseUrl}/dashboard/settings`);
  const erase = page.getByRole("region", { name: "Delete your data" });
  await expect(erase.getByRole("heading", { name: "Delete your data" })).toBeVisible({
    timeout: 30_000,
  });

  const confirm = erase.getByLabel(/to confirm/i);
  const eraseButton = erase.getByRole("button", { name: "Delete my data" });

  // The client-side arming guard: the button refuses a near-miss and only the exact server literal
  // arms it, so a mistyped confirmation cannot reach an irreversible action.
  await confirm.fill("delete my data");
  await expect(eraseButton).toBeDisabled();
  await confirm.fill(DELETE_PHRASE);
  await expect(eraseButton).toBeEnabled();
  await eraseButton.click();

  // Settling means the report renders, OR the shell signs itself out, OR it bounces to ONBOARDING —
  // the action deletes the `users` row this session's identity resolves to, so the (app) layout is
  // entitled to redirect before the status line is ever read.
  //
  // ONBOARDING IS THE ONE THIS SPEC LEARNED BY RUNNING. Written in 44-02 and never executed, it
  // listed only the report and /signin; the FIRST real execution (2026-09-08) sat on
  // `/dashboard/onboarding` for the full 240s and failed. The session outlives the profile, so the
  // layout treats the erased tenant as a brand-new one and routes it to onboarding. That is a real
  // terminal, not a workaround for a flake.
  //
  // WIDENING THIS CANNOT MAKE THE SPEC VACUOUS, and that is why it is safe: none of the three
  // branches is the evidence. They only establish that the click was PROCESSED, so the probe below
  // is not racing an action that never started. The load-bearing assertion is the blob, and it is
  // unchanged.
  await expect
    .poll(
      async () => {
        try {
          return (await erase.getByRole("status").textContent({ timeout: 2_000 })) ?? "";
        } catch {
          return page.url();
        }
      },
      { timeout: 240_000, intervals: [1_000] },
    )
    .toMatch(/Erased —|\/signin|\/dashboard\/onboarding/);

  // ── THE ASSERTION THIS SPEC EXISTS FOR ────────────────────────────────────────────────────────
  // Polled, not read once: `ctx.storage.delete` lands inside the page mutation, but the probe is a
  // separate CLI round trip and a short lag would otherwise read as a defect.
  await expect
    .poll(() => blobExists(storageId as string), { timeout: 60_000, intervals: [2_000] })
    .toBe(false);

  // And the sign-in binding, for the 2026-08-16 permanent-lockout incident: erasure has to remove
  // the person's ability to sign in, not only their data.
  await expect
    .poll(() => authAccountExists(email), { timeout: 60_000, intervals: [2_000] })
    .toBe(false);
});
