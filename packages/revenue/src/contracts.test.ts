import { describe, expect, it } from "vitest";
import {
  CAPS,
  DECISION_SUPPORT_NOTICE,
  isProvider,
  isSourceAuthority,
  PROVIDERS,
  type Projection,
  type ProjectionMeta,
  REF_CHAR_CAP,
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
