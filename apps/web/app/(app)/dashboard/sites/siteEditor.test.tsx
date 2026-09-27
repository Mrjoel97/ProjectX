import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const SOURCE = readFileSync(new URL("./SiteEditor.tsx", import.meta.url), "utf8");

describe("protected site editor", () => {
  test("uses authenticated Convex lifecycle calls and exact revision/hash controls", () => {
    expect(SOURCE).toContain("api.webProjects.getProject");
    expect(SOURCE).toContain("api.webProjects.getVersion");
    expect(SOURCE).toContain("expectedRevision");
    expect(SOURCE).toContain("contentHash");
    expect(SOURCE).toContain("Approve exact version");
    expect(SOURCE).toContain("Publish");
    expect(SOURCE).toContain("api.webProjects.updateVersion");
    expect(SOURCE).toContain("api.webProjects.rollback");
    expect(SOURCE).toContain("Version history");
  });

  test("surfaces loading, refusal, stale, and hosting truth without raw HTML injection", () => {
    expect(SOURCE).toContain("Loading editor");
    expect(SOURCE).toContain("unavailable");
    expect(SOURCE).toContain("stale");
    expect(SOURCE).toContain("Pikar platform path");
    expect(SOURCE).not.toContain("dangerouslySetInnerHTML");
  });

  test("keeps immutable recipe origin separate from current edited content", () => {
    expect(SOURCE).toContain("Started from");
    expect(SOURCE).toContain("recipeRef.name");
    expect(SOURCE).toContain("recipeRef.version");
    expect(SOURCE).toContain("bodyHash");
    expect(SOURCE).toContain("designProfile.bundleHash");
    expect(SOURCE).toContain("Current content");
    expect(SOURCE).toContain("Manual project");
  });
});
