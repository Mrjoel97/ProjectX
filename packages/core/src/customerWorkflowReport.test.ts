import { expect, test } from "vitest";
import { completedWorkflowReport } from "./customerWorkflowReport";

const json = (markdown: string) => JSON.stringify({ title: "Retail decision", markdown });
const table = (value: string) => "| Measure | Value |\n|---|---|\n| Gross margin | " + value + " |";
const needs = ["Calculate the retailer gross margin", "Table: Gross margin (%)"];
test.each([
  ["Harbor shirt. Wholesale $24, suggested retail $60.", "60%"],
  ["Dune jacket. Wholesale $58, suggested retail $100.", "42%"],
])("accepts calculated margin for %s", (brief, margin) => {
  expect(completedWorkflowReport(json(table(margin)), needs, brief)?.markdown).toContain(margin);
  for (const invalid of ["TBD", "42", "(Retail - Wholesale) / Retail", "99%"])
    expect(completedWorkflowReport(json(table(invalid)), needs, brief)).toBeNull();
  expect(completedWorkflowReport(json("Here’s the plan for the report."), needs, brief)).toBeNull();
});
test("supports units in a column heading and checks every product row", () => {
  const markdown = "| Product | Lead time (weeks) |\n|---|---|\n| Harbor | 4 |\n| Dune | 8 |";
  const req = ["Table: Lead time (weeks)"];
  expect(completedWorkflowReport(json(markdown), req, "Compare products")).toBeTruthy();
  expect(
    completedWorkflowReport(json(markdown.replace("8 |", "Eightish |")), req, "Compare products"),
  ).toBeNull();
});
test("prose reports can omit tables, while an explicit request requires renderable rows", () => {
  expect(
    completedWorkflowReport(
      json("A warm tone suits this brand."),
      ["Describe the brand voice"],
      "",
    ),
  ).toBeTruthy();
  for (const body of [
    "A warm tone.",
    "| Measure | Value |\n|---|---|",
    "| Measure | Value |\n|---|---|\n| Speed |",
  ])
    expect(completedWorkflowReport(json(body), ["Include a table"], "")).toBeNull();
});
