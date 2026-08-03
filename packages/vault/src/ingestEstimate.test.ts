// The pure half of the 15.3-03 budget wall. No convex-test, no fixtures — the clamp and the
// conservatism direction are exactly the two things that can break here, and both are arithmetic.
import { DEFAULT_MODEL, estimateTokens, priceUsage } from "@pikar/cost";
import { describe, expect, test } from "vitest";
import { GRAPH_EXTRACT_CHAR_CAP } from "./constants";
import { VAULT_EXTRACT_PAGE_CAP } from "./extractKind";
import { clampRefundCents, EMBED_USD_PER_MTOK, estimateFolderCents } from "./ingestEstimate";

// ── The money bug ────────────────────────────────────────────────────────────────────
//
// Tested HERE and not through convex-test on purpose: reproducing a 24h fixed-window ROLL inside
// convex-test means reaching into the rate-limiter component's private `rateLimits` rows and
// hand-editing a `ts`, which tests the harness rather than the guard. The clamp is the thing that
// can actually break, it is one expression, and it is pure.
describe("clampRefundCents — the cross-midnight guard", () => {
  const CAP = 2_500;

  // THE POINT. `calculateRateLimit` is `min(state.value + rate*elapsedWindows, capacity) - count`,
  // so the capacity clamp runs BEFORE the count subtraction: after a window roll the value is
  // already back at capacity, and an unclamped -400 refund yields 2900 against a capacity of 2500.
  // Mutation check: weaken this to `min(unspent, capacity)` and this line goes RED.
  test("refunds NOTHING into a window already at capacity", () => {
    expect(clampRefundCents(400, CAP, CAP)).toBe(0);
  });

  test("refunds the whole unspent remainder when the window has room for it", () => {
    expect(clampRefundCents(400, 1_600, CAP)).toBe(400);
  });

  test("refunds only the headroom when the remainder exceeds it", () => {
    expect(clampRefundCents(400, 2_400, CAP)).toBe(100);
  });

  // `recordSpend` consumes with `reserve: true`, so a window CAN sit negative. Headroom is then
  // larger than the capacity, and the unspent remainder is what binds — never the other way.
  test("a negative window refunds at most the unspent remainder, not the whole overdraft", () => {
    expect(clampRefundCents(400, -900, CAP)).toBe(400);
  });

  test("never returns a negative refund (a negative refund would CHARGE the tenant again)", () => {
    expect(clampRefundCents(0, CAP, CAP)).toBe(0);
    expect(clampRefundCents(400, CAP + 1_000, CAP)).toBe(0);
  });
});

