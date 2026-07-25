import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import * as specialists from "./specialists";
import {
  SPECIALIST_ROUTES,
  SPECIALISTS,
  resolveSpecialist,
  specialistMemoBody,
  wouldCycle,
} from "./specialists";

// 15-02 fills the Wave-0 registry. Two halves are asserted here:
//   (a) the FAIL-CLOSED half 15-01 pinned — it must keep holding now that routes exist,
//   (b) the CAPABILITY half — the tool-set is code-owned, so a widening edit must fail a test.
describe("resolveSpecialist (DISP-01 fail-closed route lookup)", () => {
  test("the registry is exactly the three growth specialists", () => {
    expect(SPECIALIST_ROUTES).toEqual(["offer-architect", "money-model-designer", "lead-engine"]);
    expect(Object.keys(SPECIALISTS).sort()).toEqual([...SPECIALIST_ROUTES].sort());
  });

  test("a registered route resolves to its skill body name", () => {
    const r = resolveSpecialist("offer-architect");
    expect(r.ok).toBe(true);
    // The §5 registry row name — the same literal `OFFER_ARCHITECT_SKILL` carries in @pikar/contracts.
    expect(r.ok && r.spec.skillName).toBe("offer-architect");
    expect(r.ok && r.route).toBe("offer-architect");
  });

  // @pikar/contracts is NOT a dependency of @pikar/core (package.json), so the three skill names
  // are inlined in specialists.ts. This is the binding that keeps the copy honest: a rename on
  // either side fails here. Source-text read, the skillBodies.test.ts / dispatchGuard.test.ts idiom.
  test("every skillName matches its @pikar/contracts constant", () => {
    const src = readFileSync(new URL("../../contracts/src/skill.ts", import.meta.url), "utf8");
    const constFor: Record<string, string> = {
      "offer-architect": "OFFER_ARCHITECT_SKILL",
      "money-model-designer": "MONEY_MODEL_DESIGNER_SKILL",
      "lead-engine": "LEAD_ENGINE_SKILL",
    };
    for (const route of SPECIALIST_ROUTES) {
      const name = SPECIALISTS[route].skillName;
      expect(constFor[name], `no contracts constant is mapped for skillName "${name}"`).toBeTruthy();
      expect(src, `${constFor[name]} no longer equals "${name}" in packages/contracts/src/skill.ts`).toContain(
        `export const ${constFor[name]} = "${name}" as const;`,
      );
    }
  });

  // Equality over the WHOLE registry, deliberately: a write tool added to ANY specialist fails
  // here. The tool-set is a CAPABILITY GRANT (ADR-007) — widening it is a privilege escalation,
  // so it must never be a quiet one-line edit. searchVault is read-only and tenant-scoped.
  test("every specialist's tool-set is exactly [searchVault] — no write tool, ever", () => {
    expect(SPECIALIST_ROUTES.map((r) => [r, [...SPECIALISTS[r].tools]])).toEqual([
      ["offer-architect", ["searchVault"]],
      ["money-model-designer", ["searchVault"]],
      ["lead-engine", ["searchVault"]],
    ]);
  });

  test("every specialist has a DISTINCT dispatch* trace literal", () => {
    const steps = SPECIALIST_ROUTES.map((r) => SPECIALISTS[r].stepTool);
    for (const s of steps) expect(s).toMatch(/^dispatch[A-Z]/);
    expect(new Set(steps).size, "two specialists share a trace literal").toBe(steps.length);
  });

  // 15-02 registers the three. A plausible-LOOKING route that is not registered must still refuse.
  test("an unregistered route → unknown_route", () => {
    expect(resolveSpecialist("pricing-strategist")).toEqual({ ok: false, reason: "unknown_route" });
  });

  // diagnose.ts emits a deliberate `route: ""` on the not-enough-data ask branch,
  // and `gap.route` persists as v.string(), so "" genuinely reaches this function.
  test("the empty route → unknown_route", () => {
    expect(resolveSpecialist("")).toEqual({ ok: false, reason: "unknown_route" });
  });

  // No normalization, no case folding, no fuzzy match: a route the system cannot validate
  // EXACTLY is a route it must not take.
  test("a wrong-case route → unknown_route (no normalization)", () => {
    expect(resolveSpecialist("Offer-Architect")).toEqual({ ok: false, reason: "unknown_route" });
    expect(resolveSpecialist("offer-architect ")).toEqual({ ok: false, reason: "unknown_route" });
  });

  test("a traversal-shaped route → unknown_route", () => {
    expect(resolveSpecialist("../../etc/passwd")).toEqual({ ok: false, reason: "unknown_route" });
  });

  // A plain `SPECIALISTS[route]` lookup returns Object.prototype for "__proto__" /
  // "constructor" / "toString" — truthy, so a truthiness guard would ROUTE on them.
  test.each(["__proto__", "constructor", "toString", "hasOwnProperty"])(
    "the prototype key %s → unknown_route",
    (route) => {
      expect(resolveSpecialist(route)).toEqual({ ok: false, reason: "unknown_route" });
    },
  );

  test("never throws — a governed stop RETURNS", () => {
    expect(() => resolveSpecialist("anything at all")).not.toThrow();
  });

  test("there is no exported default/fallback specialist", () => {
    const defaults = Object.keys(specialists).filter((k) => /default|fallback/i.test(k));
    expect(defaults).toEqual([]);
  });
});

