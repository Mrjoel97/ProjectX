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

// TWO INDEPENDENT ALLOWLISTS GUARD THE SAME RULE, and nothing made them agree until this test.
//
// `RAW_BUILDER_ALLOWLIST` (above) exempts a module from the RUNTIME scan. Biome's
// `style/noRestrictedImports` is exempted by a SEPARATE `overrides[].includes` array in
// biome.json. A module on the first list but not the second passes `pnpm test` and then fails
// `biome ci --diagnostic-level=error` in CI — and a red CI run means the workflow_run-gated
// production deploy never fires. That is exactly what happened while 25-01 was being written.
//
// Most allowlist entries never need the Biome override because they import the CAPITALISED
// `internalQuery`/`internalMutation`/`internalAction`, which neither guard bans. Only a module
// that really does import the lowercase public builders needs both, so that — not list equality
// — is what this asserts.
describe("the runtime allowlist and the Biome override cannot silently diverge", () => {
  const biomeConfig = import.meta.glob("../../../biome.json", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  const overrideIncludes: string[] = Object.values(biomeConfig).flatMap((raw) =>
    (JSON.parse(raw).overrides ?? []).flatMap(
      (o: { linter?: { rules?: { style?: Record<string, string> } }; includes?: string[] }) =>
        o.linter?.rules?.style?.noRestrictedImports === "off" ? (o.includes ?? []) : [],
    ),
  );

  test("biome.json was actually read, so this suite cannot pass vacuously", () => {
    expect(Object.keys(biomeConfig)).toHaveLength(1);
    expect(overrideIncludes).toContain("packages/backend/convex/lib/functions.ts");
  });

  const publicBuilderImporters = Object.entries(sources)
    .filter(([path, content]) => !basename(path).endsWith(".test.ts") && BANNED.test(content))
    .map(([path]) => `packages/backend/convex/${path.replace(/^\.\//, "")}`);

  test("every module importing a raw public builder is exempt in BOTH places", () => {
    // Non-empty by construction: lib/functions.ts always imports them.
    expect(publicBuilderImporters.length).toBeGreaterThan(0);
    for (const module of publicBuilderImporters) {
      // Biome is the gate that actually fails CI, so EVERY such module must be listed there.
      expect(overrideIncludes).toContain(module);
      // The runtime scan exempts `lib/functions.ts` by its own dedicated filter above rather
      // than by basename, so only the other modules have to appear in the basename list.
      if (!module.endsWith("lib/functions.ts")) {
        expect(RAW_BUILDER_ALLOWLIST).toContain(basename(module));
      }
    }
  });
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
