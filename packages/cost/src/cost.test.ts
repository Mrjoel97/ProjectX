import { unwrap } from "@pikar/core/result";
import { scanText } from "@pikar/pii";
import { describe, expect, it } from "vitest";
import {
  CHEAP_MODEL,
  DEFAULT_MODEL,
  REALTIME_PRICING,
  TRANSCRIPTION_PRICING,
  chooseModel,
  estimateCostUsd,
  estimateTokens,
  priceRealtime,
  priceTranscription,
  priceUsage,
} from "./cost";

// SafeText only comes out of scanText — no cast, keeps the brand honest.
const safe = unwrap(scanText("hello")).safeText;

describe("estimateTokens", () => {
  it("empty → 0", () => expect(estimateTokens("")).toBe(0));
  it("400 chars → 100 (chars/4, ceil)", () => expect(estimateTokens("x".repeat(400))).toBe(100));
});

describe("estimateCostUsd", () => {
  it("default 1M input tokens → $0.15", () => {
    const r = estimateCostUsd(DEFAULT_MODEL, 1_000_000, 0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeCloseTo(0.15, 10);
  });
  it("unknown model → err(unknown_model), never NaN", () => {
    const r = estimateCostUsd("openai/does-not-exist", 1, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unknown_model");
  });
});

describe("priceUsage", () => {
  it("cheap 1M in + 1M out → $0.50", () => {
    const r = priceUsage(CHEAP_MODEL, { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeCloseTo(0.5, 10);
  });
  it("missing token fields treated as 0", () => {
    const r = priceUsage(DEFAULT_MODEL, {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(0);
  });
  it("unknown model → err", () => {
    expect(priceUsage("nope", { inputTokens: 1 }).ok).toBe(false);
  });
});

describe("chooseModel", () => {
  it("generous budget → default model, integer estCents ≥ 1", () => {
    const r = chooseModel(safe, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.model).toBe(DEFAULT_MODEL);
      expect(Number.isInteger(r.value.estCents)).toBe(true);
      expect(r.value.estCents).toBeGreaterThanOrEqual(1);
    }
  });
  it("budget only fits cheap model → downgrade (GRDL-03)", () => {
    // Default output cost (~$0.000615) > 0.0005 ≥ cheap output cost (~$0.00041).
    const r = chooseModel(safe, 0.0005);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.model).toBe(CHEAP_MODEL);
  });
  it("~zero budget → err(over_budget) (fail closed)", () => {
    const r = chooseModel(safe, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("over_budget");
  });
  it("NaN / negative budget → over_budget (fail closed)", () => {
    expect(chooseModel(safe, Number.NaN).ok).toBe(false);
    expect(chooseModel(safe, -1).ok).toBe(false);
  });
});

describe("priceTranscription", () => {
  it("0 seconds → ok(0), no charge for the minimum billable", () => {
    const r = priceTranscription(0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(0);
  });
  it("30s (partial minute) → ok(1 minute rate) — bills per-minute rounded up", () => {
    const r = priceTranscription(30);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeCloseTo(TRANSCRIPTION_PRICING.perMinuteUsd, 10);
  });
  it("90s → ok(2 * rate) — ceil(90/60) = 2 minutes", () => {
    const r = priceTranscription(90);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeCloseTo(TRANSCRIPTION_PRICING.perMinuteUsd * 2, 10);
  });
  it("negative seconds → err (fail closed)", () => {
    const r = priceTranscription(-1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("over_budget");
  });
  it("NaN seconds → err, never NaN (fail closed)", () => {
    const r = priceTranscription(Number.NaN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("over_budget");
  });
  it("Infinity seconds → err (fail closed, non-finite)", () => {
    expect(priceTranscription(Number.POSITIVE_INFINITY).ok).toBe(false);
  });
});

describe("priceRealtime", () => {
  it("1M of each token type → summed per-MTok rates", () => {
    const r = priceRealtime(1_000_000, 1_000_000, 1_000_000, 1_000_000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const p = REALTIME_PRICING;
      expect(r.value).toBeCloseTo(
        p.audioInPerMTok + p.audioOutPerMTok + p.textInPerMTok + p.textOutPerMTok,
        10,
      );
    }
  });
  it("audio out is priced richer than audio in", () => {
    expect(REALTIME_PRICING.audioOutPerMTok).toBeGreaterThan(REALTIME_PRICING.audioInPerMTok);
  });
  it("all-zero usage → ok(0)", () => {
    const r = priceRealtime(0, 0, 0, 0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(0);
  });
  it("negative any-field → err (fail closed)", () => {
    expect(priceRealtime(-1, 0, 0, 0).ok).toBe(false);
    expect(priceRealtime(0, 0, 0, -5).ok).toBe(false);
  });
  it("NaN / Infinity any-field → err, never NaN (fail closed)", () => {
    expect(priceRealtime(Number.NaN, 0, 0, 0).ok).toBe(false);
    expect(priceRealtime(0, Number.POSITIVE_INFINITY, 0, 0).ok).toBe(false);
  });
});
