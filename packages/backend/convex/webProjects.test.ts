import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const SOURCE = readFileSync(new URL("./webProjects.ts", import.meta.url), "utf8");

/**
 * These source guards complement the Convex tests that run after codegen. They remain useful in
 * the repository's dependency-incomplete state because they prove the critical boundary without
 * fabricating a live deployment or provider/domain evidence.
 */
describe("Phase 48 web project lifecycle adapter", () => {
  test("all authenticated lifecycle writes use tenant wrappers", () => {
    expect(SOURCE).toContain("tenantMutation");
    for (const name of [
      "createDraft",
      "saveDraft",
      "approveVersion",
      "publishVersion",
      "updateVersion",
      "unpublish",
      "rollback",
    ]) {
      expect(SOURCE).toMatch(new RegExp(`export const ${name} = tenantMutation\\(`));
    }
    expect(SOURCE).toContain("expectedRevision");
    expect(SOURCE).toContain("approvedContentHash");
  });

  test("version history and deterministic rendered artifacts are append-only and refs-only", () => {
    expect(SOURCE).toContain('ctx.db.insert("webProjectVersions"');
    expect(SOURCE).not.toMatch(/ctx\.db\.patch\([^\n]+webProjectVersions/);
    expect(SOURCE).not.toMatch(/ctx\.db\.delete\([^\n]+webProjectVersions/);
    expect(SOURCE).toContain("artifactHtml: artifacts[0]?.html");
    expect(SOURCE).toContain("artifacts,");
    expect(SOURCE).not.toContain("ctx.storage.store");
    expect(SOURCE).toContain("appendAudit");
    expect(SOURCE).toContain("publicationPayload");
    expect(SOURCE).not.toContain("email");
    expect(SOURCE).not.toContain("userAgent");
  });

  test("publication readiness is explicitly Pikar-owned platform runtime", () => {
    expect(SOURCE).toContain('project.domainMode === "platform_path"');
    expect(SOURCE).toContain('hostingDeclaration.hosting === "pikar_platform_path"');
    expect(SOURCE).toContain('source === "tenant_structured_content"');
    expect(SOURCE).toContain('state: "invalid_host"');
    expect(SOURCE).toContain('state: "unpublished"');
  });
});
