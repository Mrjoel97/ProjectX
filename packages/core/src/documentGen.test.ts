import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildDocFilename,
  exceedsByteCap,
  formatForMime,
  formatSpec,
  inlineRuns,
  markdownToSheets,
  PLAN_ATTACHMENT_CAP_BYTES,
  renderHtmlDocument,
  tokenizeMarkdown,
  toWinAnsi,
  XLSX_MIME,
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
    expect(buildDocFilename("Q3 plan", "2026-08-01", ["q3-plan-2026-08-01.html"], "html")).toBe(
      "q3-plan-2026-08-01-1.html",
    );
    // a .pdf already taken does not push the .html name along, and vice versa
    expect(buildDocFilename("Q3 plan", "2026-08-01", ["q3-plan-2026-08-01.pdf"], "html")).toBe(
      "q3-plan-2026-08-01.html",
    );
  });
});

describe("formatSpec", () => {
  // Phase 40 (DOC-01) widened this from {pdf, html} to the three-entry set. ADR-036 fixes it as
  // CLOSED: a DOCX/PPTX member is a decision this repo has made against, not a gap.
  it("is the one place the extension + MIME literals are written", () => {
    expect(formatSpec("pdf")).toEqual({ ext: "pdf", mimeType: "application/pdf" });
    expect(formatSpec("html")).toEqual({ ext: "html", mimeType: "text/html" });
    expect(formatSpec("xlsx")).toEqual({ ext: "xlsx", mimeType: XLSX_MIME });
    expect(XLSX_MIME).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  // Why this exists: `regenerateAttachment` had no format argument, so regenerating an html
  // attachment silently produced a PDF. It now recovers the format from the stored MIME.
  it("formatForMime round-trips every format and refuses a foreign MIME", () => {
    for (const f of ["pdf", "html", "xlsx"] as const) {
      expect(formatForMime(formatSpec(f).mimeType)).toBe(f);
    }
    expect(formatForMime("text/plain")).toBeNull();
    expect(formatForMime("application/vnd.ms-excel")).toBeNull(); // legacy .xls is not an output
  });
});

describe("markdownToSheets", () => {
  it("makes one sheet per table, named from the heading above it, header row first", () => {
    const md = [
      "# Price book",
      "",
      "## Prices",
      "",
      "| Item | Unit price (USD) | Notes |",
      "| --- | --- | --- |",
      "| Setup | 500 | one-off |",
      "| Monthly | 120 | per seat |",
      "",
      "## Schedule",
      "",
      "| Week | Milestone |",
      "| --- | --- |",
      "| 1 | Kickoff |",
    ].join("\n");

    expect(markdownToSheets(md)).toEqual([
      {
        name: "Prices",
        rows: [
          ["Item", "Unit price (USD)", "Notes"],
          ["Setup", "500", "one-off"],
          ["Monthly", "120", "per seat"],
        ],
      },
      {
        name: "Schedule",
        rows: [
          ["Week", "Milestone"],
          ["1", "Kickoff"],
        ],
      },
    ]);
  });

  it("names a table with no heading above it by position, and never reuses one heading twice", () => {
    const bare = markdownToSheets("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(bare).toEqual([
      {
        name: "Sheet 1",
        rows: [
          ["A", "B"],
          ["1", "2"],
        ],
      },
    ]);

    // Two tables under ONE heading: the first takes the title, the second falls back to its
    // position rather than shipping two sheets with the same name.
    const twin = markdownToSheets("## Prices\n\n| A |\n| --- |\n| 1 |\n\n| B |\n| --- |\n| 2 |");
    expect(twin.map((s) => s.name)).toEqual(["Prices", "Sheet 2"]);
  });

  it("returns nothing when the draft has no table — the caller refuses instead of sending an empty book", () => {
    expect(markdownToSheets("# Just prose\n\nNo table here at all.")).toEqual([]);
    expect(markdownToSheets("")).toEqual([]);
  });
});

describe("renderHtmlDocument", () => {
  it("emits a self-contained page titled from the caller's title", () => {
    const html = renderHtmlDocument("T", "# H\n\npara");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>T</title>");
  });

  // (a) BEHAVIOURAL — hostile model prose renders as TEXT in every token slot.
  it("renders hostile model prose as text, never as markup", () => {
    const X = `<script>alert(1)</script><img src=x onerror="alert(1)">`;
    const md = `# ${X}\n\n${X}\n\n- ${X}\n\n1. ${X}\n\n| ${X} |\n|---|\n| ${X} |`;
    const html = renderHtmlDocument(X, md);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    // `onerror` survives as INERT TEXT (`onerror=&quot;`) and must — escaping it away would mangle
    // visible prose. What must never survive is the quote that would make it an attribute.
    expect(html).not.toMatch(/onerror\s*=\s*["']/i);
    // THE LOAD-BEARING ONE: strip the code-owned tag literals and no angle bracket may remain, so
    // every `<` in the output is provably one this file wrote — not one the model did.
    const CODE_OWNED_TAG =
      /<!doctype html>|<html lang="en">|<meta charset="utf-8">|<ol start="\d+">|<\/?(?:html|head|title|style|body|h1|h2|h3|p|ul|ol|li|strong|table|thead|tbody|tr|th|td)>/g;
    expect(html.replace(CODE_OWNED_TAG, "")).not.toContain("<");
    // Non-vacuity floor (house rule): prove the hostile string REACHED every slot, escaped —
    // title + h1 + para + bullet + ordered + table-header + table-cell.
    expect((html.match(/&lt;script&gt;/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });

  // (b) STRUCTURAL — "enforced by a TEST, not by prompt instruction". A future edit that
  // interpolates a raw model string into markup fails here even if it happens to be harmless today.
  it("no model-authored string reaches markup: every interpolation in renderHtmlDocument is escaped", () => {
    // CRLF-normalized: core.autocrlf=true means a fresh checkout has \r\n and the `\n}\n` anchor
    // would silently miss, slicing the rest of the file instead of the function body.
    const src = readFileSync(new URL("./documentGen.ts", import.meta.url), "utf8").replace(
      /\r\n/g,
      "\n",
    );
    const start = src.indexOf("export function renderHtmlDocument(");
    expect(start).toBeGreaterThan(-1); // anchor floor
    const end = src.indexOf("\n}\n", start);
    expect(end).toBeGreaterThan(start); // the body really was delimited
    const body = src.slice(start, end);
    const interps = [...body.matchAll(/\$\{([^{}]*)\}/g)].map((m) => m[1]!.trim());
    expect(interps.length).toBeGreaterThanOrEqual(4); // non-vacuity floor
    const raw = interps.filter(
      (x) => !/^esc\(/.test(x) && !/Html$/.test(x) && !/^HTML_[A-Z]+$/.test(x),
    );
    expect(
      raw,
      `raw interpolations in renderHtmlDocument (escape them or name them *Html): ${raw.join(", ")}`,
    ).toEqual([]);
  });
});

describe("exceedsByteCap / PLAN_ATTACHMENT_CAP_BYTES", () => {
  it("caps at 8 MiB", () => {
    expect(PLAN_ATTACHMENT_CAP_BYTES).toBe(8 * 1024 * 1024);
    expect(exceedsByteCap(PLAN_ATTACHMENT_CAP_BYTES, PLAN_ATTACHMENT_CAP_BYTES)).toBe(false);
    expect(exceedsByteCap(PLAN_ATTACHMENT_CAP_BYTES + 1, PLAN_ATTACHMENT_CAP_BYTES)).toBe(true);
  });
});
