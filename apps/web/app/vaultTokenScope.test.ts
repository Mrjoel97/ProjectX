// Regression guard for a bug that was invisible in every automated check we had (ACTN/vault).
//
// `--vault-*` custom properties used to be defined inside `.vault-nord-edge`. `PreviewModal` lives
// in the vault directory but is RENDERED from `workspace/cards.tsx` and `pipeline/ImportPanel.tsx`,
// neither of which is inside that class — so every `var(--vault-…)` there resolved to nothing, the
// dialog went transparent, and its right-hand `<aside>` disappeared against the dark scrim.
//
// WHAT MAKES THIS CLASS NASTY: custom properties fail SILENTLY to `initial`. No error, no console
// warning, no failing test — the pane just isn't there. Nothing but a human looking at the right
// surface would catch it, and the LEFT pane kept working (it sets a global token inline), so it
// read as "half broken" rather than "broken".
//
// This is deliberately a SOURCE-SHAPE guard, not a behaviour test, and the distinction matters:
// it cannot prove the modal renders correctly — only a browser can, and that check belongs in the
// E2E. What it CAN do is fail the moment someone re-scopes these tokens under a selector, which is
// the exact regression that produced the bug. Scoped tokens + a cross-surface consumer = invisible
// UI, every time.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const CSS = readFileSync(join(__dirname, "globals.css"), "utf8");

/**
 * Every `--vault-*` DEFINITION (a declaration, not a `var()` reference) paired with the selector
 * block it sits in. Naive but sufficient: definitions are `--name:` at a line start, and the
 * nearest preceding line ending in `{` names the block.
 */
function vaultTokenDefinitions(): { token: string; selector: string }[] {
  const lines = CSS.split(/\r?\n/);
  const out: { token: string; selector: string }[] = [];
  let selector = "(none)";
  for (const line of lines) {
    const open = line.match(/^\s*([^{}]+?)\s*\{\s*$/);
    if (open) selector = open[1].trim();
    const def = line.match(/^\s*(--vault-[a-z-]+)\s*:/);
    if (def) out.push({ token: def[1], selector });
  }
  return out;
}

describe("--vault-* token scope", () => {
  test("every vault token is defined at :root, never inside a scoped selector", () => {
    const defs = vaultTokenDefinitions();
    // Sanity: if the tokens were renamed or deleted the assertion below would pass vacuously.
    expect(defs.length).toBeGreaterThan(5);

    const scoped = defs.filter((d) => d.selector !== ":root");
    expect(
      scoped,
      `these vault tokens are scoped and will resolve to NOTHING for any consumer rendered ` +
        `outside that selector — PreviewModal is rendered from workspace/ and pipeline/: ` +
        JSON.stringify(scoped),
    ).toEqual([]);
  });

  test("the two tokens PreviewModal itself paints with are among them", () => {
    // Named explicitly: these are the two whose absence made the dialog transparent. If a refactor
    // renames them, this fails loudly rather than leaving the guard above passing over nothing.
    const tokens = vaultTokenDefinitions().map((d) => d.token);
    expect(tokens).toContain("--vault-paper");
    expect(tokens).toContain("--vault-border");
  });

  test("the danger tokens PreviewControls needs are global too", () => {
    // Not cosmetic: a destructive control that silently loses its danger styling looks like an
    // ordinary one. PreviewControls renders inside PreviewModal, so it shares its scope problem.
    const tokens = vaultTokenDefinitions().map((d) => d.token);
    expect(tokens).toContain("--vault-danger");
    expect(tokens).toContain("--vault-danger-bg");
  });
});
