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
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
