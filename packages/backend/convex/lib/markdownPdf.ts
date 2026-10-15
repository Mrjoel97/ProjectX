import { type InlineRun, inlineRuns, tokenizeMarkdown, toWinAnsi } from "@pikar/core";
import { type Color, PDFDocument, type PDFFont, rgb, StandardFonts } from "pdf-lib";

// ── Pure-JS PDF renderer (CKPT-02, V1 + V2) ──────────────────────────────────
// markdownToPdf turns the drafter's simple markdown into a deterministic PDF using ONLY pdf-lib
// Standard-14 fonts (Helvetica family) — NEVER embedFont(ttf), which pulls fontkit and inlines
// TTF bytes, breaking the Convex bundle. This dependency-only helper has no Convex endpoints.
// Every drawn string passes through toWinAnsi so drawText can never throw on smart punctuation / astral
// glyphs (V2). CreationDate/ModDate are pinned to the epoch → byte-identical output (V1). The
// whole render is wrapped so ANY throw becomes a rejection — never a partial/empty PDF.
// ponytail: line-based renderer over Standard-14; add marked/fontkit only if rich markdown or
// embedded fonts land.

const PAGE_W = 612; // US-Letter, points
const PAGE_H = 792;
const MARGIN = 64;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const LEADING = 1.42;

// A restrained, professional palette (deterministic — no theme input, so bytes stay reproducible).
const INK = rgb(0.13, 0.15, 0.18); // body text, near-black
const ACCENT = rgb(0.09, 0.33, 0.45); // headings, rules, list markers — deep teal
const RULE = rgb(0.82, 0.85, 0.87); // hairline section + table borders
const TH_BG = rgb(0.93, 0.96, 0.97); // table header fill

// Point size per block kind (headings bold + accent; body/list regular ink).
const SIZE: Record<string, number> = {
  h1: 16,
  h2: 13.5,
  h3: 11.5,
  para: 10.5,
  bullet: 10.5,
  ordered: 10.5,
};
const TABLE_SIZE = 9.5;

// One laid-out word carrying the font it renders in (regular vs bold), for run-aware wrapping.
type Word = { text: string; font: PDFFont };

// Greedy word-wrap for a single already-sanitized string at one font/size (used for table cells).
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (cur === "" || font.widthOfTextAtSize(trial, size) <= maxWidth) cur = trial;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  lines.push(cur);
  return lines;
}

