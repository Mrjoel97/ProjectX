import { describe, expect, it } from "vitest";
import {
  CRM_OPERATION_MAX,
  CRM_TEXT_MAX,
  followUpIsDue,
  isValidEmail,
  needsAttention,
  normalizeAddress,
  parseCrmOperations,
  renderFooter,
  withheldNote,
} from "./index";

describe("normalizeAddress", () => {
  const INPUTS = [
    "bob@example.com", // already normal
    "  Bob@Example.COM ", // mixed case + surrounding spaces
    "\tBOB@EXAMPLE.COM\n", // tabs and newlines
    "", // empty
    "   ", // whitespace only
    "Ann.O'Neil+tag@Sub.Example.Co.UK",
  ];

  it("trims and lowercases", () => {
    expect(normalizeAddress("  Bob@Example.COM ")).toBe("bob@example.com");
  });

  it("is idempotent — the suppressions key must be byte-stable", () => {
    for (const s of INPUTS) {
      const once = normalizeAddress(s);
      expect(normalizeAddress(once)).toBe(once);
    }
  });

  it("normalizes empty and whitespace-only input to the empty string (callers reject)", () => {
    expect(normalizeAddress("")).toBe("");
    expect(normalizeAddress("   \t\n ")).toBe("");
  });

  it("does NOT strip plus-addressing or fold dots — that is person-level merging, deferred", () => {
    expect(normalizeAddress("Bob+news@Example.com")).toBe("bob+news@example.com");
    expect(normalizeAddress("b.o.b@Example.com")).toBe("b.o.b@example.com");
  });
});

describe("needsAttention", () => {
  it("is true for a contact with no open follow-up", () => {
    expect(needsAttention("c1", new Set(["c2"]))).toBe(true);
  });

  it("is false for a contact with an open follow-up", () => {
    expect(needsAttention("c1", new Set(["c1", "c2"]))).toBe(false);
  });

  it("is true when the open set is empty — done/canceled follow-ups never reach here", () => {
    expect(needsAttention("c1", new Set<string>())).toBe(true);
  });
});

describe("followUpIsDue", () => {
  const NOW = Date.UTC(2026, 7, 9);

  it("is true when the due instant has passed", () => {
    expect(followUpIsDue(NOW - 1, NOW)).toBe(true);
  });

  it("is true AT the due instant — the tile's arithmetic boundary", () => {
    expect(followUpIsDue(NOW, NOW)).toBe(true);
  });

  it("is false before the due instant", () => {
    expect(followUpIsDue(NOW + 1, NOW)).toBe(false);
  });
});

describe("renderFooter", () => {
  const POSTAL = "Pikar AI, 12 Kigali Heights, Kigali, Rwanda";
  const URL = "https://app.pikar.ai/u/abc123";

  it("contains the postal address and the unsubscribe URL verbatim", () => {
    const out = renderFooter({ postalAddress: POSTAL, unsubscribeUrl: URL });
    expect(out).toContain(POSTAL);
    expect(out).toContain(URL);
  });

  it("begins with a blank-line separator so it cannot run into the last sentence", () => {
    const out = renderFooter({ postalAddress: POSTAL, unsubscribeUrl: URL });
    expect(out.startsWith("\n\n")).toBe(true);
  });

  it("throws on an empty or whitespace-only postal address (fail closed)", () => {
    expect(() => renderFooter({ postalAddress: "", unsubscribeUrl: URL })).toThrow();
    expect(() => renderFooter({ postalAddress: "   \t ", unsubscribeUrl: URL })).toThrow();
  });

  it("throws on an empty unsubscribe URL — a dead link is not an unsubscribe", () => {
    expect(() => renderFooter({ postalAddress: POSTAL, unsubscribeUrl: "  " })).toThrow();
  });
});

