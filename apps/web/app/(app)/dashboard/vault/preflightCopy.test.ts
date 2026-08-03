// The locked refusal sentence, tested BESIDE its module — which is only possible as of 2026-08-04,
// when `apps/web` got a test runner at all (see `apps/web/vitest.config.mts` for why it had none).
//
// These assertions previously lived in `packages/core/src/vaultSurface.test.ts` because a file here
// executed nowhere. A file with this exact path shipped in 15.3-07 and was never run once; if you
// are reading this because `pnpm test` is suddenly slower, that is the trade.
//
// WHY BEHAVIOURAL ASSERTIONS AND NOT A SOURCE SCAN: the scan in `vaultSurface.test.ts` proves the
// sentence template has exactly ONE writer, and that is worth keeping — but it CANNOT prove the
// sentence names both numbers. Drop `${money(a.remainingCents)}` while leaving the words "left
// today" in place and every text anchor still matches. Only calling the function observes the
// figures coming out. That mutation is the one this file exists to catch.
import { describe, expect, test } from "vitest";
import { refusalCopy } from "./preflightCopy";

describe("refusalCopy names both numbers (the locked sentence)", () => {
  const NUMBERED = [
    "over_folder_cap",
    "over_deployment_cap",
    "deployment_ingest_exhausted",
    "ingest_daily_exhausted",
    "a_code_added_in_some_later_phase", // the default arm — naming numbers is the FAIL-SAFE side
  ];

  test.each(NUMBERED)("%s names the estimate and what is left", (reason) => {
    const { title, remedy } = refusalCopy({ reason, estimateCents: 340, remainingCents: 110 });
    expect(title).toContain("$3.40");
    expect(title).toContain("$1.10");
    expect(remedy.length).toBeGreaterThan(0);
  });

  // The deny-list is the deliberate exception: pricing never ran, so both figures are 0 and a
  // sentence naming them would be a confident lie. It must not name a MONEY figure at all.
  test.each(["kill_switch", "not_reserving", "manifest_short"])(
    "%s names no figure, because it has none",
    (reason) => {
      const { title, remedy } = refusalCopy({ reason, estimateCents: 0, remainingCents: 0 });
      expect(`${title} ${remedy}`).not.toMatch(/\$\d/);
      expect(title.length).toBeGreaterThan(0);
    },
  );

  // Rounding is part of "the number the reserve takes": 5 cents must read $0.05, not $0.5.
  test("cents render as two decimals", () => {
    expect(
      refusalCopy({ reason: "over_folder_cap", estimateCents: 5, remainingCents: 0 }).title,
    ).toContain("$0.05");
  });
});
