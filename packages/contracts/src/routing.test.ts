import { describe, expect, test } from "vitest";
import { parseRouting, routingSchema } from "./routing";

describe("routingDecision contract (AGNT-01/02/03)", () => {
  const ok = {
    route: "direct_llm" as const,
    steps: [{ n: 1, description: "Draft email" }],
    rationale: "single-step draft",
  };

  test("a well-formed routing decision parses", () => {
    const r = parseRouting(ok);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.route).toBe("direct_llm");
      expect(r.value.steps).toHaveLength(1);
    }
  });

  test("direct_tool and sub_agent are recognized enum members", () => {
    expect(routingSchema.safeParse({ ...ok, route: "direct_tool" }).success).toBe(true);
    // sub_agent is valid here even though it is unimplemented downstream.
    expect(routingSchema.safeParse({ ...ok, route: "sub_agent" }).success).toBe(true);
  });

  test("an unknown route value is rejected as unknown_route, never defaulted", () => {
    const r = parseRouting({ ...ok, route: "foo" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_route");
  });

  test("missing steps fails parse", () => {
    expect(parseRouting({ route: "direct_llm", rationale: "y" }).ok).toBe(false);
  });

  test("an empty steps array fails parse (AGNT-02 needs a step plan)", () => {
    expect(parseRouting({ ...ok, steps: [] }).ok).toBe(false);
  });

  test("a malformed shape fails parse", () => {
    expect(parseRouting("not an object").ok).toBe(false);
    expect(parseRouting({ ...ok, steps: [{ n: "one", description: "x" }] }).ok).toBe(false);
  });
});
