import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAPS,
  DECISION_SUPPORT_NOTICE,
  ELIGIBILITY_REASONS,
  type EligibilityInput,
  isProvider,
  isSourceAuthority,
  PROVIDER_OPEN_CONDITIONS,
  PROVIDERS,
  type Projection,
  type ProjectionMeta,
  type ProviderGateRecord,
  REF_CHAR_CAP,
  resolveProviderEligibility,
  SOURCE_AUTHORITIES,
  type SourceRef,
  validateProjection,
  validateSourceRef,
} from "./contracts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 27);

const ref = (over: Partial<SourceRef> = {}): SourceRef => ({
  provider: "quickbooks",
  kind: "invoice",
  id: "inv_101",
  ...over,
});

const meta = (over: Partial<ProjectionMeta> = {}): ProjectionMeta => ({
  provider: "quickbooks",
  authority: "accounting_authority",
  retrievedAt: NOW,
  window: { startMs: NOW - 90 * DAY, endMs: NOW },
  capped: false,
  sources: [ref()],
  ...over,
});

describe("closed vocabularies", () => {
  it("admits exactly the four providers", () => {
    expect([...PROVIDERS]).toEqual(["hubspot", "quickbooks", "stripe", "paypal"]);
    for (const p of PROVIDERS) expect(isProvider(p)).toBe(true);
  });

  it("refuses an unknown provider string", () => {
    for (const bad of ["xero", "QuickBooks", "", "stripe ", null, undefined, 7, {}]) {
      expect(isProvider(bad)).toBe(false);
    }
  });

  it("admits exactly the four source authorities", () => {
    expect([...SOURCE_AUTHORITIES]).toEqual([
      "accounting_authority",
      "payment_rail",
      "user_confirmed_obligation",
      "supplemental",
    ]);
    for (const a of SOURCE_AUTHORITIES) expect(isSourceAuthority(a)).toBe(true);
    expect(isSourceAuthority("authority")).toBe(false);
    expect(isSourceAuthority("accounting")).toBe(false);
  });
});

describe("validateSourceRef — refs, ids and labels ONLY (CLAUDE.md §4)", () => {
  it("accepts a plain ref", () => {
    expect(validateSourceRef(ref()).ok).toBe(true);
  });

  it("refuses an unknown provider", () => {
    expect(validateSourceRef({ ...ref(), provider: "xero" as never }).ok).toBe(false);
  });

  it("refuses empty kind or id", () => {
    expect(validateSourceRef(ref({ kind: "" })).ok).toBe(false);
    expect(validateSourceRef(ref({ id: "   " })).ok).toBe(false);
  });

  it("refuses quoted or newline content masquerading as a ref", () => {
    for (const bad of ['inv "Acme Corp"', "inv 'x'", "inv ’s balance", "inv\nline2"]) {
      expect(validateSourceRef(ref({ id: bad })).ok).toBe(false);
    }
  });

  it("refuses an id one character past the cap and accepts one at the cap", () => {
    expect(validateSourceRef(ref({ id: "a".repeat(REF_CHAR_CAP) })).ok).toBe(true);
    expect(validateSourceRef(ref({ id: "a".repeat(REF_CHAR_CAP + 1) })).ok).toBe(false);
  });
});

