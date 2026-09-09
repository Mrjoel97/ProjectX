import { describe, expect, test } from "vitest";
import {
  classifyPayload,
  classifyString,
  fingerprint,
  keyIsPiiShaped,
  worst,
} from "./payloadShape";

// The classifier ADR-044 T3 asks for: a check that reads ROWS, not code. These cases pin the two
// properties that make it worth running — it catches the shapes §4 forbids, and it does not
// falsely convict the shapes the audit log is actually made of. A checker that flags every row is
// a checker somebody switches off, which is the same failure as one that flags none.

describe("value shapes §4 permits", () => {
  test.each([
    ["kg2h8x1p9m4tz7qwer3nvb5c", "ref"],
    ["9f86d081884c7d659a2feaa0c55ad015", "hash"],
    ["2026-09-09T03:00:00.000Z", "iso_timestamp"],
    ["2026-09-09", "iso_timestamp"],
    ["media.deck_refused", "slug"],
    ["billing/evt_1P2x3Y4z", "slug"],
    ["mediabatch:kg2h8x1p9m4tz7qwer3nvb5c", "slug"],
    ["provider_5xx", "slug"],
    ["", "empty"],
  ])("%s is %s", (value, reason) => {
    const r = classifyString(value);
    expect(r.verdict, `${value} should be ok`).toBe("ok");
    expect(r.reason).toBe(reason);
  });
});

describe("value shapes §4 forbids", () => {
  test("an email address anywhere in the string is a violation", () => {
    expect(classifyString("someone@example.com").verdict).toBe("violation");
    // The tell is the shape, not the whole string being an address.
    expect(classifyString("to=someone@example.com").verdict).toBe("violation");
  });

  test("a URL with a QUERY STRING is a violation — the query is where identity hides", () => {
    expect(classifyString("https://x.test/a?token=abc").verdict).toBe("violation");
    // A bare URL has no query to hide in and is a ref; it is NOT flagged, deliberately.
    expect(classifyString("https://x.test/a").verdict).not.toBe("violation");
  });

  test("prose is a violation and a short phrase is a suspect — whitespace is the tell", () => {
    expect(
      classifyString("The customer asked whether the invoice had already been paid").verdict,
    ).toBe("violation");
    expect(classifyString("two words").verdict).toBe("suspect");
  });

  test("an unclassified opaque string is SUSPECT, not ok — the default is to flag", () => {
    // Mixed case with punctuation that is not a slug, not a hash, not a ref.
    expect(classifyString("Zm9vYmFy=+/AAAA").verdict).toBe("suspect");
  });
});

describe("the KEY can convict a value that looks innocent", () => {
  test("PII-shaped keys are recognised in camelCase and snake_case", () => {
    for (const k of ["email", "recipientEmail", "recipient_email", "Body", "customerName"]) {
      expect(keyIsPiiShaped(k), `${k} should be PII-shaped`).toBe(true);
    }
  });

  test("a COUNT that merely contains a PII stem is NOT flagged", () => {
    // This is the false-positive that would make the gate unreadable, so it is pinned.
    for (const k of ["emailsSent", "messageCount", "nameLength", "bodySize", "notesTotal"]) {
      expect(keyIsPiiShaped(k), `${k} is a count`).toBe(false);
    }
  });

  test("a REF SUFFIX on a PII stem is permitted — §4 names refs, hashes and ids", () => {
    // Every one of these was a false positive on the first live production run (8 suspects over
    // 672 rows, all of this shape, none real).
    for (const k of [
      "promptHash",
      "skillBodyHash",
      "bodyHash",
      "messageId",
      "emailHash",
      "noteRef",
    ]) {
      expect(keyIsPiiShaped(k), `${k} points AT the thing, it is not the thing`).toBe(false);
    }
  });

  test("the ref-suffix rule does NOT release a bare PII key", () => {
    // The direction that matters: loosening for `promptHash` must not loosen for `prompt`.
    for (const k of ["prompt", "body", "message", "email", "customerName"]) {
      expect(keyIsPiiShaped(k), `${k} is still PII-shaped`).toBe(true);
    }
  });

  test("the reviewed-key exception is EXACT, not a suffix rule", () => {
    expect(keyIsPiiShaped("skillName")).toBe(false);
    // If this were a `*Name` rule, the next line would fail — and a person's name would walk
    // through the gate behind a skill slug.
    expect(keyIsPiiShaped("customerName")).toBe(true);
    expect(keyIsPiiShaped("recipientName")).toBe(true);
  });

  test("a PII-shaped key flags even when the value is a clean ref", () => {
    const f = classifyPayload({ email: "kg2h8x1p9m4tz7qwer3nvb5c" });
    expect(f).toHaveLength(1);
    expect(f[0]?.verdict).toBe("suspect");
    expect(f[0]?.reason).toBe("pii_key:ref");
  });

  test("a PII-shaped key holding an email is a VIOLATION, not merely suspect", () => {
    expect(worst(classifyPayload({ email: "a@b.co" }))).toBe("violation");
  });
});

describe("the walk", () => {
  test("a clean refs-and-counts payload yields NOTHING", () => {
    const clean = {
      tenantId: "kg2h8x1p9m4tz7qwer3nvb5c",
      planId: "kg2h8x1p9m4tz7qwer3nvb5d",
      eventType: "media.deck_refused",
      emailsSent: 3,
      ok: true,
      at: "2026-09-09T03:00:00.000Z",
      digest: "9f86d081884c7d659a2feaa0c55ad015",
    };
    expect(classifyPayload(clean)).toEqual([]);
    expect(worst(classifyPayload(clean))).toBe("ok");
  });

  test("nested objects report a DOTTED path so the writer is findable", () => {
    const f = classifyPayload({ step: { detail: "a sentence that is quite clearly prose here" } });
    expect(f[0]?.path).toBe("step.detail");
    expect(f[0]?.verdict).toBe("violation");
  });

  test("an array collapses to ONE finding per shape, not one per element", () => {
    const rows = Array.from({ length: 200 }, () => ({ note: "some free text here please" }));
    const f = classifyPayload({ rows });
    expect(f).toHaveLength(1);
    expect(f[0]?.path).toBe("rows[].note");
  });

  test("a payload deep enough to hide in is itself the finding", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < 20; i++) deep = { a: deep };
    expect(classifyPayload(deep).some((x) => x.reason === "depth_exceeded")).toBe(true);
  });

  test("numbers, booleans and null are never findings", () => {
    expect(classifyPayload({ n: 1, b: false, z: null, big: 10n })).toEqual([]);
  });
});

describe("NO FINDING EVER CARRIES THE VALUE", () => {
  // The property that makes it safe to run this over production rows and paste the output. A
  // checker that echoes suspected PII has moved the leak rather than found it.
  test("a fingerprint reports length and character classes only", () => {
    const secret = "Bearer sk_live_51H8xQ2 abcdef";
    const f = classifyPayload({ detail: secret });
    const serialised = JSON.stringify(f);
    expect(serialised).not.toContain("sk_live");
    expect(serialised).not.toContain("Bearer");
    expect(f[0]?.fingerprint).toBe(fingerprint(secret));
    expect(f[0]?.fingerprint).toMatch(/^len=\d+ cls=/);
  });

  test("the fingerprint of an email does not contain the address", () => {
    const f = classifyPayload({ to: "someone@example.com" });
    expect(JSON.stringify(f)).not.toContain("example.com");
  });
});
