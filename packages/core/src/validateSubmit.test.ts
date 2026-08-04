import { describe, expect, test } from "vitest";
import {
  type Attachment,
  MAX_ATTACHMENT_SIZE,
  MAX_ATTACHMENTS,
  MAX_GOAL_LEN,
  MIME_ALLOWLIST,
  resolveMimeType,
  validateSubmit,
} from "./validateSubmit";

// A minimal well-formed attachment, spread + overridden per case.
const att = (over: Partial<Attachment> = {}): Attachment => ({
  storageId: "kg123",
  filename: "note.txt",
  mimeType: "text/plain",
  size: 1024,
  ...over,
});

const base = {
  goal: "Draft a friendly reminder",
  recipient: "a@b.com",
  attachments: [] as Attachment[],
};

describe("validateSubmit — INTK-04 content checks", () => {
  test("well-formed submit passes", () => {
    expect(validateSubmit(base)).toEqual({ ok: true });
    expect(validateSubmit({ ...base, attachments: [att()] })).toEqual({ ok: true });
  });

  test("empty / whitespace goal → empty_goal", () => {
    expect(validateSubmit({ ...base, goal: "" })).toEqual({ ok: false, reason: "empty_goal" });
    expect(validateSubmit({ ...base, goal: "   \n\t " })).toEqual({
      ok: false,
      reason: "empty_goal",
    });
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
      expect(validateSubmit({ ...base, recipient: bad })).toEqual({
        ok: false,
        reason: "bad_recipient",
      });
    }
  });

  test("disallowed mime → bad_mime", () => {
    expect(
      validateSubmit({ ...base, attachments: [att({ mimeType: "application/x-msdownload" })] }),
    ).toEqual({
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
      expect(validateSubmit({ ...base, attachments: [att({ mimeType: m })] })).toEqual({
        ok: true,
      });
    }
  });

  test("attachment over the size cap → attachment_too_large", () => {
    expect(
      validateSubmit({ ...base, attachments: [att({ size: MAX_ATTACHMENT_SIZE + 1 })] }),
    ).toEqual({
      ok: false,
      reason: "attachment_too_large",
    });
    expect(validateSubmit({ ...base, attachments: [att({ size: MAX_ATTACHMENT_SIZE })] })).toEqual({
      ok: true,
    });
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

describe("resolveMimeType", () => {
  test("a browser-supplied type always wins", () => {
    expect(resolveMimeType("note.md", "text/markdown")).toBe("text/markdown");
    expect(resolveMimeType("photo.png", "image/png")).toBe("image/png");
  });

  // The regression: Windows reports no MIME for .md, so the raw "" failed the allow-list check
  // even though text/markdown is allow-listed. Both upload surfaces depend on this fallback.
  test("falls back to the extension when the browser gives none", () => {
    expect(resolveMimeType("business-profile.md", "")).toBe("text/markdown");
    expect(resolveMimeType("notes.markdown", "")).toBe("text/markdown");
    expect(resolveMimeType("data.csv", "")).toBe("text/csv");
    expect(resolveMimeType("plain.TXT", "")).toBe("text/plain");
  });

  test("an untyped .md resolves to something the allow-list actually accepts", () => {
    expect(MIME_ALLOWLIST.has(resolveMimeType("business-profile.md", ""))).toBe(true);
  });

  test("an unknown extension stays opaque rather than guessing something allow-listed", () => {
    expect(resolveMimeType("archive.xyz", "")).toBe("application/octet-stream");
    expect(resolveMimeType("noextension", "")).toBe("application/octet-stream");
    expect(MIME_ALLOWLIST.has(resolveMimeType("archive.xyz", ""))).toBe(false);
  });
});
