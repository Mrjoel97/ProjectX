import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

describe("onboarding business-brief upload", () => {
  test("uses the native input as the paperclip click target", () => {
    expect(source).toContain('data-testid="onboarding-file-input"');
    expect(source).toContain("onboarding-file-picker");
    expect(source).not.toContain("fileInputRef.current?.click()");
    expect(source).not.toContain('style={{ display: "none" }}');
  });

  test("accepts Office documents and exposes a native onboarding directory picker", () => {
    expect(source).toContain(".docx");
    expect(source).toContain(".xlsx");
    expect(source).toContain(".pptx");
    expect(source).toContain('data-testid="onboarding-folder-input"');
    expect(source).toContain("ONBOARDING_DIRECTORY_INPUT_ATTRIBUTES");
    expect(source).toContain("uploadFolder(files)");
    expect(source).toContain("ZIP files must be unzipped");
  });

  // The composer row was wrapped in `{!profile && (…)}`, so the FIRST typed message set `profile`
  // and unmounted the paperclip, the folder picker and the mic — a user who typed a sentence before
  // attaching their business folder could never attach it at all.
  test("the intake modalities survive the first turn", () => {
    const row = source.slice(
      source.indexOf('display: "flex", alignItems: "center", gap: "0.35rem"'),
      source.indexOf('aria-label="Send"'),
    );
    expect(row).toContain('data-testid="onboarding-file-input"');
    expect(row).toContain('data-testid="onboarding-folder-input"');
    expect(row).not.toContain("!profile &&");
  });

  // …and the other half of that fix: a document handed over mid-conversation must be an ordinary
  // user turn. Routing it back through the opening path would re-run `extractProfile` and restart
  // `runTurn` with an empty history, discarding every fact already answered.
  test("a mid-conversation upload is a turn, not a restart", () => {
    expect(source).toContain("void submitIntake(extracted)");
    expect(source).toContain("await runTurn(intakeText, slots, transcript)");
    expect(source).not.toContain("openingTurn");
  });
});
