import { expect, test } from "@playwright/test";
import {
  PACK_BROWSER_CELLS,
  PACK_BROWSER_FIXTURES,
  PACK_REFUSAL_REQUESTS,
  preparedPackBrowserCase,
  validatePackBrowserFixtures,
} from "./workflowPackBrowserProtocol";

test.use({ trace: "off", video: "off", screenshot: "off" });

const rowAt = <T>(rows: readonly T[], index: number): T => {
  const row = rows[index];
  if (row === undefined) throw new Error("TEST_FIXTURE_MISSING");
  return row;
};

// These are pure fixture checks. No page/request/context fixture and no registry evidence write.
test.describe("@protocol-fixture offline invalid-fixture rejection", () => {
  const copy = () => PACK_BROWSER_FIXTURES.map((fixture) => ({ ...fixture }));
  const rejected = (value: unknown) =>
    expect(() => validatePackBrowserFixtures(value)).toThrow("PACK_BROWSER_FIXTURE_INVALID");

  test("missing or duplicated pilot workflows cannot shrink the acceptance scope", () => {
    rejected(PACK_BROWSER_FIXTURES.slice(1));
    const rows = copy();
    rows[0] = rowAt(rows, 1);
    rejected(rows);
  });

  test("the seventh workflow cannot borrow a six-pack slot", () => {
    const rows = copy() as unknown as Record<string, unknown>[];
    rowAt(rows, 0).packId = "offer-and-lead-plan";
    rejected(rows);
  });

  test("malformed and evidence-shaped imported records are not fixture input", () => {
    for (const value of [null, {}, "pass", [null, ...copy().slice(1)]]) rejected(value);
    const rows = copy() as unknown as Record<string, unknown>[];
    rowAt(rows, 0).pass = true;
    rowAt(rows, 0).candidateVersion = 99;
    rejected(rows);
  });

  test("a briefing cannot pretend to save a document or expose an approval plan", () => {
    const rows = copy();
    rowAt(rows, 0).output = "document";
    rowAt(rows, 0).decisionSurface = "proposed-reply";
    rejected(rows);
  });

  test("a matrix-missing or unrelated source cannot be presented as reachable", () => {
    const rows = copy() as unknown as Record<string, unknown>[];
    rowAt(rows, 0).source = "phase26-summaries";
    rejected(rows);
    rowAt(rows, 0).source = "calendar";
    rejected(rows);
  });

  test("empty edits and non-synthetic source content are refused", () => {
    const rows = copy();
    rowAt(rows, 0).editRequest = "";
    rejected(rows);
    rowAt(rows, 0).editRequest = rowAt(PACK_BROWSER_FIXTURES, 0).editRequest;
    rowAt(rows, 0).sourceText = "Borrowed customer content without a synthetic fixture label.";
    rejected(rows);
  });

  test("every workflow retains all five refusal classes and all nine obligations", () => {
    expect(Object.keys(PACK_REFUSAL_REQUESTS).sort()).toEqual([
      "external_send",
      "external_write",
      "paid_generation",
      "skill_authoring",
      "specialist_dispatch",
    ]);
    expect(PACK_BROWSER_CELLS).toHaveLength(9);
    for (const fixture of PACK_BROWSER_FIXTURES) {
      for (const cell of PACK_BROWSER_CELLS) {
        const row = preparedPackBrowserCase(fixture, cell);
        expect(row.liveStatus).toBe("not-observed");
        expect(row.evidenceWritable).toBe(false);
        expect(row.instructions.every((instruction) => instruction.trim().length > 20)).toBe(true);
      }
    }
  });

  test("complaint staging requires a server-resolved isolated reply target", () => {
    const fixture = PACK_BROWSER_FIXTURES.find((row) => row.packId === "customer-complaint");
    if (!fixture) throw new Error("TEST_FIXTURE_MISSING");
    const row = preparedPackBrowserCase(fixture, "useful");
    expect(row.prerequisites.join(" ")).toContain("pasted text alone is insufficient");
    expect(row.instructions.join(" ")).toContain("Do not send or change its recipient");
  });

  test("missing edit/reject controls stay gaps and recovery forbids unknown-turn replay", () => {
    for (const fixture of PACK_BROWSER_FIXTURES) {
      expect(preparedPackBrowserCase(fixture, "edit").instructions.join(" ")).toContain(
        "remains a gap",
      );
      expect(preparedPackBrowserCase(fixture, "reject").instructions.join(" ")).toContain(
        "not an automatic pass",
      );
      expect(preparedPackBrowserCase(fixture, "recovery").instructions.join(" ")).toContain(
        "Do not resend, restart or replay",
      );
      expect(preparedPackBrowserCase(fixture, "owner-decision").instructions.join(" ")).toContain(
        "cannot supply that decision",
      );
    }
  });
});
