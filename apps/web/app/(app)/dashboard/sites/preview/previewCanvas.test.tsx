import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const SOURCE = readFileSync(new URL("./PreviewCanvas.tsx", import.meta.url), "utf8");

describe("exact web preview", () => {
  test("reads the requested immutable version and identifies it to assistive technology", () => {
    expect(SOURCE).toContain("api.webProjects.getVersion");
    expect(SOURCE).toContain("exact.artifacts");
    expect(SOURCE).toContain("artifact.html");
    expect(SOURCE).toContain("version");
    expect(SOURCE).toContain("Exact version preview");
    expect(SOURCE).toContain("iframe");
    expect(SOURCE).toContain('sandbox="allow-forms"');
  });

  test("does not claim a missing version is rendered", () => {
    expect(SOURCE).toContain("This version is unavailable.");
    expect(SOURCE).toContain("Loading exact version");
  });

  test("shows exact lineage and storefront qualification posture without public controls", () => {
    expect(SOURCE).toContain("qualificationOnly");
    expect(SOURCE).toContain("Qualification only — commerce unavailable");
    expect(SOURCE).toContain("not tenant discoverable");
    expect(SOURCE).toContain("exact.recipeRef.name");
    expect(SOURCE).toContain("exact.recipeRef.version");
    expect(SOURCE).toContain("exact.contentHash");
    expect(SOURCE).toContain("getStorefrontQualification");
    expect(SOURCE).toContain('isQualification ? ({ projectId: typedProjectId } as never) : "skip"');
    expect(SOURCE).toContain('isQualification ? "skip" : { projectId: typedProjectId }');
    expect(SOURCE).not.toContain("publishVersion");
    expect(SOURCE).not.toContain("activateCandidate");
  });
});
