// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  inspectPreparation,
  main,
  validatePreparationFixture,
} from "../scripts/run-eval-vertical.mjs";

describe("vertical eval preparation, never passing model evidence", () => {
  const fixture = () => ({
    schemaVersion: 1,
    packId: "product",
    candidateVersion: 1,
    executionStatus: "not-run",
    cases: [{ id: "partial", input: { request: "Draft a PRD" }, expected: { state: "partial" } }],
  });
  test("validates the real closed corpus against candidate bodies and versions", async () => {
    const rows = inspectPreparation();
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.caseCount).toBeGreaterThan(0);
      expect(row.bodyHash).toMatch(/^[a-f0-9]{64}$/);
      expect(row.casesHash).toMatch(/^[a-f0-9]{64}$/);
    }
    const result = await main(["--fixtures-only"]);
    expect(result).toMatchObject({
      status: "preparation-only",
      modelEvaluated: false,
      evidenceRecorded: false,
    });
    expect(JSON.stringify(result)).not.toContain("request");
  });
  test("execution fails before any paid call or evidence write", () => {
    expect(() => main(["--all-candidates", "--no-activate"])).toThrow(
      "VERTICAL_EVAL_NOT_EXECUTABLE",
    );
    expect(() => main(["--all-candidates"])).toThrow();
    expect(() => main(["--fixtures-only", "--all-candidates"])).toThrow();
    expect(() => main(["--activate"])).toThrow();
  });
  test("refuses wrong versions, unsupported lanes, missing assertions and injected evidence", () => {
    expect(() => validatePreparationFixture(fixture(), "product", 2)).toThrow();
    expect(() => validatePreparationFixture(fixture(), "bio", 1)).toThrow();
    const duplicate = fixture();
    duplicate.cases.push(...duplicate.cases);
    expect(() => validatePreparationFixture(duplicate, "product", 1)).toThrow("duplicate");
    expect(() =>
      validatePreparationFixture({ ...fixture(), executionStatus: "passed" }, "product", 1),
    ).toThrow();
    expect(() =>
      validatePreparationFixture(
        { ...fixture(), cases: [{ id: "x", input: "request" }] },
        "product",
        1,
      ),
    ).toThrow();
    expect(() =>
      validatePreparationFixture(
        { ...fixture(), cases: [{ ...fixture().cases[0], passed: true }] },
        "product",
        1,
      ),
    ).toThrow();
  });
});
