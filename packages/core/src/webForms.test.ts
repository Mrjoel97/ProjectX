import { describe, expect, it } from "vitest";
import { parseInboundWebForm } from "./webForms";

const node = {
  fields: ["email", "name", "company"] as const,
  consent: "I agree to hear from Pikar AI.",
};

describe("anonymous web form boundary", () => {
  it("normalizes accepted input and assigns server-owned provenance", () => {
    expect(
      parseInboundWebForm(
        { email: " Lead@Example.com ", name: " Lead ", company: " Acme ", consent: "on" },
        node,
      ),
    ).toEqual({
      ok: true,
      value: {
        email: "lead@example.com",
        name: "Lead",
        company: "Acme",
        consent: { source: "inbound-form", wording: node.consent },
        origin: "inbound",
      },
    });
  });

  it("rejects malformed addresses and missing consent without persisting raw data", () => {
    expect(parseInboundWebForm({ email: "bad", consent: "on" }, node)).toEqual({
      ok: false,
      code: "invalid",
    });
    expect(parseInboundWebForm({ email: "a@example.com" }, node)).toEqual({
      ok: false,
      code: "consent_required",
    });
    expect(
      parseInboundWebForm({ email: "a@example.com", consent: "on", name: "\u0000" }, node),
    ).toEqual({ ok: false, code: "invalid" });
  });

  it("ignores fields not enabled by the published form node", () => {
    expect(
      parseInboundWebForm(
        { email: "a@example.com", company: "ignored", consent: true },
        { fields: ["email"], consent: "yes" },
      ),
    ).toMatchObject({
      ok: true,
      value: { email: "a@example.com", origin: "inbound" },
    });
  });
});