// ── The estimator ────────────────────────────────────────────────────────────────────
//
// Asserted BY DIRECTION, never against a pinned number. A test that pins the estimate to a literal
// fights every price-table change and would have to be edited by the person least able to judge
// whether the new number is still conservative — which is how an under-reservation ships.
describe("estimateFolderCents — conservatism, by direction", () => {
  /** The real per-document floor, derived from `@pikar/cost` the same way the estimator derives
   *  it: ONE `recordSpend` carrying embed (free today) + one capped graph-extract call. */
  const perDocUsd = (): number => {
    const priced = priceUsage(DEFAULT_MODEL, {
      inputTokens: estimateTokens("x".repeat(GRAPH_EXTRACT_CHAR_CAP)),
      outputTokens: 1_024,
    });
    if (!priced.ok) throw new Error("test: DEFAULT_MODEL is absent from PRICING");
    return priced.value + EMBED_USD_PER_MTOK;
  };

  test("a text/office folder estimates at or above its summed real per-doc ceilings", () => {
    const files = [
      { size: 4_000, mimeType: "text/plain" },
      { size: 90_000, mimeType: "text/csv" },
      {
        size: 250_000,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
      { size: 900_000, mimeType: "application/pdf", pages: 12, hasTextLayer: true },
    ];
    const { estCents } = estimateFolderCents(files);
    const realCeilingCents = files.length * perDocUsd() * 100;
    expect(estCents).toBeGreaterThanOrEqual(realCeilingCents);
  });

  // B14, the reason a folder-scale estimate computed from model pricing under-reserves by ~2x:
  // `recordSpend` charges `Math.ceil(costUsd * 100)`, so a ~$0.005 document draws a FULL cent.
  // Mutation check, RUN: `centsFor`'s `Math.ceil` -> `Math.floor` (i.e. stop modelling the
  // per-call ceiling) turns 5 of these 13 tests RED, this one included — a 300-document folder
  // then estimates at 0 cents instead of 300.
  test("300 sub-cent documents estimate at 300 cents or more (the per-call ceil is modelled)", () => {
    const files = Array.from({ length: 300 }, () => ({ size: 2_000, mimeType: "text/plain" }));
    expect(perDocUsd() * 100).toBeLessThan(1); // not vacuous: each doc really IS sub-cent
    expect(estimateFolderCents(files).estCents).toBeGreaterThanOrEqual(300);
  });

  // A4: bytes + mime cannot see the variable that costs the money. A text-layer PDF is free to
  // extract; a scanned one is ~$0.25. Guessing LOW is the one guess that breaks the invariant.
  test("an unprobed PDF is priced as a scan at the page cap, not as a text layer", () => {
    const unprobed = estimateFolderCents([{ size: 3_000_000, mimeType: "application/pdf" }]);
    const textLayer = estimateFolderCents([
      { size: 3_000_000, mimeType: "application/pdf", pages: 40, hasTextLayer: true },
    ]);
    expect(unprobed.perFile[0]?.reason).toBe("ocr_pdf_assumed_page_cap");
    expect(unprobed.estCents).toBeGreaterThanOrEqual(VAULT_EXTRACT_PAGE_CAP);
    expect(unprobed.estCents).toBeGreaterThan(textLayer.estCents * 10);
  });

  test("a probed scan is priced per page, and a 50-page scan is not cheaper than a 10-page one", () => {
    const ten = estimateFolderCents([
      { size: 3_000_000, mimeType: "application/pdf", pages: 10, hasTextLayer: false },
    ]);
    const fifty = estimateFolderCents([
      { size: 3_000_000, mimeType: "application/pdf", pages: 50, hasTextLayer: false },
    ]);
    expect(ten.perFile[0]?.reason).toBe("ocr_pdf_scanned");
    expect(fifty.estCents).toBeGreaterThan(ten.estCents);
    // The page cap bounds the fan-out, so pages beyond it cost nothing and must not be reserved.
    const capped = estimateFolderCents([
      { size: 3_000_000, mimeType: "application/pdf", pages: 500, hasTextLayer: false },
    ]);
    expect(capped.estCents).toBe(fifty.estCents);
  });

  test("files the upload gate refuses are skipped at zero cents and named", () => {
    const { estCents, perFile, skipped } = estimateFolderCents([
      { size: 400 * 1000 * 1000, mimeType: "application/pdf" }, // over the 200 MB doc cap
      { size: 60 * 1000 * 1000, mimeType: "video/mp4" }, // over the 25 MB video cap
      { size: 0, mimeType: "text/plain" },
    ]);
    expect(estCents).toBe(0);
    expect(perFile.map((f) => f.reason)).toEqual(["over_file_cap", "over_video_cap", "empty_file"]);
    expect(skipped).toHaveLength(3);
  });

  test("an unprobed video is priced above a probed short one (over-estimation is the safe side)", () => {
    const unprobed = estimateFolderCents([{ size: 20 * 1000 * 1000, mimeType: "video/mp4" }]);
    const probed = estimateFolderCents([
      { size: 20 * 1000 * 1000, mimeType: "video/mp4", durationSec: 90 },
    ]);
    expect(unprobed.perFile[0]?.reason).toBe("transcribe_assumed_duration");
    expect(unprobed.estCents).toBeGreaterThan(probed.estCents);
  });

  test("perFile is index-aligned with the input, so a caller can name the expensive file", () => {
    const files = [
      { size: 1_000, mimeType: "text/plain" },
      { size: 3_000_000, mimeType: "application/pdf" },
    ];
    const { perFile, estCents } = estimateFolderCents(files);
    expect(perFile).toHaveLength(2);
    expect(perFile[1]!.cents).toBeGreaterThan(perFile[0]!.cents);
    expect(perFile.reduce((s, f) => s + f.cents, 0)).toBe(estCents);
  });

  test("an empty folder estimates at zero (and must not throw)", () => {
    expect(estimateFolderCents([])).toEqual({ estCents: 0, perFile: [], skipped: [] });
  });
});
