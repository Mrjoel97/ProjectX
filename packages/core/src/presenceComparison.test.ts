import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  comparisonLedgerAdmission,
  comparisonModelMatches,
  PRESENCE_COMPARISON_ARMS,
  PRESENCE_COMPARISON_CAP_CENTS,
  PRESENCE_COMPARISON_FIXTURE,
  PRESENCE_COMPARISON_MODELS,
  PRESENCE_COMPARISON_TOTAL_USD,
} from "./presenceComparison";
import { sha256Bytes } from "./webRuntime";

type LedgerRow = Parameters<typeof comparisonLedgerAdmission>[0][number];
const row = (values: Partial<LedgerRow> = {}): LedgerRow => ({
  tenantId: "prior-fixture",
  rail: "chat",
  correlationId: "prior-call",
  phase: "actual",
  amountCents: 1,
  ...values,
});
const admit = (rows: readonly LedgerRow[]) =>
  comparisonLedgerAdmission(rows, PRESENCE_COMPARISON_CAP_CENTS);

describe("original comparison authorization", () => {
  it("keeps a new $4.50 envelope inside the original $5 limit, including other tenants and rails", () => {
    expect(PRESENCE_COMPARISON_TOTAL_USD).toBe(5);
    expect(admit([])).toEqual({ upperBoundUsd: 0, remainingUsd: 5, capCents: 450 });
    const prior = [
      row({ tenantId: "previous-a", rail: "chat", amountCents: 25 }),
      row({ tenantId: "previous-b", rail: "embedding", amountCents: 25 }),
    ];
    expect(admit(prior)).toEqual({ upperBoundUsd: 0.5, remainingUsd: 4.5, capCents: 450 });
    expect(() =>
      admit([
        ...prior,
        row({ correlationId: "one-nano-too-far", amountCents: 1, evalActualUsd: 1e-9 }),
      ]),
    ).toThrow("PRESENCE_COMPARISON_ORIGINAL_TOTAL_EXHAUSTED");
  });

  it("uses precise provider cost when recorded and conservatively falls back to charged cents", () => {
    const result = admit([
      row({ correlationId: "precise", amountCents: 1, evalActualUsd: 0.000001 }),
      row({ correlationId: "legacy", amountCents: 2 }),
    ]);
    expect(result.upperBoundUsd).toBeCloseTo(0.020001, 12);
    expect(result.remainingUsd).toBeCloseTo(4.979999, 12);
    expect(() => admit([row({ amountCents: 51 })])).toThrow(
      "PRESENCE_COMPARISON_ORIGINAL_TOTAL_EXHAUSTED",
    );
  });

  it("refuses every unresolved reservation, including a zero-cent unknown outcome", () => {
    for (const amountCents of [0, 1, 450]) {
      expect(() => admit([row({ phase: "reserved", amountCents })])).toThrow(
        "PRESENCE_COMPARISON_PRIOR_HOLD",
      );
    }
    const reserved = row({ phase: "reserved", amountCents: 100 });
    for (const mismatched of [
      row({ tenantId: "another-tenant" }),
      row({ rail: "embedding" }),
      row({ correlationId: "another-call" }),
    ]) {
      expect(() => admit([reserved, mismatched])).toThrow("PRESENCE_COMPARISON_PRIOR_HOLD");
    }
    expect(admit([reserved, row({ amountCents: 1, evalActualUsd: 0.004 })]).upperBoundUsd).toBe(
      0.004,
    );
  });

  it("accepts only an explicit zero-cost refund as closure and never treats an unexplained refund as free", () => {
    const reserved = row({ phase: "reserved", amountCents: 100 });
    expect(
      admit([reserved, row({ phase: "refunded", amountCents: 0, evalActualUsd: 0 })]).upperBoundUsd,
    ).toBe(0);
    for (const refund of [
      row({ phase: "refunded", amountCents: 0 }),
      row({ phase: "refunded", evalActualUsd: 0.01 }),
    ]) {
      expect(() => admit([reserved, refund])).toThrow("PRESENCE_COMPARISON_PRIOR_HOLD");
    }
  });

  it("requires the exact prior envelope to be closed even when its calls already settled", () => {
    const envelope = row({
      _id: "prior-envelope",
      kind: "eval_envelope",
      phase: "estimated",
      correlationId: "prior-envelope-open",
      amountCents: 100,
    });
    const closed = row({
      kind: "eval_budget_closed",
      evalBudgetId: "prior-envelope",
      correlationId: "prior-envelope-close",
      amountCents: 0,
    });
    expect(() => admit([envelope, row()])).toThrow("PRESENCE_COMPARISON_PRIOR_OPEN_BUDGET");
    expect(() =>
      admit([envelope, row(), { ...closed, evalBudgetId: "different-envelope" }]),
    ).toThrow("PRESENCE_COMPARISON_PRIOR_OPEN_BUDGET");
    expect(admit([envelope, row(), closed]).upperBoundUsd).toBe(0.01);
  });

  it("refuses duplicate settlements instead of double-certifying closure", () => {
    expect(() => admit([row(), row()])).toThrow("PRESENCE_COMPARISON_DUPLICATE_SETTLEMENT");
    expect(() =>
      admit([row(), row({ phase: "refunded", amountCents: 0, evalActualUsd: 0 })]),
    ).toThrow("PRESENCE_COMPARISON_DUPLICATE_SETTLEMENT");
    expect(admit([row(), row({ rail: "embedding" })]).upperBoundUsd).toBe(0.02);
  });

  it("refuses a prior breach, malformed costs, excess rows and an altered envelope cap", () => {
    expect(() => admit([row({ evalBreach: true })])).toThrow("PRESENCE_COMPARISON_PRIOR_BREACH");
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => admit([row({ amountCents: value })])).toThrow(
        "PRESENCE_COMPARISON_LEDGER_INVALID",
      );
      expect(() => admit([row({ evalActualUsd: value })])).toThrow(
        "PRESENCE_COMPARISON_LEDGER_INVALID",
      );
    }
    expect(() => admit(Array.from({ length: 5001 }, () => row()))).toThrow(
      "PRESENCE_COMPARISON_LEDGER_INVALID",
    );
    for (const cap of [0, 449, 451, 500, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => comparisonLedgerAdmission([], cap)).toThrow(
        "PRESENCE_COMPARISON_LEDGER_INVALID",
      );
    }
  });
});