describe("withheldNote (19-05 SC#5, persisted on the plan row)", () => {
  const FIVE = ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"];

  it("names the count that WENT and every address that did not", () => {
    // The exact sentence phase-19 UAT step 9(b) reads off the report card.
    expect(withheldNote(FIVE, ["c@x.com"])).toBe(
      "Sent to 4. Withheld 1 who unsubscribed: c@x.com.",
    );
  });

  it("renders NOTHING when nobody was withheld — an ordinary send has no footnote", () => {
    expect(withheldNote(FIVE, [])).toBeNull();
    expect(withheldNote(FIVE, undefined)).toBeNull();
  });

  it("lists every withheld address, never a truncated summary", () => {
    const out = withheldNote(FIVE, ["b@x.com", "d@x.com"]);
    expect(out).toBe("Sent to 3. Withheld 2 who unsubscribed: b@x.com, d@x.com.");
  });

  it("clamps the sent count at zero rather than printing a negative", () => {
    expect(withheldNote(["a@x.com"], ["a@x.com", "b@x.com"])).toBe(
      "Sent to 0. Withheld 2 who unsubscribed: a@x.com, b@x.com.",
    );
  });
});

// ── parseCrmOperations (19-06, ACTN-05) ───────────────────────────────────────
// The pure contract of a `crm_write` plan's operation list. Every refusal below is a DELIBERATE
// governed stop, not a validator's leftovers — the comments say which.

