import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { previewIndex } from "./cards";

// The defect this file exists for, in the user's words: "Okay, where is the slide deck? I want you
// to open it in the workspace so that I can see it." The deck WAS in the workspace — the Output
// card was previewing document #1 while the newest one sat unrendered behind a click nobody knew
// to make.

describe("OutputCard preview selection", () => {
  test("with no explicit click it follows the NEWEST artifact", () => {
    // The whole defect in one line: three documents, and the card used to show index 0.
    expect(previewIndex(3, null)).toBe(2);
    expect(previewIndex(1, null)).toBe(0);
  });

  test("it KEEPS following as the conversation creates more", () => {
    // `docIds` accumulates over the thread, so the default has to move with it. A `useState(0)`
    // initialiser cannot: it is evaluated once and never reconciled against a growing row.
    expect([1, 2, 3, 4].map((count) => previewIndex(count, null))).toEqual([0, 1, 2, 3]);
  });

  test("an explicit click WINS over the newest — the user is not overridden", () => {
    expect(previewIndex(3, 0)).toBe(0);
    expect(previewIndex(3, 1)).toBe(1);
  });

  test("a stale click falls back to the newest rather than blanking the preview", () => {
    // A `replace` can shrink the row out from under a pick made before it.
    expect(previewIndex(2, 5)).toBe(1);
    expect(previewIndex(2, -1)).toBe(1);
  });

  test("an empty row is index 0, not -1 — nothing indexes past the end", () => {
    expect(previewIndex(0, null)).toBe(0);
    expect(previewIndex(0, 3)).toBe(0);
  });
});

// ── The two agent-facing sentences, checked at the SOURCE ────────────────────────────────────────
//
// These are strings the model reads, so the only thing a test can assert about them is that they
// are still there and still say the two things they exist to say. Behaviour coverage lives in the
// eval fixtures, which cost money to run; this is the free half.

const llm = readFileSync(
  join(__dirname, "../../../../../../packages/backend/convex/llm.ts"),
  "utf8",
);

describe("createDocument tells the model WHERE the artifact is and WHAT it is", () => {
  test("the success sentence names the workspace", () => {
    // Observed live: asked to open the deck in the workspace, the agent said it could not. It
    // cannot open anything — the Output card already renders it, and nothing told the model so.
    expect(llm).toContain("already open in the workspace");
  });

  test("the success sentence names the REAL format", () => {
    // Observed live: the agent reported creating the deck "in PowerPoint format". There is no
    // format argument on the tool and DocFormat is `pdf | html`.
    expect(llm).toContain("Written as markdown, with a PDF to download.");
    expect(llm).toContain("never PowerPoint, Word or slides");
  });

  test("the blocked-draft refusal names resetPlan instead of deadlocking on the user", () => {
    // Observed live: "finish or discard that first" → the user answered "im ready, proceed", which
    // is not a discard, and the turn deadlocked with `resetPlan` unused in the model's own toolbox.
    expect(llm).toContain("call `resetPlan` and then try again");
  });
});
