import { defineConfig } from "@playwright/test";

/** Offline rendered-artifact checks: no application server, auth, registry or model provider. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "online-presence-design.spec.ts",
  outputDir: "../../.tmp/web-design-browser",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    browserName: "chromium",
    ...(process.env.PIKAR_DESIGN_BROWSER ? { channel: process.env.PIKAR_DESIGN_BROWSER } : {}),
    contextOptions: { reducedMotion: "reduce" },
    deviceScaleFactor: 1,
    trace: "off",
  },
});
