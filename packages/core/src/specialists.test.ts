import { describe, expect, test } from "vitest";
import * as specialists from "./specialists";
import { SPECIALIST_ROUTES, resolveSpecialist } from "./specialists";

// Wave 0 (15-01): the registry is DELIBERATELY empty. These assertions pin the
// FAIL-CLOSED half — the half that must hold before 15-02 registers anything, and
// must keep holding after it does. Every case here asserts the SAME result, which
// is the point: there is no input that yields a default specialist.
describe("resolveSpecialist (DISP-01 fail-closed route lookup)", () => {
  test("the registry is empty at Wave 0", () => {
    expect(SPECIALIST_ROUTES).toEqual([]);
  });

  // 15-02 registers this one. Until it does, a real-looking route must still refuse.
  test("an unregistered route → unknown_route", () => {
    expect(resolveSpecialist("offer-architect")).toEqual({ ok: false, reason: "unknown_route" });
  });

  // diagnose.ts emits a deliberate `route: ""` on the not-enough-data ask branch,
  // and `gap.route` persists as v.string(), so "" genuinely reaches this function.
  test("the empty route → unknown_route", () => {
    expect(resolveSpecialist("")).toEqual({ ok: false, reason: "unknown_route" });
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
