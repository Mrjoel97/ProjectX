import { describe, expect, test } from "vitest";
import {
  type BusinessProfile,
  PERSONAS,
  type Persona,
  decideConfirm,
  deserializeProfile,
  isPersona,
  serializeProfile,
  validateProfile,
} from "./businessProfile";

const complete: BusinessProfile = {
  name: "Acme Roasters",
  oneLineDescription: "Small-batch specialty coffee roaster and subscription service.",
  persona: "solopreneur",
  stage: "early-revenue",
  offering: "Single-origin coffee beans by monthly subscription.",
  targetCustomer: "Home coffee enthusiasts in North America.",
  primaryGoals: ["Grow subscriber base to 500", "Launch a wholesale line"],
  knownConstraints: ["One-person operation", "Limited roasting capacity"],
};

describe("Persona enum (SC#1 — enterprise is not emittable)", () => {
  test("PERSONAS is exactly solopreneur | startup | sme", () => {
    expect([...PERSONAS]).toEqual(["solopreneur", "startup", "sme"]);
  });

  test("isPersona accepts the three members and rejects enterprise", () => {
    for (const p of PERSONAS) expect(isPersona(p)).toBe(true);
    expect(isPersona("enterprise")).toBe(false);
    expect(isPersona("")).toBe(false);
    expect(isPersona("SME")).toBe(false); // case-sensitive
  });
});

describe("decideConfirm (SC#1 — persona is always confirmed, never assumed)", () => {
  test("EVERY persona inference returns needsConfirm: true — no auto-commit", () => {
    for (const persona of PERSONAS) {
      expect(decideConfirm({ persona })).toEqual({ persona, needsConfirm: true });
    }
  });

  test("there is no branch that returns needsConfirm: false", () => {
    // Exhaustive over the whole persona domain: not one is auto-committed.
    // Typed as boolean[] on purpose — the return type is literally `true`, so this
    // runtime check backstops the (already stronger) type-level guarantee.
    const results: boolean[] = PERSONAS.map((persona) => decideConfirm({ persona }).needsConfirm);
    expect(results.every((n) => n === true)).toBe(true);
    expect(results.some((n) => n === false)).toBe(false);
  });
});

describe("validateProfile", () => {
  test("accepts a complete Lean-core profile", () => {
    expect(validateProfile(complete)).toEqual({ ok: true });
  });

  test("rejects an empty oneLineDescription (the one required field)", () => {
    const r = validateProfile({ ...complete, oneLineDescription: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("oneLineDescription is required");
  });

  test("SPARSE-START: an idea-stage profile (only description + persona) is valid", () => {
    // Someone arriving with a vague idea has no name/stage/offering/customer yet — those fields
    // are legitimately empty and enriched later. Only a one-line description + a persona are needed
    // to get through the front-door gate (ONBD-02 covers "business/idea").
    const idea: BusinessProfile = {
      name: "",
      oneLineDescription: "An app that helps freelancers auto-draft client invoices.",
      persona: "startup",
      stage: "",
      offering: "",
      targetCustomer: "",
      primaryGoals: [],
      knownConstraints: [],
    };
    expect(validateProfile(idea)).toEqual({ ok: true });
  });

  test("rejects an invalid persona (enterprise)", () => {
    const r = validateProfile({ ...complete, persona: "enterprise" as Persona });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("persona"))).toBe(true);
  });

  test("empty primaryGoals/knownConstraints arrays are valid (optional lists)", () => {
    expect(validateProfile({ ...complete, primaryGoals: [], knownConstraints: [] })).toEqual({
      ok: true,
    });
  });
});

describe("serializeProfile (deterministic vault-doc markdown)", () => {
  test("a fixed profile maps to a fixed string", () => {
    expect(serializeProfile(complete)).toBe(
      [
        "# Acme Roasters",
        "",
        "Small-batch specialty coffee roaster and subscription service.",
        "",
        "- **Persona:** solopreneur",
        "- **Stage:** early-revenue",
        "- **Offering:** Single-origin coffee beans by monthly subscription.",
        "- **Target customer:** Home coffee enthusiasts in North America.",
        "",
        "## Primary goals",
        "",
        "- Grow subscriber base to 500",
        "- Launch a wholesale line",
        "",
        "## Known constraints",
        "",
        "- One-person operation",
        "- Limited roasting capacity",
        "",
      ].join("\n"),
    );
  });

  test("is deterministic — same input, same output", () => {
    expect(serializeProfile(complete)).toBe(serializeProfile(complete));
  });

  test("SPARSE-START: an empty name falls back to a heading (no bare '# ')", () => {
    const md = serializeProfile({ ...complete, name: "" });
    expect(md.startsWith("# Business profile\n")).toBe(true);
  });

  test("renders empty lists as an explicit placeholder (no fabricated content)", () => {
    const md = serializeProfile({ ...complete, primaryGoals: [], knownConstraints: [] });
    expect(md).toContain("## Primary goals\n\n_None specified_");
    expect(md).toContain("## Known constraints\n\n_None specified_");
  });
});

describe("deserializeProfile (inverse of serializeProfile — pre-fills the edit form)", () => {
  test("round-trips a complete profile byte-for-byte", () => {
    expect(deserializeProfile(serializeProfile(complete))).toEqual(complete);
  });

  test("SPARSE-START: round-trips an idea-stage profile (empty name + empty lists)", () => {
    const idea: BusinessProfile = {
      name: "",
      oneLineDescription: "An app that helps freelancers auto-draft client invoices.",
      persona: "startup",
      stage: "",
      offering: "",
      targetCustomer: "",
      primaryGoals: [],
      knownConstraints: [],
    };
    expect(deserializeProfile(serializeProfile(idea))).toEqual(idea);
  });

  test("an unparseable persona falls back to solopreneur (never throws on stored text)", () => {
    const md = serializeProfile(complete).replace("**Persona:** solopreneur", "**Persona:** ");
    expect(deserializeProfile(md).persona).toBe("solopreneur");
  });
});
