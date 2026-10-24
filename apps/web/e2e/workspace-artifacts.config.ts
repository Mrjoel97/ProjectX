import { defineConfig } from "@playwright/test";
import { ARTIFACT_QA_APP, ARTIFACT_QA_PRIVATE } from "./workspaceArtifactFixtures";

if (process.env.PIKAR_E2E_BASE_URL && process.env.PIKAR_E2E_BASE_URL !== ARTIFACT_QA_APP)
  throw new Error("PHASE53_LOCAL_APP_TARGET_REQUIRED");

/** Opt-in disposable local stack only. No default auth setup, stored sessions or provider jobs. */
export default defineConfig({
  testDir: ".",
  testMatch: "workspace-artifacts.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  outputDir: `${ARTIFACT_QA_PRIVATE}/browser-qa/test-results`,
  use: {
    baseURL: ARTIFACT_QA_APP,
    browserName: "chromium",
    channel: "msedge",
    headless: true,
    storageState: { cookies: [], origins: [] },
    trace: "off",
    video: "off",
    screenshot: "off",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
});
