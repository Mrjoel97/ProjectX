import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "@playwright/test";
import { nonOwner } from "./phase23NativeAuth";

test.describe.configure({ mode: "serial", retries: 0 });
test.use({
  trace: "off",
  screenshot: "off",
  video: "off",
  storageState: { cookies: [], origins: [] },
});
test("fresh A/B native sign-in and non-owner readiness only @phase23-auth-only", async ({
  page,
  browser,
}) => {
  test.skip(
    process.env.PIKAR_PHASE23_AUTH_ONLY !== "1",
    "Explicit private auth-only setup required",
  );
  test.setTimeout(5 * 60_000);
  if (
    process.env.PIKAR_PHASE23_BROWSER_PROBE ||
    process.env.PIKAR_PHASE23_ALLOW_OWNER_BOOTSTRAP ||
    process.env.PIKAR_E2E_PROVISION
  )
    throw new Error("PHASE23_AUTH_ONLY_SCOPE_INVALID");
  const runId = process.env.PHASE23_RUN_ID;
  if (!runId || !/^[a-f0-9-]{36}$/.test(runId)) throw new Error("PHASE23_AUTH_ONLY_RUN_REQUIRED");
  const foreignContext = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    baseURL: process.env.PIKAR_E2E_BASE_URL ?? "http://127.0.0.1:3111",
  });
  try {
    const primaryUserId = await nonOwner(page);
    const foreignUserId = await nonOwner(await foreignContext.newPage(), true);
    if (primaryUserId === foreignUserId) throw new Error("PHASE23_AUTH_IDENTITIES_COLLIDE");
    await page.context().storageState({ path: "e2e/.auth/user.json" });
    await foreignContext.storageState({ path: "e2e/.auth/foreign.json" });
    const states = ["e2e/.auth/user.json", "e2e/.auth/foreign.json"].map((path) => ({
      path,
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    }));
    writeFileSync(
      resolve("../../output/playwright/phase23-acceptance", `auth-only-${runId}.json`),
      JSON.stringify(
        {
          schema: "phase23-auth-only.v1",
          observedAt: new Date().toISOString(),
          runId,
          primaryUserId,
          foreignUserId,
          primaryOwner: false,
          foreignOwner: false,
          freshPasswordSignIn: true,
          previousStateLoaded: false,
          states,
          parallelStateReuseVerified: false,
        },
        null,
        2,
      ),
      { flag: "wx" },
    );
    process.stdout.write("PHASE23_AUTH_ONLY_READINESS_PASSED\n");
  } finally {
    await foreignContext.close();
  }
});
