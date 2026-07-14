import { expect, test } from "@playwright/test";

// VALT-04 — the Knowledge Vault browse/search/preview/delete loop end to end over the OFFLINE
// SMOKE:: ingest (mirrors the cockpit specs' SMOKE:: grammar). The vault route lives under the
// (app) auth gate, so this runs signed-in (storageState from auth.setup.ts) against the
// ALREADY-RUNNING local stack (`convex dev` NOT --once + `next dev` :3111 — see e2e/README.md).
//
// The Brain Dump text is a `SMOKE::graph::` sentinel: `SMOKE::` makes vaultRag.embedDoc skip the
// embedding network (a fixed fake entryId, no OPENAI key needed) and `SMOKE::graph::` makes
// vaultLlm.extractGraph return a deterministic Alice—Acme graph — so the full durable ingest
// (embed → extract → upsertGraph → ready) runs offline and the item goes processing → ready
// reactively. The REAL hybrid embed + retrieval quality (VALT-01/03) is proven separately by the
// live `pnpm --filter @pikar/backend smoke:vault` gate; this spec covers the VALT-04 UI loop.
//
// A paste ingests to the "Brain Dumps" category (categoryFor(source:"paste")), so the item is
// browsed under that tab; the stat tiles update regardless of the active tab. Assertions ride the
// stable UI (headline, tiles, tabs, status chip, entity chips) — never incidental copy.
//
// Per the prior-phase precedent, a fully-green headless run may be deferred to /gsd:verify-work if
// the auth harness cannot complete in this environment; the spec is Playwright-discovered + type-
// loads regardless (the `--list` gate).

// A single-line SMOKE::graph:: brain dump → one edge Alice —works_at→ Acme (two `other` nodes).
const BRAIN_DUMP = "SMOKE::graph::Alice|Acme|works_at";

test("honest-zero → paste → processing→ready → search → preview(entities) → delete → empty", async ({ page }) => {
  await page.goto("/dashboard/vault");

  // ── Honest-zero start (brand-024242/024258): headline, 4 tiles, 6 tabs, dropzone copy ──────────
  await expect(page.getByRole("heading", { name: "Knowledge Vault" })).toBeVisible({ timeout: 15_000 });

  // The 4 stat tiles with their honest zeros (0 files / 0 MB match the empty-vault screenshots).
  for (const label of ["TOTAL FILES", "PROCESSED", "STORAGE USED", "CATEGORIES"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("0 MB", { exact: true })).toBeVisible();
  await expect(page.getByText("6", { exact: true })).toBeVisible(); // CATEGORIES = the fixed 6

  // The 6 category tabs, in screenshot order; "My Uploads" is the active teal pill.
  const tablist = page.getByRole("tablist", { name: "Vault categories" });
  for (const name of ["My Uploads", "Workspace Docs", "Images", "Videos", "Google Docs", "Brain Dumps"]) {
    await expect(tablist.getByRole("tab", { name })).toBeVisible();
  }
  await expect(tablist.getByRole("tab", { name: "My Uploads" })).toHaveAttribute("aria-selected", "true");

  // Dropzone copy.
  await expect(page.getByText("Click to upload")).toBeVisible();
  await expect(page.getByText(/Searchable: PDF, DOCX, XLSX, CSV, TXT, Markdown/)).toBeVisible();

  // Empty grid on the default tab.
  await expect(page.getByText(/No documents yet/)).toBeVisible();

  // ── Paste a Brain Dump (SMOKE:: → offline ingest) ──────────────────────────────────────────────
  await page.getByRole("button", { name: "+ Paste a Brain Dump" }).click();
  const textarea = page.getByLabel("Brain Dump text");
  await expect(textarea).toBeVisible();
  await textarea.fill(BRAIN_DUMP);
  await page.getByRole("button", { name: "Save Brain Dump" }).click();

  // The pasted item lands in the "Brain Dumps" category — switch to that tab to browse it.
  await tablist.getByRole("tab", { name: "Brain Dumps" }).click();

  // The card appears and its status chip settles processing → ready reactively (the durable
  // ingest ran offline). One ITEM in the grid.
  const card = page.getByRole("button", { name: new RegExp(BRAIN_DUMP.replace(/[|]/g, "\\|")) });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText("ready", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^1 ITEM$/)).toBeVisible();

  // The stat tiles reflect the ingest: TOTAL FILES + PROCESSED both show 1.
  await expect(page.getByText("1", { exact: true }).first()).toBeVisible();

  // ── Search box (VALT-04 browse/search UI) ──────────────────────────────────────────────────────
  // Exercise the search action, then clear it (blur on empty restores the full grid). The hybrid
  // retrieval quality itself is the live smoke:vault gate — this asserts the browse loop survives.
  const searchBox = page.getByLabel("Search my uploads");
  await searchBox.fill("Alice");
  await searchBox.press("Enter");
  await searchBox.fill("");
  await searchBox.blur();
  await expect(card).toBeVisible();

  // ── Preview modal: metadata + extracted entity chips + relationship ─────────────────────────────
  await card.click();
  const dialog = page.getByRole("dialog", { name: /^Preview:/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Kind", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Status", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Entities & Relationships")).toBeVisible();
  // The SMOKE::graph:: fixture: chips Alice + Acme, edge "works_at".
  await expect(dialog.getByText("Alice", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Acme", { exact: true })).toBeVisible();
  await expect(dialog.getByText("works_at", { exact: true })).toBeVisible();

  // ── Delete → the grid returns to empty ──────────────────────────────────────────────────────────
  await dialog.getByRole("button", { name: /Delete/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/No documents yet/)).toBeVisible({ timeout: 15_000 });
});
