import { describe, expect, test } from "vitest";
import { parseMarketingLead } from "./marketingLead";

describe("operator marketing lead contract", () => {
  test("normalizes identity while retaining verbatim per-person wording", () => {
    expect(
      parseMarketingLead({
        email: " Person@Example.COM ",
        name: " Pat ",
        consent: { wording: "  They asked for updates.  " },
      }),
    ).toEqual({
      email: "person@example.com",
      name: "Pat",
      origin: "user-entered",
      consent: { wording: "  They asked for updates.  ", source: "asserted-by-user" },
    });
    expect(parseMarketingLead({ email: "person@example.com" })).not.toHaveProperty("consent");
  });
  test.each([
    { email: "not-an-email" },
    { email: "a@b.com", name: "x".repeat(161) },
    { email: "a@b.com", company: "x".repeat(201) },
    { email: "a@b.com", consent: { wording: " " } },
    { email: "a@b.com", consent: { wording: "x".repeat(4001) } },
    { email: "a@b.com", consent: { wording: "yes", context: "x".repeat(1001) } },
    { email: "a@b.com", name: "bad\u0000value" },
  ])("rejects invalid input before storage", (input) =>
    expect(() => parseMarketingLead(input)).toThrow());
});
