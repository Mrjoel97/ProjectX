import { describe, expect, test } from "vitest";
import { DRIVE_NATIVE_ASSUMED_BYTES, estimatedBytesFor } from "./driveEstimate";

const DOC = "application/vnd.google-apps.document";
const SHEET = "application/vnd.google-apps.spreadsheet";
const SLIDES = "application/vnd.google-apps.presentation";

describe("estimatedBytesFor — the reservation invariant on the Drive rail", () => {
  // THE test. Drive omits `size` for Google-native files, so this is the ordinary case, not an
  // edge case. Reading it as 0 prices a 500-Doc folder at $0, reserves nothing, and the folder
  // trips the budget wall halfway through — the half-ingested folder the phase forbids.
  test("a missing or zero size NEVER estimates at zero", () => {
    for (const mimeType of [DOC, SHEET, SLIDES]) {
      expect(estimatedBytesFor({ mimeType })).toBeGreaterThan(0);
      expect(estimatedBytesFor({ mimeType, size: 0 })).toBeGreaterThan(0);
    }
  });

  // A failed int64 coercion is indistinguishable in consequence from an absent field.
  test("a NaN size falls back rather than propagating", () => {
    expect(estimatedBytesFor({ mimeType: DOC, size: Number.NaN })).toBe(
      DRIVE_NATIVE_ASSUMED_BYTES.document,
    );
  });

  test("a real size is used as-is", () => {
    expect(estimatedBytesFor({ mimeType: "application/pdf", size: 4_242 })).toBe(4_242);
  });

  test("each native kind gets its own assumption", () => {
    expect(estimatedBytesFor({ mimeType: DOC })).toBe(DRIVE_NATIVE_ASSUMED_BYTES.document);
    expect(estimatedBytesFor({ mimeType: SLIDES })).toBe(DRIVE_NATIVE_ASSUMED_BYTES.presentation);
    expect(estimatedBytesFor({ mimeType: SHEET })).toBe(DRIVE_NATIVE_ASSUMED_BYTES.spreadsheet);
  });

  // An unknown kind is the case we know LEAST about, so it must not reserve the least.
  test("an unknown mime with no size reserves at least the largest assumption", () => {
    const largest = Math.max(...Object.values(DRIVE_NATIVE_ASSUMED_BYTES));
    expect(estimatedBytesFor({ mimeType: "application/octet-stream" })).toBe(largest);
    expect(estimatedBytesFor({ mimeType: "application/vnd.google-apps.jam" })).toBe(largest);
  });
});
