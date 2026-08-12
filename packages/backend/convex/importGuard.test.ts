import { describe, expect, test } from "vitest";
import { RAW_BUILDER_ALLOWLIST } from "./lib/allowlist";

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

// The wrapper module must derive identity from the auth package's OFFICIAL adapter, not
// from a subject parser we maintain ourselves. This is a SOURCE guard rather than a
// behavioural one because the behaviours (stable-per-user scope, cross-user isolation) are
// already proven in tenant.test.ts against real `users` rows — what a behavioural test
// CANNOT catch is someone reintroducing a hand-rolled parser that happens to agree today
// and drifts after an auth-package bump. Complements, not replaces, the raw-builder scan
// above. Regression guard for the per-session-scoping bug (spec
// 2026-07-21-tenant-scope-per-session-fix-design).
describe("wrapper identity: the official auth adapter, not a hand-rolled parser", () => {
  const wrapperSource = sources["./lib/functions.ts"];
  // Strip comments before the negative assertions. Without this the guard punishes its own
  // documentation: a doc comment WARNING against a banned identity source reads exactly like
  // using one, so the file could not explain why the rule exists without failing it.
  const wrapperCode = (wrapperSource ?? "").replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

  // Anti-vacuity: every assertion below is `expect(string).toContain/not.toContain`, which
  // would pass trivially against an empty string if the glob key ever changes.
  test("the wrapper source was actually found by the static scan", () => {
    expect(wrapperSource).toBeTypeOf("string");
    expect(wrapperCode).toContain("customQuery");
  });

  test("identity comes from getAuthUserId", () => {
    expect(wrapperCode).toContain("getAuthUserId");
    expect(wrapperCode).toContain('from "@convex-dev/auth/server"');
  });

  test("no hand-written stableTenant parser survives in production source", () => {
    expect(wrapperCode).not.toContain("stableTenant");
  });

  test("authorization never keys on the session-bearing subject or tokenIdentifier", () => {
    // Both carry the `|<sessionId>` suffix, so either would re-scope a user on every login.
    expect(wrapperCode).not.toContain("tokenIdentifier");
    expect(wrapperCode).not.toContain("identity.subject");
  });
});

// GOVN-01: the known global controls are pinned to owner wrappers by NAME. This is a
// deliberately dumb table, not a regex that tries to infer "admin-ish" semantics — the
// durable rule for future endpoints lives in code review and docs/playbooks/authorization.md.
// What this catches is a refactor silently downgrading a gated endpoint back to a tenant
// wrapper, which the behavioural tests would also catch but only if someone remembers to
// keep them.
describe("owner-gated endpoints stay owner-gated", () => {
  const PROTECTED: ReadonlyArray<[string, string, string]> = [
    ["./optimizerConfig.ts", "getOptimizerStatus", "ownerQuery"],
    ["./optimizerConfig.ts", "setOptimizerEnabled", "ownerMutation"],
    ["./skills.ts", "activateCandidate", "ownerMutation"],
    ["./skills.ts", "candidatesForReview", "ownerQuery"],
    // 21-04 — the TENANT overlay's owner boundary. These three are the only way a tenant row can
    // become `active`, and `tenantCandidatesForReview` is the only surface that discloses another
    // tenant's authored adaptation beside a raw registry body. Downgrading any of them to a tenant
    // wrapper would hand every signed-in user the deployment's candidate queue and the ability to
    // put a body in front of a model.
    ["./skills.ts", "tenantCandidatesForReview", "ownerQuery"],
    ["./skills.ts", "activateTenantCandidate", "ownerMutation"],
    ["./skills.ts", "rollbackTenantSkill", "ownerMutation"],
  ];

  for (const [path, name, wrapper] of PROTECTED) {
    test(`${basename(path)}:${name} is declared with ${wrapper}`, () => {
      const source = sources[path];
      // Anti-vacuity: a renamed or deleted file must FAIL here, not silently pass.
      expect(source, `${path} was not found by the static scan`).toBeTypeOf("string");
      expect(source).toContain(`export const ${name} =`);
      expect(source).toContain(`export const ${name} = ${wrapper}(`);
    });
  }
});
