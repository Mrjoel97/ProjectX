import { describe, expect, test } from "vitest";
import { RAW_BUILDER_ALLOWLIST } from "./lib/allowlist";
import { stableTenant } from "./lib/functions";

// Static scan: read every convex source at build time. edge-runtime has no node:fs,
// so we inline file contents via Vite's import.meta.glob raw loader instead.
const sources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Bans named imports of `query` or `mutation` from the generated server module.
// `internalQuery`/`internalMutation`/`internalAction` (capitalised) are the sanctioned
// exception and never match (regex is case-sensitive; word boundary before lowercase).
const BANNED =
  /import\s*\{[^}]*\b(query|mutation)\b[^}]*\}\s*from\s*["']\.\.?\/_generated\/server["']/;

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

describe("import guard: raw builders are scoped-unavoidable (SC-2)", () => {
  const entries = Object.entries(sources).filter(([path]) => {
    const name = basename(path);
    if (name.endsWith(".test.ts")) return false; // tests may name builders in strings
    if (path.endsWith("lib/functions.ts")) return false; // the sole wrapper module
    if (path.includes("/_generated/")) return false; // codegen output
    if (RAW_BUILDER_ALLOWLIST.includes(name)) return false; // sanctioned internal modules
    return true;
  });

  test("there is at least one non-exempt module to scan", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  for (const [path, content] of entries) {
    test(`${basename(path)} does not import raw query/mutation from _generated/server`, () => {
      expect(BANNED.test(content)).toBe(false);
    });
  }
});

// tenantId must be stable per USER across login sessions. Convex Auth's
// identity.subject is `<userId>|<sessionId>`; stableTenant takes the userId
// segment. Regression guard for the per-session-scoping bug (see spec
// 2026-07-21-tenant-scope-per-session-fix-design).
describe("stableTenant: per-user scope, not per-session", () => {
  test("strips the |sessionId suffix", () => {
    expect(stableTenant("user123|sess456")).toBe("user123");
  });
  test("subject with no pipe is returned unchanged", () => {
    expect(stableTenant("user123")).toBe("user123");
  });
  test("only the first segment is the userId", () => {
    expect(stableTenant("user123|s1|s2")).toBe("user123");
  });
});