describe("validateProjection — every provider terminates in one bounded vocabulary", () => {
  it("accepts a ready projection", () => {
    const p: Projection<number> = { state: "ready", meta: meta(), items: [1, 2] };
    expect(validateProjection(p).ok).toBe(true);
  });

  it("refuses a ready projection that admits it was capped", () => {
    // A capped `ready` is a lie: the item list is a PREFIX of reality, so it is `partial`.
    const p: Projection<number> = { state: "ready", meta: meta({ capped: true }), items: [1] };
    expect(validateProjection(p).ok).toBe(false);
  });

  it("accepts a capped partial projection that names what is missing", () => {
    const p: Projection<number> = {
      state: "partial",
      meta: meta({ capped: true }),
      items: [1],
      missing: "invoices beyond page cap",
    };
    expect(validateProjection(p).ok).toBe(true);
  });

  it("refuses a partial projection with a blank `missing`", () => {
    const p: Projection<number> = {
      state: "partial",
      meta: meta(),
      items: [1],
      missing: "  ",
    };
    expect(validateProjection(p).ok).toBe(false);
  });

  it("refuses an unavailable projection with a blank reason", () => {
    expect(validateProjection({ state: "unavailable", provider: "stripe", because: "" }).ok).toBe(
      false,
    );
    expect(
      validateProjection({ state: "unavailable", provider: "stripe", because: "token revoked" }).ok,
    ).toBe(true);
  });

  it("refuses a retrieval time that is not a finite instant", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const p: Projection<number> = { state: "ready", meta: meta({ retrievedAt: bad }), items: [] };
      expect(validateProjection(p).ok).toBe(false);
    }
  });

  it("refuses an inverted window and accepts a zero-width one", () => {
    const inverted: Projection<number> = {
      state: "ready",
      meta: meta({ window: { startMs: NOW, endMs: NOW - 1 } }),
      items: [],
    };
    expect(validateProjection(inverted).ok).toBe(false);
    const instant: Projection<number> = {
      state: "ready",
      meta: meta({ window: { startMs: NOW, endMs: NOW } }),
      items: [],
    };
    expect(validateProjection(instant).ok).toBe(true);
  });

  it("refuses a window one day past the cap and accepts one exactly at it", () => {
    const at: Projection<number> = {
      state: "ready",
      meta: meta({ window: { startMs: NOW - CAPS.maxWindowDays * DAY, endMs: NOW } }),
      items: [],
    };
    expect(validateProjection(at).ok).toBe(true);
    const over: Projection<number> = {
      state: "ready",
      meta: meta({ window: { startMs: NOW - (CAPS.maxWindowDays * DAY + 1), endMs: NOW } }),
      items: [],
    };
    expect(validateProjection(over).ok).toBe(false);
  });

  it("refuses more items than the cap allows, at the boundary", () => {
    const at: Projection<number> = {
      state: "ready",
      meta: meta(),
      items: new Array(CAPS.maxItems).fill(0),
    };
    expect(validateProjection(at).ok).toBe(true);
    const over: Projection<number> = {
      state: "ready",
      meta: meta(),
      items: new Array(CAPS.maxItems + 1).fill(0),
    };
    expect(validateProjection(over).ok).toBe(false);
  });

  it("refuses more source refs than the cap allows", () => {
    const over: Projection<number> = {
      state: "ready",
      meta: meta({ sources: new Array(CAPS.maxSources + 1).fill(ref()) }),
      items: [],
    };
    expect(validateProjection(over).ok).toBe(false);
  });

  it("refuses a projection whose source refs are themselves invalid", () => {
    const p: Projection<number> = {
      state: "ready",
      meta: meta({ sources: [ref({ id: 'customer "Acme"' })] }),
      items: [],
    };
    expect(validateProjection(p).ok).toBe(false);
  });

  it("carries a non-advice notice on every finance result", () => {
    expect(DECISION_SUPPORT_NOTICE).toMatch(/not financial, tax or accounting advice/);
  });
});

// ── Lane eligibility ──────────────────────────────────────────────────────────────────────

const gate = (over: Partial<ProviderGateRecord> = {}): ProviderGateRecord => ({
  provider: "hubspot",
  environment: "production",
  admission: "approved_production",
  lane: "passed",
  reviewBy: NOW + 30 * DAY,
  clearedConditions: [],
  ...over,
});

const input = (over: Partial<EligibilityInput> = {}): EligibilityInput => ({
  now: NOW,
  readPathCount: 2,
  openConditions: [],
  ...over,
});

