import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

const backend = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
type AuthStage =
  | "NAVIGATE"
  | "SIGN_OUT"
  | "FILL"
  | "SUBMIT"
  | "AUTHENTICATED"
  | "IDENTITY"
  | "NON_OWNER_UI";
function mark(role: "A" | "B", stage: AuthStage, status: "started" | "passed" | "failed") {
  process.stdout.write(
    `${JSON.stringify({ event: "phase23_native_auth", role, stage, status })}\n`,
  );
}

/** Fresh native form authentication; never inspects a cookie, token or password in diagnostics. */
export async function authenticate(page: Page, foreign = false) {
  const role = foreign ? "B" : "A";
  const prefix = foreign ? "E2E_FOREIGN_USER" : "E2E_USER";
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) throw new Error("PHASE23_AUTH_REQUIRED");
  let stage: AuthStage = "NAVIGATE";
  try {
    mark(role, stage, "started");
    await page.goto("/signin");
    const signOut = page.getByRole("button", { name: /^sign out$/i });
    const emailInput = page.getByLabel("Email Address", { exact: true });
    await expect(signOut.or(emailInput)).toBeVisible({ timeout: 30_000 });
    mark(role, stage, "passed");
    if (await signOut.isVisible()) {
      stage = "SIGN_OUT";
      mark(role, stage, "started");
      await signOut.click();
      await page.goto("/signin");
      mark(role, stage, "passed");
    }
    stage = "FILL";
    mark(role, stage, "started");
    await page.getByLabel("Email Address", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    mark(role, stage, "passed");
    stage = "SUBMIT";
    mark(role, stage, "started");
    await page.getByRole("button", { name: /^sign in$/i }).click();
    mark(role, stage, "passed");
    stage = "AUTHENTICATED";
    mark(role, stage, "started");
    await expect(page.getByRole("button", { name: /^sign out$/i })).toBeVisible({
      timeout: 30_000,
    });
    mark(role, stage, "passed");
  } catch {
    mark(role, stage, "failed");
    throw new Error(`PHASE23_AUTH_${stage}_FAILED`);
  }
}

/** The only server operation in the shared auth helper is this exact read-only identity lookup. */
export async function nonOwner(page: Page, foreign = false) {
  const role = foreign ? "B" : "A";
  const email = process.env[foreign ? "E2E_FOREIGN_USER_EMAIL" : "E2E_USER_EMAIL"];
  const expectedId =
    process.env[foreign ? "PIKAR_PHASE23_FOREIGN_USER_ID" : "PIKAR_PHASE23_PRIMARY_USER_ID"];
  if (!email || !expectedId) throw new Error("PHASE23_AUTH_IDENTITY_REQUIRED");
  mark(role, "IDENTITY", "started");
  try {
    const result = spawnSync(
      process.execPath,
      [
        resolve(backend, "node_modules/convex/bin/main.js"),
        "run",
        ...(process.env.PIKAR_CONVEX_TARGET === "prod" ? ["--prod"] : []),
        "owner:findUserIdByEmail",
        JSON.stringify({ email }),
      ],
      { cwd: backend, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 },
    );
    if (result.status !== 0 || result.error) throw new Error("read failed");
    const user = JSON.parse(result.stdout);
    if (user?.owner !== false || user.userId !== expectedId) throw new Error("identity mismatch");
    mark(role, "IDENTITY", "passed");
  } catch {
    mark(role, "IDENTITY", "failed");
    throw new Error("PHASE23_AUTH_IDENTITY_FAILED");
  }
  await authenticate(page, foreign);
  mark(role, "NON_OWNER_UI", "started");
  try {
    await page.goto("/ops");
    await expect(page.getByRole("heading", { name: "Compliance", exact: true })).toBeVisible();
    await expect(page.getByText("Eval signals", { exact: true })).toBeVisible();
    await expect(page.getByText("Tenant skill candidates", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Activate v/ })).toHaveCount(0);
    mark(role, "NON_OWNER_UI", "passed");
  } catch {
    mark(role, "NON_OWNER_UI", "failed");
    throw new Error("PHASE23_AUTH_NON_OWNER_UI_FAILED");
  }
  return expectedId;
}
