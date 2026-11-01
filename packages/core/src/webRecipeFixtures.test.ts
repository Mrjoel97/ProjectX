import { describe, expect, test } from "vitest";
import {
  WEB_RECIPE_FIXTURE_CASE_IDS,
  WEB_RECIPE_FIXTURE_CASES_PER_FAMILY,
  WEB_RECIPE_FIXTURE_CORPUS,
  webRecipeFixtureContentHash,
  webRecipeFixturesFor,
} from "./webRecipeFixtures";
import { materializeWebRecipe } from "./webRecipes";

describe("canonical web-recipe qualification corpus", () => {
  test("binds the complete ordered inputs and expectations", () => {
    expect(webRecipeFixtureContentHash()).toBe(
      "fc9ff50300ef7de36d4b2e7f28ea32518e10d7f2ad4e18d258ec6e80caa2b379",
    );
    const inputChanged = WEB_RECIPE_FIXTURE_CORPUS.map((fixture, index) =>
      index === 0 ? { ...fixture, input: { brandName: "tampered" } } : fixture,
    );
    expect(webRecipeFixtureContentHash(inputChanged)).not.toBe(webRecipeFixtureContentHash());
    const expectationChanged = WEB_RECIPE_FIXTURE_CORPUS.map((fixture, index) =>
      index === 0 ? { ...fixture, expected: "reject" as const } : fixture,
    );
    expect(webRecipeFixtureContentHash(expectationChanged)).not.toBe(webRecipeFixtureContentHash());
  });
  test("contains the complete equal-sized three-family suite", () => {
    expect(WEB_RECIPE_FIXTURE_CORPUS).toHaveLength(WEB_RECIPE_FIXTURE_CASES_PER_FAMILY * 3);
    expect(new Set(WEB_RECIPE_FIXTURE_CASE_IDS).size).toBe(WEB_RECIPE_FIXTURE_CORPUS.length);
    for (const family of ["business-site", "campaign-landing", "storefront-catalogue"] as const) {
      expect(webRecipeFixturesFor(family)).toHaveLength(WEB_RECIPE_FIXTURE_CASES_PER_FAMILY);
      expect(webRecipeFixturesFor(family).map((fixture) => fixture.kind)).toEqual(
        expect.arrayContaining([
          "positive",
          "partial",
          "required",
          "unknown",
          "non-canonical",
          "max",
          "one-over",
          "injection",
          "cross-family",
          "changed-version",
          "changed-body",
          "changed-bundle",
          "repeat",
          "design-dial",
          "source-coverage",
          "source-influence",
          "source-removal",
          "consent",
          "attribution",
          "no-commerce",
        ]),
      );
    }
  });

  test("materializes every allowed positive/partial/max/consent/attribution case", () => {
    for (const fixture of WEB_RECIPE_FIXTURE_CORPUS) {
      if (fixture.expected !== "pass") continue;
      if (fixture.inputs) {
        for (const input of fixture.inputs)
          expect(() => materializeWebRecipe(fixture.family, input)).not.toThrow();
      } else {
        expect(() => materializeWebRecipe(fixture.family, fixture.input)).not.toThrow();
      }
    }
  });

  test("rejects every injection, bound, unknown, cross-family and commerce attempt", () => {
    for (const fixture of WEB_RECIPE_FIXTURE_CORPUS) {
      if (fixture.expected !== "reject") continue;
      const inputs = fixture.inputs ?? [fixture.input];
      for (const input of inputs) {
        if (fixture.kind === "cross-family") {
          const other = fixture.family === "business-site" ? "campaign-landing" : "business-site";
          expect(() => materializeWebRecipe(other, input)).toThrow();
        } else expect(() => materializeWebRecipe(fixture.family, input)).toThrow();
      }
    }
  });
});
