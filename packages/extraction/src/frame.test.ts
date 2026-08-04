import { describe, expect, it } from "vitest";
import { frameForConversation } from "./frame";

describe("frameForConversation — attachment kinds (image/pdf/document)", () => {
  it("pdf: names the file and presents its content", () => {
    const out = frameForConversation("pdf", "q3-report.pdf", "Revenue grew 12% in Q3.");
    expect(out).toContain("q3-report.pdf");
    expect(out).toContain("Revenue grew 12% in Q3.");
  });

  it("image: names the file and presents its content", () => {
    const out = frameForConversation(
      "image",
      "whiteboard.png",
      "Sprint plan: ship auth by Friday.",
    );
    expect(out).toContain("whiteboard.png");
    expect(out).toContain("Sprint plan: ship auth by Friday.");
  });

  it("document: names the file and presents its content", () => {
    const out = frameForConversation("document", "notes.txt", "Meeting notes: budget approved.");
    expect(out).toContain("notes.txt");
    expect(out).toContain("Meeting notes: budget approved.");
  });
});

describe("frameForConversation — audio/dictation", () => {
  it("passes the transcript through VERBATIM — no attached-file wrapper", () => {
    const transcript = "Send the Q3 report to Bob and ask him to review it by Friday.";
    const out = frameForConversation("audio", "dictation.webm", transcript);
    expect(out).toBe(transcript);
  });

  it("does not mention the filename for dictation", () => {
    const out = frameForConversation("audio", "dictation.webm", "Draft an email to Sarah.");
    expect(out).not.toContain("dictation.webm");
  });
});

describe("frameForConversation — never leaks raw bytes/storageId", () => {
  it("output contains only the provided safeText content, no extra binary-looking markers", () => {
    const out = frameForConversation("pdf", "file.pdf", "safe content only");
    expect(out).not.toMatch(/storageId|0x[0-9a-f]{2}/i);
  });
});
