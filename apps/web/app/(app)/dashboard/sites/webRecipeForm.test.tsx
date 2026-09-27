import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const SOURCE = readFileSync(new URL("./WebRecipeForm.tsx", import.meta.url), "utf8");
const PAGE = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("structured web recipe form", () => {
  test("uses active-only server discovery and the server creation seam", () => {
    expect(SOURCE).toContain("listAvailable");
    expect(SOURCE).toContain("createProjectFromRecipe");
    expect(SOURCE).toContain('expectedAvailability: "tenant_discoverable"');
    expect(SOURCE).toContain("exact version");
    expect(SOURCE).toContain('family === "campaign-landing"');
    expect(SOURCE).toContain("Source roles:");
    expect(SOURCE).toContain("visual-quality guardrails");
    expect(SOURCE).not.toContain("candidateBody");
    expect(SOURCE).not.toContain("storefront");
  });

  test("keeps bounded labelled controls and honest recovery states", () => {
    for (const needle of [
      "aria-describedby",
      "aria-invalid",
      "Loading active recipes",
      "No active recipes",
      "Retry active recipes",
      "Your values are kept",
      "Design dials",
      'type="range"',
      "Create editable project",
    ])
      expect(SOURCE).toContain(needle);
  });

  test("leaves the advanced manual creation path available", () => {
    expect(PAGE).toContain("Advanced manual path");
    expect(PAGE).toContain("createDraft");
    expect(PAGE).toContain('create("landing")');
    expect(PAGE).toContain('create("site")');
    expect(PAGE).not.toContain("readiness");
  });
});
