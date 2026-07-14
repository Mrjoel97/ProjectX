import { describe, expect, it } from "vitest";
import { normalizeName } from "./normalize";

describe("normalizeName — cross-doc entity dedup key (VALT-02)", () => {
  it("collapses case, trim, and internal whitespace so the same name maps to one key", () => {
    expect(normalizeName("  Acme   Corp ")).toBe(normalizeName("acme corp"));
    expect(normalizeName("ACME\tCorp")).toBe(normalizeName("acme corp"));
    expect(normalizeName("Acme\n Corp")).toBe("acme corp");
  });

  it("preserves distinct names (no over-collapse)", () => {
    expect(normalizeName("Acme")).not.toBe(normalizeName("Acme Inc"));
    expect(normalizeName("Project X")).not.toBe(normalizeName("Project Y"));
  });

  it("is idempotent", () => {
    const once = normalizeName("  Foo   Bar ");
    expect(normalizeName(once)).toBe(once);
  });
});