// ── The coverage bind (SC #1) ────────────────────────────────────────────────
//
// "No gap is left on the old memo behaviour" is only true if EVERY route diagnose() can emit
// resolves. The type closes it at compile time (`Prescription.route: SpecialistRoute | ""`), but a
// type is invisible to vitest and a `as string` cast would silently re-open it — so the literals
// are read off diagnose.ts's source and fed through the real lookup. If diagnose() grows a gate
// with a new route, this fails until the specialist is registered.
describe("coverage bind: every route diagnose() emits resolves", () => {
  /** Every route literal in diagnose.ts: the `route:` object-literal branch + each `rx()` 3rd arg. */
  function diagnoseRouteLiterals(): string[] {
    const src = readFileSync(new URL("./growth/diagnose.ts", import.meta.url), "utf8").replace(
      /\/\/[^\n]*/g,
      "",
    );
    const out: string[] = [];
    for (const m of src.matchAll(/\broute:\s*"([^"]*)"/g)) out.push(m[1]!);
    // Balanced-depth slice of each rx(...) call, split on DEPTH-0 commas (the dispatchGuard.test.ts
    // idiom) — robust to reformatting and to the template-literal constraint arg's nested parens.
    for (const m of src.matchAll(/\brx\(/g)) {
      let depth = 1;
      let i = m.index + m[0].length;
      let start = i;
      const args: string[] = [];
      for (; i < src.length && depth > 0; i++) {
        const c = src[i]!;
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth--;
        else if (c === "," && depth === 1) {
          args.push(src.slice(start, i));
          start = i + 1;
        }
      }
      args.push(src.slice(start, i - 1));
      const third = (args[2] ?? "").trim();
      const lit = third.match(/^"([^"]*)"$/);
      // A non-literal 3rd arg means the scan can no longer see the routes — fail loudly rather
      // than silently cover nothing.
      expect(lit, `diagnose.ts: rx()'s route argument is not a plain string literal: ${third}`).toBeTruthy();
      out.push(lit![1]!);
    }
    return out;
  }

  test("every non-empty diagnose() route is a registered specialist", () => {
    const literals = diagnoseRouteLiterals();
    // Non-vacuity: a refactor that hides the literals from the scan must fail, not pass with 0.
    expect(literals.length, "found no route literals in diagnose.ts — did the scan break?").toBeGreaterThan(5);
    expect(literals).toContain(""); // the deliberate not-enough-data ask branch
    for (const route of literals) {
      if (route === "") continue;
      expect(resolveSpecialist(route).ok, `diagnose() can emit "${route}" but nothing resolves it`).toBe(
        true,
      );
    }
  });
});

// ── wouldCycle: the A→B→A refusal predicate (lives in core so it is unit-testable) ───────────
describe("wouldCycle (dispatch cycle refusal)", () => {
  test("an empty ancestry never cycles", () => {
    expect(wouldCycle([], "offer-architect")).toBe(false);
  });

  test("re-entering a route already in the ancestry cycles", () => {
    expect(wouldCycle(["offer-architect"], "offer-architect")).toBe(true);
    // The literal A→B→A shape MAX_DEPTH alone would not catch once the cap rises.
    expect(wouldCycle(["offer-architect", "lead-engine"], "offer-architect")).toBe(true);
  });

  test("a sibling route in the ancestry does not cycle", () => {
    expect(wouldCycle(["lead-engine"], "offer-architect")).toBe(false);
  });
});

// ── specialistMemoBody: the deterministic body composer (a DOCUMENT, not a prompt — §5 n/a) ──
describe("specialistMemoBody", () => {
  test("attributes the specialist and carries the body verbatim", () => {
    const out = specialistMemoBody({ route: "offer-architect", body: "BODY-TEXT", incomplete: false });
    expect(out.startsWith("> Produced by the **offer-architect** specialist.")).toBe(true);
    expect(out).toContain("BODY-TEXT");
    expect(out).not.toMatch(/cost ceiling/i);
  });

  test("an incomplete run carries the cost-ceiling marker BEFORE the body", () => {
    const out = specialistMemoBody({ route: "lead-engine", body: "BODY-TEXT", incomplete: true });
    expect(out).toMatch(/cost ceiling/i);
    expect(out.indexOf("Incomplete")).toBeLessThan(out.indexOf("BODY-TEXT"));
    expect(out.startsWith("> Produced by the **lead-engine** specialist.")).toBe(true);
  });
});
