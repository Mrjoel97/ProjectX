import { defineConfig, devices } from "@playwright/test";

/**
 * First UI E2E harness for the repo (03.1-02). Feature specs land in later
 * cockpit plans (05, 09). Specs run against an ALREADY-RUNNING local stack:
 * `convex dev` (NOT --once) + `next dev` on :3111 — the offline `SMOKE::`
 * delivery path needs the live local backend (see e2e/README.md + STATE.md).
 *
 * ponytail: no webServer auto-start — reuseExistingServer mirrors the
 * smokeRun.mjs live-deployment convention. Add a webServer block only if CI
 * needs a cold-boot harness.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3111",
    trace: "on-first-retry",
  },
  projects: [
    // 27-11: creates the OWNER account the pack candidate preview needs, on a machine that has
    // none. Opt-in via PIKAR_E2E_PROVISION=1 — it is not part of an ordinary spec run, because it
    // seeds an invite and grants owner, and neither belongs in the default path. Runs BEFORE
    // `setup`, which then signs that account in through the real form.
    { name: "provision", testMatch: /provision-owner\.setup\.ts/ },
    // Signs in once and saves storageState; feature specs depend on it (see auth.setup.ts).
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      dependencies: process.env.PIKAR_E2E_PROVISION === "1" ? ["provision"] : [],
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
});
