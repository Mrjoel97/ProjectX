import { describe, expect, test } from "vitest";
import { hasPassingVerticalEvalEvidence, VERTICAL_EVAL_SUITE } from "../verticalEval";

describe("vertical native evaluation release lock", () => {
  test("closes exactly six source candidates without declaring an executable suite", () => {
    expect(VERTICAL_EVAL_SUITE.executable).toBe(false);
    expect([...VERTICAL_EVAL_SUITE.names].sort()).toEqual([
      "vertical-data",
      "vertical-design",
      "vertical-engineering",
      "vertical-hr",
      "vertical-legal",
      "vertical-product",
    ]);
  });
  test("absent, pilot, mock and fabricated passing evidence cannot release candidates", () => {
    for (const name of [...VERTICAL_EVAL_SUITE.names, "vertical-bio", "pack-business-pulse"]) {
      for (const evidence of [
        undefined,
        "malformed",
        JSON.stringify({
          runner: "eval:packs",
          passed: true,
          casesPassed: 100,
          casesTotal: 100,
          skillVersions: { [name]: 1 },
          suite: VERTICAL_EVAL_SUITE,
        }),
        JSON.stringify({ runner: "eval:vertical", passed: true, mock: false }),
      ]) {
        expect(hasPassingVerticalEvalEvidence(evidence, name, 1)).toBe(false);
      }
    }
  });
});
