import { describe, expect, it } from "vitest";
import {
  buildDocFilename,
  exceedsByteCap,
  PLAN_ATTACHMENT_CAP_BYTES,
  tokenizeMarkdown,
  toWinAnsi,
} from "./documentGen";

describe("tokenizeMarkdown", () => {
  it("splits headings, bullets, and blank-line paragraphs", () => {
    expect(tokenizeMarkdown("# T\n\n- a\n- b\n\npara")).toEqual([
      { kind: "h1", text: "T" },
      { kind: "bullet", text: "a" },
      { kind: "bullet", text: "b" },
      { kind: "para", text: "para" },
    ]);
  });

  it("supports h1/h2/h3 and joins wrapped paragraph lines with a space", () => {
    expect(tokenizeMarkdown("## Sub\n\n### Deep\n\nline one\nline two")).toEqual([
      { kind: "h2", text: "Sub" },
      { kind: "h3", text: "Deep" },
      { kind: "para", text: "line one line two" },
    ]);
  });

  it("ignores leading/trailing blank lines", () => {
    expect(tokenizeMarkdown("\n\n# Only\n\n")).toEqual([{ kind: "h1", text: "Only" }]);
  });
});

describe("toWinAnsi", () => {
  it("normalizes smart punctuation to WinAnsi-safe equivalents", () => {
    // curly quotes → straight, em/en-dash → "-", ellipsis → "...", nbsp → space
    expect(toWinAnsi("“smart” — quotes… caf é")).toBe('"smart" - quotes... caf é');
    expect(toWinAnsi("it’s – fine")).toBe("it's - fine");
  });

  it("keeps Windows-1252 accented letters (café)", () => {
    expect(toWinAnsi("café")).toBe("café");
  });

  it("drops glyphs with no WinAnsi mapping (astral emoji) rather than throwing", () => {
    expect(toWinAnsi("hi 😀 there")).toBe("hi  there");
    expect(toWinAnsi("中文x")).toBe("x");
  });
});

describe("buildDocFilename", () => {
  it("slugifies topic + date to a safe .pdf filename", () => {
    expect(buildDocFilename("Q3 Proposal!", "2026-07-13", [])).toBe("q3-proposal-2026-07-13.pdf");
  });

  it("appends -N on collision with existing filenames", () => {
    expect(buildDocFilename("Q3 Proposal!", "2026-07-13", ["q3-proposal-2026-07-13.pdf"])).toBe(
      "q3-proposal-2026-07-13-1.pdf",
    );
    expect(
      buildDocFilename("Q3 Proposal!", "2026-07-13", [
        "q3-proposal-2026-07-13.pdf",
        "q3-proposal-2026-07-13-1.pdf",
      ]),
    ).toBe("q3-proposal-2026-07-13-2.pdf");
  });

  it("falls back to 'document' when the topic slug is empty", () => {
    expect(buildDocFilename("!!!", "2026-07-13", [])).toBe("document-2026-07-13.pdf");
  });
});

describe("exceedsByteCap / PLAN_ATTACHMENT_CAP_BYTES", () => {
  it("caps at 8 MiB", () => {
    expect(PLAN_ATTACHMENT_CAP_BYTES).toBe(8 * 1024 * 1024);
    expect(exceedsByteCap(PLAN_ATTACHMENT_CAP_BYTES, PLAN_ATTACHMENT_CAP_BYTES)).toBe(false);
    expect(exceedsByteCap(PLAN_ATTACHMENT_CAP_BYTES + 1, PLAN_ATTACHMENT_CAP_BYTES)).toBe(true);
  });
});