describe("comparable proposal inputs and model identity", () => {
  it("keeps the same Kimi model on both experimental arms and accepts only closed exact response aliases", () => {
    expect(PRESENCE_COMPARISON_ARMS).toEqual(["current", "kimi", "kimi-stitch"]);
    expect(PRESENCE_COMPARISON_MODELS.kimi).toBe(PRESENCE_COMPARISON_MODELS["kimi-stitch"]);
    const accepted = [
      [
        PRESENCE_COMPARISON_MODELS.current,
        [
          "openai/gpt-4o-mini",
          "openai/gpt-4o-mini-2024-07-18",
          "gpt-4o-mini",
          "gpt-4o-mini-2024-07-18",
        ],
      ],
      [
        PRESENCE_COMPARISON_MODELS.kimi,
        ["moonshotai/kimi-k3.1-pro", "moonshotai/kimi-k3.1-pro-20261023", "kimi-k3.1-pro"],
      ],
    ] as const;
    for (const [requested, aliases] of accepted) {
      for (const observed of aliases)
        expect(comparisonModelMatches(requested, observed)).toBe(true);
      for (const observed of [
        undefined,
        "",
        "openai/gpt-4o",
        "moonshotai/kimi-k2.5",
        "moonshotai/kimi-k3.1-pro-unknown",
        `${aliases[0]}-fallback`,
        ` ${aliases[0]}`,
      ]) {
        expect(comparisonModelMatches(requested, observed)).toBe(false);
      }
    }
    expect(
      comparisonModelMatches(PRESENCE_COMPARISON_MODELS.current, "moonshotai/kimi-k3.1-pro"),
    ).toBe(false);
    expect(comparisonModelMatches(PRESENCE_COMPARISON_MODELS.kimi, "openai/gpt-4o-mini")).toBe(
      false,
    );
    expect(comparisonModelMatches("or/unapproved/model", "unapproved/model")).toBe(false);
  });

  it("supplies a real frozen illustrative image and requests a quarantined responsive overlay proposal with reduced motion", () => {
    const fixture = PRESENCE_COMPARISON_FIXTURE;
    expect(Object.isFrozen(fixture)).toBe(true);
    expect(fixture.sourceRef).toMatch(/^fixture:presence:/);
    expect(fixture.business.pages).toEqual(["home", "about", "services", "contact"]);
    expect(fixture.request).toMatch(/single HTML document with inline CSS/);
    expect(fixture.request).toMatch(/hero image overlay/);
    expect(fixture.request).toContain("prefers-reduced-motion");
    expect(fixture.request).toContain("No JavaScript");
    expect(fixture.request).toContain("quarantined visual material");
    expect(fixture.request).toContain("Use its publicUrl");
    expect(fixture.assets).toHaveLength(1);
    const image = fixture.assets[0];
    if (!image) throw new Error("Comparison fixture image is required");
    expect(image.mimeType).toBe("image/webp");
    expect(image.source).toBe("original-generated-fictional-example");
    const publicUrl = new URL(image.publicUrl);
    expect(publicUrl.protocol).toBe("https:");
    expect(publicUrl.origin).toBe("https://pikar-presence-stg.vercel.app");
    expect(publicUrl.pathname).toBe(image.path);
    const bytes = readFileSync(new URL(`../../../apps/web/public${image.path}`, import.meta.url));
    expect(bytes.byteLength).toBe(image.byteLength);
    expect(sha256Bytes(bytes)).toBe(image.sha256);
    expect(fixture.business.assets).toMatch(/Do not invent/);
  });
});