describe("resolveProviderEligibility — admission and the live gate are separate axes", () => {
  it("is pending when no gate record exists at all", () => {
    const e = resolveProviderEligibility(null, input());
    expect(e.state).toBe("pending");
    expect(e.reasons).toEqual(["no_gate_record"]);
  });

  it("passes only when every axis agrees", () => {
    expect(resolveProviderEligibility(gate(), input()).state).toBe("passed");
    expect(resolveProviderEligibility(gate(), input()).reasons).toEqual([]);
  });

  // THE POINT OF THE WHOLE MODULE: an owner approval is not a passed lane.
  it("does not pass an approved_production provider whose lane never ran", () => {
    const e = resolveProviderEligibility(gate({ lane: "parked" }), input());
    expect(e.state).toBe("parked");
    expect(e.reasons).toContain("lane_not_passed");
  });

  it("does not pass a lane that ran green under an admission that does not permit it", () => {
    const e = resolveProviderEligibility(gate({ admission: "blocked" }), input());
    expect(e.state).toBe("parked");
    expect(e.reasons).toContain("admission_does_not_permit");
  });

  it("lets approved_beta reach sandbox but never production", () => {
    const beta = gate({ admission: "approved_beta" });
    expect(resolveProviderEligibility({ ...beta, environment: "sandbox" }, input()).state).toBe(
      "passed",
    );
    expect(resolveProviderEligibility(beta, input()).reasons).toContain(
      "admission_does_not_permit",
    );
  });

  it("lets approved_production reach both environments", () => {
    for (const environment of ["sandbox", "production"] as const) {
      expect(resolveProviderEligibility(gate({ environment }), input()).state).toBe("passed");
    }
  });

  it("never lets blocked, deferred or undecided reach any environment", () => {
    for (const admission of ["blocked", "deferred", "undecided"] as const) {
      for (const environment of ["sandbox", "production"] as const) {
        const e = resolveProviderEligibility(gate({ admission, environment }), input());
        expect(e.state).toBe("parked");
        expect(e.reasons).toContain("admission_does_not_permit");
      }
    }
  });

  it("treats an expired review date as parked-by-expiry, not passed", () => {
    // Boundary asserted against a LITERAL offset: `reviewBy === now` is already expired.
    expect(resolveProviderEligibility(gate({ reviewBy: NOW }), input()).state).toBe("expired");
    expect(resolveProviderEligibility(gate({ reviewBy: NOW - 1 }), input()).state).toBe("expired");
    expect(resolveProviderEligibility(gate({ reviewBy: NOW + 1 }), input()).state).toBe("passed");
  });

  it("reports a failed live gate as failed, and a failure outranks expiry", () => {
    const e = resolveProviderEligibility(gate({ lane: "failed" }), input());
    expect(e.state).toBe("failed");
    expect(e.reasons).toEqual(["live_gate_failed"]);
    // A lane that broke did not merely go stale: the operator must see the failure.
    expect(
      resolveProviderEligibility(gate({ lane: "failed", reviewBy: NOW - 1 }), input()).state,
    ).toBe("failed");
  });

  // Stripe's allow-list is `[]` BY DECISION (28-04). Eligibility must not contradict it.
  it("cannot pass a provider that is allowed to read nothing", () => {
    const e = resolveProviderEligibility(gate({ provider: "stripe" }), input({ readPathCount: 0 }));
    expect(e.state).toBe("parked");
    expect(e.reasons).toContain("no_read_paths");
  });

  it("cannot pass while an open admission condition is unresolved", () => {
    const e = resolveProviderEligibility(gate(), input({ openConditions: ["revoke-cascade"] }));
    expect(e.state).toBe("parked");
    expect(e.reasons).toContain("open_condition_unresolved");
    expect(e.unresolvedConditions).toEqual(["revoke-cascade"]);
  });

  it("passes once every open condition is explicitly cleared on the record", () => {
    const e = resolveProviderEligibility(
      gate({ clearedConditions: ["revoke-cascade"] }),
      input({ openConditions: ["revoke-cascade"] }),
    );
    expect(e.state).toBe("passed");
    expect(e.unresolvedConditions).toEqual([]);
  });

  it("clearing one of two conditions is not clearing both", () => {
    const e = resolveProviderEligibility(
      gate({ clearedConditions: ["a"] }),
      input({ openConditions: ["a", "b"] }),
    );
    expect(e.state).toBe("parked");
    expect(e.unresolvedConditions).toEqual(["b"]);
  });

  it("accumulates every blocking reason rather than reporting the first", () => {
    const e = resolveProviderEligibility(
      gate({ admission: "deferred", lane: "parked" }),
      input({ readPathCount: 0, openConditions: ["x"] }),
    );
    expect(new Set(e.reasons)).toEqual(
      new Set([
        "lane_not_passed",
        "admission_does_not_permit",
        "no_read_paths",
        "open_condition_unresolved",
      ]),
    );
  });

  it("reports only reasons from the closed set", () => {
    expect([...ELIGIBILITY_REASONS].sort()).toEqual(
      [
        "admission_does_not_permit",
        "evidence_expired",
        "lane_not_passed",
        "live_gate_failed",
        "no_gate_record",
        "no_read_paths",
        "open_condition_unresolved",
      ].sort(),
    );
  });
});

