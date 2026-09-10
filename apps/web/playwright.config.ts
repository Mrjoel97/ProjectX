import { defineConfig, devices } from "@playwright/test";

const phase23Identities = process.env.PIKAR_PHASE23_TWO_IDENTITIES === "1";
if (
  phase23Identities &&
  (process.env.PIKAR_E2E_PROVISION === "1" || process.env.PIKAR_E2E_STORAGE_STATE)
) {
  throw new Error(
    "Phase 23 requires fresh non-owner auth setup; owner provisioning and storage-state overrides are incompatible.",
  );
}

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
  fullyParallel: !phase23Identities,
  ...(phase23Identities ? { workers: 1, retries: 0 } : {}),
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    // 27-12: env-overridable so the pack BROWSER EVIDENCE plane can be earned against production.
    // Evidence lives on ONE deployment's skills row, so a dev browser run certifies nothing on prod
    // — the same per-deployment rule that made `PIKAR_CONVEX_TARGET` necessary for the eval plane.
    // Local stays the default: an unflagged run can never point at production by accident.
    baseURL: process.env.PIKAR_E2E_BASE_URL ?? "http://127.0.0.1:3111",
    // A Phase 23 adaptation is private; traces include input text and auth-bearing network data.
    trace: phase23Identities ? "off" : "on-first-retry",
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
      use: {
        ...devices["Desktop Chrome"],
        storageState: process.env.PIKAR_E2E_STORAGE_STATE ?? "e2e/.auth/user.json",
      },
      // `setup` signs in through the local password form, which cannot work against a deployment
      // whose only human account is a Google identity. Supplying a storageState captured elsewhere
      // (see e2e/capture-prod-session.mjs) is therefore also the signal to SKIP that sign-in.
      dependencies: process.env.PIKAR_E2E_STORAGE_STATE ? [] : ["setup"],
    },
  ],
});