describe("parseCrmOperations", () => {
  const ADD_CONTACT = {
    op: "addContact",
    email: "  Bob@X.com ",
    name: " Bob ",
    origin: "user-entered",
  };
  const ADD_FOLLOWUP = {
    op: "addFollowUp",
    email: "BOB@x.com",
    note: " chase the quote ",
    dueAt: 1_800_000,
  };

  it("accepts all four operations and normalizes every email through normalizeAddress", () => {
    const out = parseCrmOperations([
      ADD_CONTACT,
      ADD_FOLLOWUP,
      { op: "completeFollowUp", followUpRef: " ref-1 " },
      { op: "cancelFollowUp", followUpRef: "ref-2" },
    ]);
    expect(out).toEqual([
      { op: "addContact", email: "bob@x.com", name: "Bob", origin: "user-entered" },
      { op: "addFollowUp", email: "bob@x.com", note: "chase the quote", dueAt: 1_800_000 },
      { op: "completeFollowUp", followUpRef: "ref-1" },
      { op: "cancelFollowUp", followUpRef: "ref-2" },
    ]);
    // The identity rule has exactly one implementation (invariant 4): the parser's output is what
    // normalizeAddress produces, never a second lowercase at the applier.
    expect(out[0]).toMatchObject({ email: normalizeAddress(ADD_CONTACT.email) });
  });

  it("REFUSES an empty list — a CRM plan with nothing to apply is a bug, not a no-op", () => {
    expect(() => parseCrmOperations([])).toThrow(/CRM_OPERATIONS_EMPTY/);
  });

  it("REFUSES a non-list", () => {
    expect(() => parseCrmOperations(undefined)).toThrow(/CRM_OPERATIONS_NOT_A_LIST/);
    expect(() => parseCrmOperations({ op: "addContact" })).toThrow(/CRM_OPERATIONS_NOT_A_LIST/);
  });

  it("REFUSES a list over the ceiling, and accepts one exactly at it", () => {
    const at = Array.from({ length: CRM_OPERATION_MAX }, () => ADD_CONTACT);
    expect(parseCrmOperations(at)).toHaveLength(CRM_OPERATION_MAX);
    expect(() => parseCrmOperations([...at, ADD_CONTACT])).toThrow(/CRM_OPERATIONS_TOO_MANY/);
  });

  it("REFUSES a follow-up with no due date — the tile could never show it", () => {
    for (const dueAt of [undefined, null, "tomorrow", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => parseCrmOperations([{ ...ADD_FOLLOWUP, dueAt }])).toThrow(
        /CRM_FOLLOWUP_DUEAT_REQUIRED/,
      );
    }
  });

  // THE STRUCTURAL BRAKE. Contactless follow-ups are a USER-only capability; an agent that can
  // mint them turns this CRM into a general task generator.
  it("REFUSES an agent follow-up that names no contact", () => {
    for (const email of [undefined, "", "   ", 42]) {
      expect(() => parseCrmOperations([{ ...ADD_FOLLOWUP, email }])).toThrow(
        /CRM_FOLLOWUP_CONTACT_REQUIRED/,
      );
    }
  });

  // 19-11 (the defect eval run 266ef8f4 exposed). The required `email` on `addFollowUp` is the
  // structural brake against a general task generator — and a brake the model can satisfy with ANY
  // non-empty string is not a brake. The live agent, asked for a follow-up "not tied to anyone",
  // wrote `{"op":"addFollowUp","email":"no-email",…}` and sailed straight through.
  it("REFUSES a FABRICATED address — `no-email` is not an address", () => {
    for (const email of ["no-email", "none", "n/a", "unknown", "@x.com", "a@b", "a b@x.com"]) {
      expect(() => parseCrmOperations([{ ...ADD_FOLLOWUP, email }])).toThrow(
        /CRM_FOLLOWUP_CONTACT_INVALID/,
      );
      expect(() => parseCrmOperations([{ ...ADD_CONTACT, email }])).toThrow(
        /CRM_CONTACT_EMAIL_INVALID/,
      );
    }
  });

  // Non-vacuity: the check must still ADMIT the addresses this CRM exists to hold, including the
  // subdomain/plus/apostrophe shapes `normalizeAddress`'s own table already carries.
  it("ACCEPTS real addresses, and the check is the send path's own `isValidEmail`", () => {
    for (const email of ["bob@x.com", "Ann.O'Neil+tag@Sub.Example.Co.UK", "a@b.co"]) {
      expect(isValidEmail(normalizeAddress(email))).toBe(true);
      expect(parseCrmOperations([{ ...ADD_FOLLOWUP, email }])).toHaveLength(1);
      expect(parseCrmOperations([{ ...ADD_CONTACT, email }])).toHaveLength(1);
    }
  });

  it("REFUSES a blank contact email, a bad origin and an unknown op", () => {
    expect(() => parseCrmOperations([{ ...ADD_CONTACT, email: "   " }])).toThrow(
      /CRM_CONTACT_EMAIL_REQUIRED/,
    );
    expect(() => parseCrmOperations([{ ...ADD_CONTACT, origin: "guessed" }])).toThrow(
      /CRM_CONTACT_ORIGIN_INVALID/,
    );
    // SILENT SITE 2 (19.1-02). Human-only import is LOCKED: the agent may not stage an imported
    // contact, because the attestation is a legal statement a person makes about a file the agent
    // cannot see. `ORIGINS` is typed `readonly string[]`, NOT `readonly CrmContactOrigin[]`, so it
    // is structurally decoupled from the type above — widening one never touches the other and tsc
    // reports nothing. This assertion is the only thing holding them together.
    expect(() => parseCrmOperations([{ ...ADD_CONTACT, origin: "imported" }])).toThrow(
      /CRM_CONTACT_ORIGIN_INVALID/,
    );
    expect(() => parseCrmOperations([{ op: "deleteContact", email: "bob@x.com" }])).toThrow(
      /CRM_OPERATION_UNKNOWN/,
    );
    expect(() => parseCrmOperations(["addContact"])).toThrow(/CRM_OPERATION_MALFORMED/);
  });

  it("REFUSES a blank note, a blank followUpRef, and model text over the ceiling", () => {
    expect(() => parseCrmOperations([{ ...ADD_FOLLOWUP, note: "  " }])).toThrow(
      /CRM_FOLLOWUP_NOTE_REQUIRED/,
    );
    expect(() => parseCrmOperations([{ op: "completeFollowUp", followUpRef: "" }])).toThrow(
      /CRM_FOLLOWUP_REF_REQUIRED/,
    );
    expect(() =>
      parseCrmOperations([{ ...ADD_FOLLOWUP, note: "x".repeat(CRM_TEXT_MAX + 1) }]),
    ).toThrow(/CRM_FOLLOWUP_NOTE_REQUIRED/);
  });

  // Re-parsing the parser's OWN output must be a fixed point: `parseCrmOperations` runs at the
  // stage boundary AND again at the apply boundary, so a non-idempotent parser would refuse a plan
  // it had already accepted.
  it("is idempotent — the apply boundary re-parses what the write boundary produced", () => {
    const once = parseCrmOperations([ADD_CONTACT, ADD_FOLLOWUP]);
    expect(parseCrmOperations(once)).toEqual(once);
  });
});
