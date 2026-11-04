import { expect, test } from "vitest";
import { isCustomerWorkflowPilotTenant } from "./customerWorkflowPilot";

test("pilot admits only explicitly named tenants and rejects malformed or oversized lists", () => {
  expect(isCustomerWorkflowPilotTenant("tenant-a", '["tenant-a"]')).toBe(true);
  for (const configuration of [
    undefined,
    "",
    "true",
    "[",
    '["*"]',
    '["tenant-b"]',
    '["tenant-a",1]',
  ]) {
    expect(isCustomerWorkflowPilotTenant("tenant-a", configuration)).toBe(false);
  }
  expect(
    isCustomerWorkflowPilotTenant("tenant-a", JSON.stringify(Array(101).fill("tenant-a"))),
  ).toBe(false);
  expect(isCustomerWorkflowPilotTenant("", '[""]')).toBe(false);
});