describe("PROVIDER_OPEN_CONDITIONS — parity with the register of record", () => {
  const readme = readFileSync(
    new URL("../../../docs/connectors/README.md", import.meta.url),
    "utf8",
  );

  it("names an open condition for exactly the providers the register says still carry one", () => {
    // The register's "Open conditions that survived every approval" table is the source of truth.
    const section = readme.split("### Open conditions that survived every approval")[1] ?? "";
    const table = section.split("\n##")[0] ?? "";
    // Anti-vacuity: an empty slice would make every `.test()` below false and the two sets would
    // agree at zero. The table must actually be here before it can be compared.
    expect(table).toContain("| Provider | Condition still open |");
    const inDocs = new Set(
      PROVIDERS.filter((p) =>
        new RegExp(`^|s*${p === "quickbooks" ? "QuickBooks" : p}\b`, "im").test(table),
      ),
    );
    const inCode = new Set(PROVIDERS.filter((p) => PROVIDER_OPEN_CONDITIONS[p].length > 0));
    expect([...inCode].sort()).toEqual([...inDocs].sort());
  });

  it("still carries an unresolved condition for all four providers today", () => {
    // A LITERAL, not a derived count: on 2026-08-27 not one of the four approvals resolved its
    // record's open condition. When a lane resolves one, this number moves deliberately.
    expect(PROVIDERS.filter((p) => PROVIDER_OPEN_CONDITIONS[p].length > 0)).toHaveLength(4);
  });

  it("pins every condition id and its owning plan to a LITERAL", () => {
    // A constant the test imports cannot be pinned by mutating that constant — the assertion moves
    // with it. These four pairs are what 28-22..25 will each type into a seal, and what the
    // register names, so they are written out rather than derived.
    expect(
      Object.fromEntries(
        PROVIDERS.map((p) => [p, PROVIDER_OPEN_CONDITIONS[p].map((c) => [c.id, c.resolvedBy])]),
      ),
    ).toEqual({
      hubspot: [["revoke-cascades-to-access-tokens", "28-22"]],
      quickbooks: [["partner-tier-and-poll-budget", "28-23"]],
      stripe: [["platform-initiated-revocation", "28-24"]],
      paypal: [["no-documented-revoke-endpoint", "28-25"]],
    });
  });

  it("names the downstream plan that must confront each condition", () => {
    for (const p of PROVIDERS) {
      for (const c of PROVIDER_OPEN_CONDITIONS[p]) {
        expect(c.resolvedBy).toMatch(/^28-\d\d$/);
        expect(c.id).toMatch(/^[a-z0-9-]+$/);
      }
    }
  });
});
