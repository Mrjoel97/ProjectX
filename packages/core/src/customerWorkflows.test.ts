import { expect, test } from "vitest";
import { validateCustomerWorkflow, validateCustomerWorkflowBrief } from "./customerWorkflows";

test("workflow briefs stay bounded and have an explicit replay identity", () => {
  expect(
    validateCustomerWorkflow({ name: " Buyer report ", steps: [" Compare products "] }),
  ).toEqual({ name: "Buyer report", steps: ["Compare products"] });
  expect(() => validateCustomerWorkflow({ name: "Report", steps: [] })).toThrow();
  expect(() =>
    validateCustomerWorkflow({ name: "Report", steps: Array(7).fill("Step") }),
  ).toThrow();
  expect(() => validateCustomerWorkflowBrief("x".repeat(8001), "a".repeat(20))).toThrow();
  expect(() => validateCustomerWorkflowBrief("Product A", "short")).toThrow();
});