// Wrap styled inline runs into lines of (word,font) segments so bold survives word-wrap. Each run's
// text is sanitized (toWinAnsi) and split into words; words carry their run's font.
function layoutRuns(
  runs: InlineRun[],
  regular: PDFFont,
  bold: PDFFont,
  size: number,
  maxWidth: number,
): Word[][] {
  const words: Word[] = [];
  for (const run of runs) {
    const font = run.bold ? bold : regular;
    for (const w of toWinAnsi(run.text)
      .split(/\s+/)
      .filter((x) => x.length > 0))
      words.push({ text: w, font });
  }
  if (words.length === 0) return [[]];
  const space = regular.widthOfTextAtSize(" ", size);
  const lines: Word[][] = [];
  let cur: Word[] = [];
  let width = 0;
  for (const word of words) {
    const ww = word.font.widthOfTextAtSize(word.text, size);
    const add = cur.length === 0 ? ww : space + ww;
    if (cur.length > 0 && width + add > maxWidth) {
      lines.push(cur);
      cur = [word];
      width = ww;
    } else {
      cur.push(word);
      width += add;
    }
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}

export async function markdownToPdf(title: string, markdown: string): Promise<Uint8Array> {
  try {
    const doc = await PDFDocument.create();
    // Metadata: title feeds the human-facing document name; pin the dates for deterministic bytes.
    doc.setTitle(toWinAnsi(title));
    doc.setCreationDate(new Date(0));
    doc.setModificationDate(new Date(0));

    const body = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;
    const space = (h: number) => {
      if (y - h < MARGIN) {
        page = doc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
      }
    };

    // Draw a block of inline runs with optional list marker (a filled square bullet drawn as a
    // shape — no glyph-encoding dependency — or a bold accent number). Wrapped lines hang-indent
    // under the text, not the marker.
    const drawBlock = (
      runs: InlineRun[],
      size: number,
      opts: {
        indent?: number;
        textIndent?: number;
        color?: Color;
        baseFont?: PDFFont;
        numberMarker?: string;
        dotMarker?: boolean;
      } = {},
    ) => {
      const indent = opts.indent ?? 0;
      const textIndent = opts.textIndent ?? indent;
      const color = opts.color ?? INK;
      const sp = body.widthOfTextAtSize(" ", size);
      const lines = layoutRuns(runs, opts.baseFont ?? body, bold, size, CONTENT_W - textIndent);
      const lh = size * LEADING;
      lines.forEach((line, li) => {
        space(lh);
        const baseline = y - size;
        if (li === 0 && opts.dotMarker)
          page.drawRectangle({
            x: MARGIN + indent,
            y: baseline + size * 0.28,
            width: 3,
            height: 3,
            color: ACCENT,
          });
        if (li === 0 && opts.numberMarker)
          page.drawText(opts.numberMarker, {
            x: MARGIN + indent,
            y: baseline,
            size,
            font: bold,
            color: ACCENT,
          });
        let x = MARGIN + textIndent;
        for (const word of line) {
          page.drawText(word.text, { x, y: baseline, size, font: word.font, color });
          x += word.font.widthOfTextAtSize(word.text, size) + sp;
        }
        y -= lh;
      });
    };

    // A GitHub-style table: header row filled + bold, body rows with hairline column/row borders.
    const drawTable = (header: string[], rows: string[][]) => {
      const cols = Math.max(header.length, ...rows.map((r) => r.length), 1);
      const colW = CONTENT_W / cols;
      const pad = 5;
      const rowOf = (cells: string[], isHeader: boolean) => {
        const wrapped = Array.from({ length: cols }, (_, c) =>
          wrapText(toWinAnsi(cells[c] ?? ""), isHeader ? bold : body, TABLE_SIZE, colW - 2 * pad),
        );
        const h = Math.max(1, ...wrapped.map((l) => l.length)) * (TABLE_SIZE * 1.3) + 2 * pad;
        space(h);
        const top = y;
        if (isHeader)
          page.drawRectangle({ x: MARGIN, y: top - h, width: CONTENT_W, height: h, color: TH_BG });
        wrapped.forEach((cellLines, c) => {
          let cy = top - pad - TABLE_SIZE;
          for (const ln of cellLines) {
            page.drawText(ln, {
              x: MARGIN + c * colW + pad,
              y: cy,
              size: TABLE_SIZE,
              font: isHeader ? bold : body,
              color: INK,
            });
            cy -= TABLE_SIZE * 1.3;
          }
        });
        page.drawRectangle({
          x: MARGIN,
          y: top - h,
          width: CONTENT_W,
          height: h,
          borderColor: RULE,
          borderWidth: 0.6,
        });
        for (let c = 1; c < cols; c++)
          page.drawLine({
            start: { x: MARGIN + c * colW, y: top },
            end: { x: MARGIN + c * colW, y: top - h },
            thickness: 0.6,
            color: RULE,
          });
        y = top - h;
      };
      y -= 6;
      rowOf(header, true);
      for (const r of rows) rowOf(r, false);
      y -= 8;
    };

    // Title block: the document title in bold accent + a hairline rule beneath.
    {
      const tsize = 21;
      for (const line of wrapText(toWinAnsi(title), bold, tsize, CONTENT_W)) {
        space(tsize * 1.2);
        page.drawText(line, { x: MARGIN, y: y - tsize, size: tsize, font: bold, color: ACCENT });
        y -= tsize * 1.2;
      }
      y -= 5;
      space(2);
      page.drawRectangle({ x: MARGIN, y, width: CONTENT_W, height: 1.5, color: ACCENT });
      y -= 16;
    }

    for (const tok of tokenizeMarkdown(markdown)) {
      if (tok.kind === "table") {
        drawTable(tok.header, tok.rows);
        continue;
      }
      if (tok.kind === "h1" || tok.kind === "h2" || tok.kind === "h3") {
        const size = SIZE[tok.kind]!;
        y -= size * 0.5; // breathing room before a heading
        drawBlock(inlineRuns(tok.text), size, { color: ACCENT, baseFont: bold });
        if (tok.kind !== "h3") {
          y -= 2;
          space(2);
          page.drawRectangle({ x: MARGIN, y, width: CONTENT_W, height: 0.6, color: RULE });
          y -= 6;
        } else {
          y -= 2;
        }
        continue;
      }
      const size = SIZE[tok.kind] ?? 10.5;
      y -= size * (LEADING - 1) * 0.6; // small gap before the block
      if (tok.kind === "bullet") {
        drawBlock(inlineRuns(tok.text), size, { indent: 6, textIndent: 20, dotMarker: true });
      } else if (tok.kind === "ordered") {
        drawBlock(inlineRuns(tok.text), size, {
          indent: 4,
          textIndent: 22,
          numberMarker: `${tok.num}.`,
        });
      } else {
        drawBlock(inlineRuns(tok.text), size, {});
      }
    }

    return await doc.save();
  } catch (e) {
    // Render failure blocks approval — surface it, never return a partial/empty PDF (CONTEXT).
    throw new Error(`markdownToPdf: render failed (${(e as Error)?.name ?? "unknown"})`);
  }
}
