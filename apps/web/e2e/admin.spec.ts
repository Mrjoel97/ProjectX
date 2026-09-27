import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// BETA-01 browser evidence. This is intentionally opt-in: auth.setup.ts creates the second
// controlled identity only when PIKAR_PHASE23_TWO_IDENTITIES=1, and a one-identity run would make
// the non-owner half vacuous. No provider, production, or paid action belongs in this spec.
test.skip(
  process.env.PIKAR_PHASE23_TWO_IDENTITIES !== "1",
  "admin boundary requires the controlled two-identity setup",
);
test.describe.configure({ mode: "serial" });

const backendDir =
  process.env.PIKAR_E2E_BACKEND_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");
const appOrigin = process.env.PIKAR_E2E_BASE_URL ?? "http://127.0.0.1:3111";
const foreignStorageState = resolve(dirname(fileURLToPath(import.meta.url)), ".auth/foreign.json");

function convexRun<T>(fn: string, args: Record<string, unknown>): T {
  const result = spawnSync(process.execPath, [convexBin, "run", fn, JSON.stringify(args)], {
    cwd: backendDir,
    encoding: "utf8",
    timeout: 60_000,
  });
  const stderr = result.stderr ?? "";
  if (
    result.error ||
    /Failed to run function|Uncaught Error|isn't running|not listening/.test(stderr)
  ) {
    throw new Error(`${fn} failed in the controlled local fixture`);
  }
  try {
    return JSON.parse((result.stdout ?? "").trim()) as T;
  } catch {
    throw new Error(`${fn} returned no valid redacted fixture result`);
  }
}

async function tenantIdFromPage(page: import("@playwright/test").Page): Promise<string> {
  const token = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((candidate) =>
      candidate.startsWith("__convexAuthJWT"),
    );
    return key ? window.localStorage.getItem(key) : null;
  });
  if (!token) throw new Error("controlled owner fixture has no Convex Auth token");
  const payload = token.split(".")[1];
  if (!payload) throw new Error("controlled owner fixture token is malformed");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    sub?: string;
  };
  const tenantId = claims.sub?.split("|")[0];
  if (!tenantId) throw new Error("controlled owner fixture token has no stable subject");
  return tenantId;
}

test("owner and non-owner identities see only their permitted admin boundary", async ({
  page,
  browser,
}) => {
  const deployment = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  expect(/127\.0\.0\.1|localhost/.test(deployment) || deployment === "").toBe(true);

  await page.goto("/admin");
  const ownerId = await tenantIdFromPage(page);
  try {
    // Make the precondition explicit and re-runnable: the first observation must be non-owner.
    convexRun("owner:revokeOwner", { userId: ownerId });
    await page.reload();
    await expect(page.getByText("This area isn't available on your account.")).toBeVisible();
    await expect(page.getByText("Beta waitlist", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /approve & mint invite/i })).toHaveCount(0);

    const waitlistEmail = `admin-boundary-${Date.now()}@example.test`;
    convexRun("invites:requestAccess", { email: waitlistEmail });
    convexRun("owner:bootstrapOwner", { userId: ownerId });
    await page.reload();
    await expect(page.getByText("Beta waitlist", { exact: true })).toBeVisible();
    await expect(page.getByText(waitlistEmail, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /approve & mint invite/i }).click();
    await expect(page.getByRole("button", { name: /copy invite link/i })).toBeVisible();

    const foreignContext = await browser.newContext({
      baseURL: appOrigin,
      storageState: foreignStorageState,
    });
    try {
      const foreignPage = await foreignContext.newPage();
      await foreignPage.goto("/admin");
      await expect(
        foreignPage.getByText("This area isn't available on your account."),
      ).toBeVisible();
      await expect(foreignPage.getByText("Beta waitlist", { exact: true })).toHaveCount(0);
      await expect(
        foreignPage.getByRole("button", { name: /approve & mint invite|copy invite link/i }),
      ).toHaveCount(0);
    } finally {
      await foreignContext.close();
    }
  } finally {
    convexRun("owner:revokeOwner", { userId: ownerId });
  }
});
