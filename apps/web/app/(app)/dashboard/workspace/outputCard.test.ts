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

// ── Phase 40 (DOC-01): the inline PDF, and the ONE URL it is allowed to mint ─────────────────────
//
// The storage URL is a durable bearer capability (Convex `getUrl` has no expiry), so WHERE it is
// minted is a security property, not a rendering detail. The owner's rule for an inline document:
// the selected created artifact of the OPEN thread, and nothing else. A source scan is the right
// shape here for the same reason contentView.test.ts uses one for the shelf — it forbids the
// FAILURE (a URL for a row nobody is viewing) rather than the feature.
describe("the inline PDF mints exactly one URL, for the open thread's selected artifact", () => {
  const cards = readFileSync(join(__dirname, "cards.tsx"), "utf8");

  test("`vaultDownloadUrl` appears exactly once in cards.tsx, inside OutputCard", () => {
    expect(cards.match(/api\.vault\.vaultDownloadUrl/g) ?? []).toHaveLength(1);
    const outputCard = cards.slice(cards.indexOf("function OutputCard("));
    expect(outputCard.slice(0, 2000)).toMatch(/api\.vault\.vaultDownloadUrl/);
  });

  test("the query is gated on BOTH the selected doc and its bytes being a PDF", () => {
    // MUTATION that turns this RED: drop either half of the gate and every created artifact in a
    // mounted card mints a URL.
    expect(cards).toMatch(/selectedId && pdfBytes \? \{ vaultDocId: selectedId \} : "skip"/);
    expect(cards).toMatch(/artifact\?\.storedMimeType === "application\/pdf"/);
  });

  test("the frame is the browser's own viewer — no sandbox, one scroll region", () => {
    // Scan CODE, not prose: the comment above the iframe deliberately names the banned `sandbox`
    // attribute so the next reader knows why it is absent, and a naive scan matches that comment
    // and goes red on a correct file (the xlsText lesson, one package over).
    const code = cards.replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, "");
    const frame = code.slice(code.indexOf('data-testid="output-pdf"') - 200, undefined);
    expect(frame.slice(0, 600)).toMatch(/style=\{\{/);
    expect(frame.slice(0, 600)).not.toMatch(/sandbox/); // ADR-036: a sandbox frames nothing
    expect(frame.slice(0, 600)).toMatch(/min\(70vh, 32rem\)/);
    expect(code).toMatch(/<iframe/);
  });
});
