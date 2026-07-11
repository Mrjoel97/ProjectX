import { describe, expect, test } from "vitest";
import {
  MAX_ATTACHMENTS,
  MAX_GOAL_LEN,
  MAX_ATTACHMENT_SIZE,
  validateSubmit,
  type Attachment,
} from "./validateSubmit";

// A minimal well-formed attachment, spread + overridden per case.
const att = (over: Partial<Attachment> = {}): Attachment => ({
  storageId: "kg123",
  filename: "note.txt",
  mimeType: "text/plain",
  size: 1024,
  ...over,
});

const base = { goal: "Draft a friendly reminder", recipient: "a@b.com", attachments: [] as Attachment[] };

describe("validateSubmit — INTK-04 content checks", () => {
  test("well-formed submit passes", () => {
    expect(validateSubmit(base)).toEqual({ ok: true });
    expect(validateSubmit({ ...base, attachments: [att()] })).toEqual({ ok: true });
  });

  test("empty / whitespace goal → empty_goal", () => {
    expect(validateSubmit({ ...base, goal: "" })).toEqual({ ok: false, reason: "empty_goal" });
    expect(validateSubmit({ ...base, goal: "   \n\t " })).toEqual({ ok: false, reason: "empty_goal" });
  });

  test("goal over MAX_GOAL_LEN → goal_too_long", () => {
    expect(validateSubmit({ ...base, goal: "x".repeat(MAX_GOAL_LEN + 1) })).toEqual({
      ok: false,
      reason: "goal_too_long",
    });
    // exactly at the cap is fine
    expect(validateSubmit({ ...base, goal: "x".repeat(MAX_GOAL_LEN) })).toEqual({ ok: true });
  });

  test("structurally invalid recipient → bad_recipient", () => {
    for (const bad of ["", "nope", "a@b", "a b@c.com", "@b.com", "a@.com"]) {
      expect(validateSubmit({ ...base, recipient: bad })).toEqual({ ok: false, reason: "bad_recipient" });
    }
  });

  test("disallowed mime → bad_mime", () => {
    expect(validateSubmit({ ...base, attachments: [att({ mimeType: "application/x-msdownload" })] })).toEqual({
      ok: false,
      reason: "bad_mime",
    });
  });

  test("allowlisted mimes pass", () => {
    for (const m of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
      "audio/mpeg",
      "audio/mp4",
      "audio/wav",
      "text/plain",
      "text/markdown",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]) {
      expect(validateSubmit({ ...base, attachments: [att({ mimeType: m })] })).toEqual({ ok: true });
    }
  });

  test("attachment over the size cap → attachment_too_large", () => {
    expect(validateSubmit({ ...base, attachments: [att({ size: MAX_ATTACHMENT_SIZE + 1 })] })).toEqual({
      ok: false,
      reason: "attachment_too_large",
    });
    expect(validateSubmit({ ...base, attachments: [att({ size: MAX_ATTACHMENT_SIZE })] })).toEqual({ ok: true });
  });

  test("more than MAX_ATTACHMENTS → too_many_attachments", () => {
    const many = Array.from({ length: MAX_ATTACHMENTS + 1 }, () => att());
    expect(validateSubmit({ ...base, attachments: many })).toEqual({
      ok: false,
      reason: "too_many_attachments",
    });
    const exact = Array.from({ length: MAX_ATTACHMENTS }, () => att());
    expect(validateSubmit({ ...base, attachments: exact })).toEqual({ ok: true });
  });
});
