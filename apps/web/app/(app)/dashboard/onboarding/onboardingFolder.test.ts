import { describe, expect, test } from "vitest";
import {
  buildOnboardingFolderIntake,
  ONBOARDING_FOLDER_INTAKE_CHAR_CAP,
  type OnboardingFolderFile,
  onboardingFolderDisplayPath,
  onboardingFolderMimeType,
  selectOnboardingFolderFiles,
} from "./onboardingFolder";

function fixture(path: string, contents = "content", type = ""): OnboardingFolderFile {
  const name = path.split("/").at(-1) ?? path;
  return {
    name,
    type,
    size: contents.length,
    webkitRelativePath: path,
    text: async () => contents,
  };
}

describe("onboarding folder intake", () => {
  test("keeps supported business files, prioritises the overview, and excludes private validation", () => {
    const result = selectOnboardingFolderFiles([
      fixture("Zawadi/07-finance/monthly-actuals-2026.csv"),
      fixture("Zawadi/validation-private/ground-truth.md"),
      fixture("Zawadi/01-company/business-overview.md"),
      fixture("Zawadi/package.zip"),
    ]);

    expect(result.files.map((file) => file.name)).toEqual([
      "business-overview.md",
      "monthly-actuals-2026.csv",
    ]);
    expect(result.ignoredCount).toBe(2);
  });

  test("builds bounded, source-labelled onboarding context from text documents", async () => {
    const intake = await buildOnboardingFolderIntake([
      fixture("Zawadi/01-company/business-overview.md", "A hospitality growth studio."),
      fixture("Zawadi/02-strategy/one-page-strategy.md", "Reach ten retained clients."),
      fixture("Zawadi/brand.png", "binary", "image/png"),
    ]);

    expect(intake).toContain("01-company/business-overview.md");
    expect(intake).toContain("A hospitality growth studio.");
    expect(intake).toContain("02-strategy/one-page-strategy.md");
    expect(intake.length).toBeLessThanOrEqual(ONBOARDING_FOLDER_INTAKE_CHAR_CAP);
  });

  test("preserves relative provenance and resolves untyped Office files", () => {
    const file = fixture("MajiPulse/03-product/pitch-deck.pptx");
    expect(onboardingFolderDisplayPath(file)).toBe("03-product/pitch-deck.pptx");
    expect(onboardingFolderMimeType(file)).toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  });
});
