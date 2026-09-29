import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import playwrightConfig from "../playwright.config";

const webRoot = resolve(import.meta.dirname, "..");
const playwrightModule = resolve(webRoot, "node_modules/@playwright/test");
const tempRoot = resolve(tmpdir());
const tempPrefix = "pikar-playwright-discovery-";
let fixtureRoot: string | undefined;

afterEach(() => {
  if (!fixtureRoot) return;
  if (dirname(fixtureRoot) !== tempRoot || !basename(fixtureRoot).startsWith(tempPrefix)) {
    throw new Error("refusing to remove an unexpected discovery fixture path");
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
  fixtureRoot = undefined;
});

describe("Playwright discovery", () => {
  // This spawns the real Playwright CLI and lists a suite, which costs ~4s on its own. Vitest's
  // 5s default is therefore inside the noise: under `turbo`'s parallel packages the test timed out
  // at 5000ms while passing in isolation, which is a gate that is red for a non-reason. The budget
  // is set explicitly and generously because the assertion that matters is the spawn's exit status
  // and the listed/ignored paths - never the wall clock. A genuinely hung spawn still fails on the
  // spawnSync timeout below, and a genuinely slow machine now fails on something real.
  it("lists a real spec while ignoring auth runtime artifacts", () => {
    expect(playwrightConfig.testIgnore).toEqual(["**/.auth/**"]);
    fixtureRoot = mkdtempSync(join(tempRoot, tempPrefix));
    const testDir = join(fixtureRoot, "e2e");
    const authDir = join(testDir, ".auth");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(
      join(testDir, "valid-sentinel.spec.ts"),
      `const { test } = require(${JSON.stringify(playwrightModule)}); test("VALID_DISCOVERY_SENTINEL", () => {});\n`,
    );
    writeFileSync(
      join(authDir, "auth-artifact.spec.ts"),
      'throw new Error("AUTH_ARTIFACT_MUST_NOT_BE_IMPORTED");\n',
    );
    const configPath = join(fixtureRoot, "playwright.config.cjs");
    writeFileSync(
      configPath,
      `const { defineConfig } = require(${JSON.stringify(playwrightModule)});\n` +
        `module.exports = defineConfig({ testDir: ${JSON.stringify(testDir)}, testIgnore: ${JSON.stringify(playwrightConfig.testIgnore)}, projects: [{ name: "chromium" }] });\n`,
    );

    const result = spawnSync(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        "--config",
        configPath,
        "--list",
        "--project=chromium",
      ],
      { cwd: webRoot, encoding: "utf8", timeout: 60_000 },
    );
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(0);
    expect(output.includes("VALID_DISCOVERY_SENTINEL")).toBe(true);
    expect(output.includes("auth-artifact.spec.ts")).toBe(false);
    expect(output.includes("AUTH_ARTIFACT_MUST_NOT_BE_IMPORTED")).toBe(false);
  }, 60_000);
});
