import { unwrap } from "@pikar/core/result";
import { scanText } from "@pikar/pii";
import { describe, expect, it } from "vitest";
import {
  CHEAP_MODEL,
  DEFAULT_MODEL,
  REALTIME_PRICING,
  RESEARCH_FALLBACK_MODEL,
  RESEARCH_MODEL,
  TRANSCRIPTION_PRICING,
  WEB_SEARCH_CALL_USD,
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


// ── Phase 16 (16-02, ACTN-03/D8) — the research model pins ───────────────────────────────────
//
// Why these assertions and not a looser one: the failure mode of an unpriced research model is
// SILENT. priceUsage returns Err({unknown_model}) -> recordModelSpend returns 0 -> a research run
// draws down NOTHING against the daily rail or the Phase-15 shared envelope. A specialist that
// appears free is worse than one that errors.
//
// Pitfall 3, stated so nobody "simplifies" these back: a cost assertion written as
// `expect(spend).toBeGreaterThan(0)` can pass on the OTHER model's spend while research bills
// nothing. That is why these assert on priceUsage(RESEARCH_MODEL, ...) BY NAME.
//
// Both pins were probed for real on 2026-07-27 — see docs/playbooks/agent-runtime.md.
describe("research model pins (16-02)", () => {
  it("RESEARCH_MODEL is priced — an unpriced pin would bill nothing, silently", () => {
    const r = priceUsage(RESEARCH_MODEL, { inputTokens: 1, outputTokens: 1 });
    expect(r.ok, `${RESEARCH_MODEL} has no PRICING row`).toBe(true);
  });

  // The fallback needs a price for the same reason, AND it was probed to accept the hosted search
  // tool: isFallbackEligible returns false for a non-retryable 4xx, so an unsupported-tool 400
  // propagates loudly — the good failure mode ONLY if the fallback is not itself the unsupported one.
  it("RESEARCH_FALLBACK_MODEL is priced", () => {
    const r = priceUsage(RESEARCH_FALLBACK_MODEL, { inputTokens: 1, outputTokens: 1 });
    expect(r.ok, `${RESEARCH_FALLBACK_MODEL} has no PRICING row`).toBe(true);
  });

  // The per-call hosted-search fee is charged on TOP of tokens; omitting it under-reports every
  // research run's true cost against the envelope.
  it("WEB_SEARCH_CALL_USD is a positive finite number", () => {
    expect(WEB_SEARCH_CALL_USD).toBeGreaterThan(0);
    expect(Number.isFinite(WEB_SEARCH_CALL_USD)).toBe(true);
  });

  // The fail-closed property must SURVIVE the new rows — adding entries to PRICING must not turn
  // the unknown-model branch into a lookup that accidentally resolves.
  it("an unknown model still fails closed", () => {
    const r = priceUsage("openai/not-a-real-model", { inputTokens: 1, outputTokens: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unknown_model");
  });

  // The research pin must never silently become the repo-wide CHEAP_MODEL: gpt-4.1-nano appears in
  // NEITHER OpenAI page and was deliberately never probed, so it is not known to accept the tool.
  it("the fallback is NOT the unprobed repo CHEAP_MODEL", () => {
    expect(RESEARCH_FALLBACK_MODEL).not.toBe("openai/gpt-4.1-nano");
  });
});
