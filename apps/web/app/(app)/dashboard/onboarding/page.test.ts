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
});
