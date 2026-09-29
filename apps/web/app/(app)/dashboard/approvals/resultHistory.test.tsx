import { describe, expect, test } from "vitest";
import { refusalMessage } from "./ApprovalsView";

describe("approval result history vocabulary", () => {
  test("keeps new provider readiness refusals honest", () => {
    expect(refusalMessage("microsoft_not_connected")).toContain("Nothing was sent");
    expect(refusalMessage("mail_scope_missing")).toContain("Nothing was sent");
  });
});
