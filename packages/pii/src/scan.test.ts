import { describe, expect, it } from "vitest";
import { scanText } from "./scan";

function unwrapOk<T, E>(r: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error(`expected Ok, got Err: ${JSON.stringify(r)}`);
  return r.value;
}

describe("scanText — detection + redaction (GRDL-01/02 core)", () => {
  it("redacts each structured PII type to a typed placeholder", () => {
    const r = unwrapOk(
      scanText(
        "Mail jane.doe@acme.com or call (555) 123-4567. Card 4242 4242 4242 4242, SSN 123-45-6789.",
      ),
    );
    expect(r.safeText).toBe("Mail [EMAIL_1] or call [PHONE_1]. Card [CARD_1], SSN [SSN_1].");
    expect(r.counts).toEqual({ email: 1, card: 1, ssn: 1, phone: 1 });
  });

  it("Luhn check keeps 16-digit non-card numbers (order ids) unredacted", () => {
    const r = unwrapOk(scanText("Order 1234 5678 9012 3456 shipped."));
    expect(r.safeText).toBe("Order 1234 5678 9012 3456 shipped.");
    expect(r.counts.card).toBe(0);
  });

  it("same raw value always maps to the same placeholder", () => {
    const r = unwrapOk(scanText("Send to bob@x.io and cc bob@x.io plus ann@x.io."));
    expect(r.safeText).toBe("Send to [EMAIL_1] and cc [EMAIL_1] plus [EMAIL_2].");
    expect(r.counts.email).toBe(2); // distinct values, not raw matches
    expect(r.entities.map((e) => e.placeholder)).toEqual(["[EMAIL_1]", "[EMAIL_2]"]);
  });

  it("overlap: phone digits inside an email belong to the email match", () => {
    const r = unwrapOk(scanText("reach me at +15551234567@relay.com ok"));
    expect(r.safeText).toBe("reach me at [EMAIL_1] ok");
    expect(r.counts.phone).toBe(0);
  });

  it("no raw PII survives into safeText (the GRDL-02 invariant)", () => {
    const raw = "e a@b.co p +14155550123 c 4111111111111111 s 987-65-4320";
    const r = unwrapOk(scanText(raw));
    for (const entity of r.entities) {
      expect(r.safeText).not.toContain(entity.value);
    }
    expect(r.entities.length).toBe(4);
  });

  it("clean text passes through untouched with zero counts", () => {
    const r = unwrapOk(scanText("Draft a friendly follow-up about the Q3 report."));
    expect(r.safeText).toBe("Draft a friendly follow-up about the Q3 report.");
    expect(r.counts).toEqual({ email: 0, card: 0, ssn: 0, phone: 0 });
    expect(r.entities).toEqual([]);
  });
});

describe("scanText — fail-closed contract (GRDL-01)", () => {
  it("non-string input returns Err(invalid_input), never partial output", () => {
    for (const bad of [null, undefined, 42, { text: "hi" }, ["hi"]]) {
      const r = scanText(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("invalid_input");
    }
  });

  it("empty string is a valid scan (Ok), not an error", () => {
    const r = unwrapOk(scanText(""));
    expect(r.safeText).toBe("");
    expect(r.entities).toEqual([]);
  });
});
