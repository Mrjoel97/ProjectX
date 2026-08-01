import { describe, expect, it } from "vitest";
import {
  buildDocFilename,
  exceedsByteCap,
  formatSpec,
  inlineRuns,
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

  it("clamps h4-h6 to h3 and accepts `* ` bullets", () => {
    expect(tokenizeMarkdown("#### Deep\n\n* star bullet")).toEqual([
      { kind: "h3", text: "Deep" },
      { kind: "bullet", text: "star bullet" },
    ]);
  });

  it("parses numbered list items with their number", () => {
    expect(tokenizeMarkdown("1. first\n2. second")).toEqual([
      { kind: "ordered", text: "first", num: 1 },
      { kind: "ordered", text: "second", num: 2 },
    ]);
  });

  it("parses a GitHub pipe table (header + divider + rows)", () => {
    const md = "| Item | Detail |\n|------|--------|\n| a | 1 |\n| b | 2 |";
    expect(tokenizeMarkdown(md)).toEqual([
      {
        kind: "table",
        header: ["Item", "Detail"],
        rows: [
          ["a", "1"],
          ["b", "2"],
        ],
      },
    ]);
  });
});

describe("inlineRuns", () => {
  it("splits **bold** into bold runs and strips the markers", () => {
    expect(inlineRuns("plain **loud** tail")).toEqual([
      { text: "plain ", bold: false },
      { text: "loud", bold: true },
      { text: " tail", bold: false },
    ]);
  });

  it("strips stray inline markers so the page never shows raw * or backticks", () => {
    // a lone `*` and a `code` span leave no literal syntax behind
    const runs = inlineRuns("a *stray star and `code` here");
    const rendered = runs.map((r) => r.text).join("");
    expect(rendered).not.toMatch(/[*`]/);
    expect(rendered).toBe("a stray star and code here");
  });

  it("handles __bold__ and drops empty runs", () => {
    expect(inlineRuns("__x__")).toEqual([{ text: "x", bold: true }]);
    expect(inlineRuns("**")).toEqual([]);
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

  // SC4b: the 3-arg call sites above are byte-identical in behaviour; SC4: a second format is
  // reachable by naming it, and collision suffixing follows the format rather than the .pdf literal.
  it("takes the extension from the format, defaulting to pdf", () => {
    expect(buildDocFilename("Q3 plan", "2026-08-01")).toBe("q3-plan-2026-08-01.pdf");
    expect(buildDocFilename("Q3 plan", "2026-08-01", [], "html")).toBe("q3-plan-2026-08-01.html");
  });

  it("suffixes collisions per-format", () => {
    expect(
      buildDocFilename("Q3 plan", "2026-08-01", ["q3-plan-2026-08-01.html"], "html"),
    ).toBe("q3-plan-2026-08-01-1.html");
    // a .pdf already taken does not push the .html name along, and vice versa
    expect(buildDocFilename("Q3 plan", "2026-08-01", ["q3-plan-2026-08-01.pdf"], "html")).toBe(
      "q3-plan-2026-08-01.html",
    );
  });
});

describe("formatSpec", () => {
  it("is the one place the extension + MIME literals are written", () => {
    expect(formatSpec("pdf")).toEqual({ ext: "pdf", mimeType: "application/pdf" });
    expect(formatSpec("html")).toEqual({ ext: "html", mimeType: "text/html" });
  });
});

describe("exceedsByteCap / PLAN_ATTACHMENT_CAP_BYTES", () => {
  it("caps at 8 MiB", () => {
    expect(PLAN_ATTACHMENT_CAP_BYTES).toBe(8 * 1024 * 1024);
    expect(exceedsByteCap(PLAN_ATTACHMENT_CAP_BYTES, PLAN_ATTACHMENT_CAP_BYTES)).toBe(false);
    expect(exceedsByteCap(PLAN_ATTACHMENT_CAP_BYTES + 1, PLAN_ATTACHMENT_CAP_BYTES)).toBe(true);
  });
});
