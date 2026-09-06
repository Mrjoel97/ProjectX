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

// The three tests share ONE tenant's vault and the first asserts it is EMPTY, so declaration order
// is load-bearing. `fullyParallel: true` (playwright.config.ts) does not promise it even at one
// worker — measured 2026-09-06: an upload test's document was on the page when honest-zero began.
test.describe.configure({ mode: "serial" });

test("honest-zero → paste → processing→ready → search → preview(entities) → delete → empty", async ({
  page,
}) => {
  await page.goto("/dashboard/vault");

  // ── Honest-zero start (brand-024242/024258): headline, 4 tiles, 6 tabs, dropzone copy ──────────
  await expect(page.getByRole("heading", { name: "Knowledge Vault" })).toBeVisible({
    timeout: 15_000,
  });

  // The 4 stat tiles with their honest zeros (0 files / 0 MB match the empty-vault screenshots).
  for (const label of ["TOTAL FILES", "PROCESSED", "STORAGE USED", "CATEGORIES"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  // NOT "0 MB" / "0 files" any more: since Phase 11 the tenant's business profile is itself a vault
  // document (kind `business_profile`, category workspace-docs), so an onboarded tenant's vault is
  // never byte-empty. The zero this test can honestly assert is the default CATEGORY's.
  await expect(page.getByText("6", { exact: true })).toBeVisible(); // CATEGORIES = the fixed 6

  // The 6 category tabs, in screenshot order; "My Uploads" is the active teal pill.
  const tablist = page.getByRole("tablist", { name: "Vault categories" });
  for (const name of [
    "My Uploads",
    "Workspace Docs",
    "Images",
    "Videos",
    "Google Docs",
    "Brain Dumps",
  ]) {
    await expect(tablist.getByRole("tab", { name })).toBeVisible();
  }
  await expect(tablist.getByRole("tab", { name: "My Uploads" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Dropzone copy.
  await expect(page.getByText("Click to upload")).toBeVisible();
  await expect(
    page.getByText(/Searchable: PDF, DOCX, XLSX, PPTX, CSV, TXT, Markdown/),
  ).toBeVisible();

  // Empty grid on the default tab (category-empty — see the profile-document note above).
  await expect(page.getByText(/No documents in this category/)).toBeVisible();

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
  // `.first()`: the disabled "Still reading…" voice action also carries the title in its name.
  const card = page
    .getByRole("button", { name: new RegExp(BRAIN_DUMP.replace(/[|]/g, "\\|")) })
    .first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText("ready", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^1 ITEM$/)).toBeVisible();

  // (The stat tiles also count the profile document, so "1" is not asserted here — "1 ITEM" on
  // the Brain Dumps tab above is the per-category count and IS.)

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
  const dialog = page.getByRole("dialog", { name: /./ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Kind", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Status", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Entities & citations")).toBeVisible();
  // The SMOKE::graph:: fixture: chips Alice + Acme, edge "works_at".
  // The chips read "<name> <type>" now, so match inside the entities list, not by exact text.
  const entities = dialog.getByRole("list", { name: "Entities found" });
  await expect(entities.getByText("Alice").first()).toBeVisible();
  await expect(entities.getByText("Acme").first()).toBeVisible();
  await expect(dialog.getByText("works_at", { exact: true })).toBeVisible();

  // ── Delete → the grid returns to empty ──────────────────────────────────────────────────────────
  // Two-step removal since the preview controls landed: request, then confirm.
  await dialog.getByRole("button", { name: "Remove from vault" }).click();
  await dialog.getByRole("button", { name: "Yes, remove it" }).click();
  await expect(dialog).toBeHidden();
  // The grid keeps the last search term after the modal closes now, so the empty state after the
  // delete is either the category's or the search's — both mean the document is gone.
  await expect(page.getByText(/No documents in this category|No documents match/)).toBeVisible({
    timeout: 15_000,
  });
});

// ── EXTR-H — Phase 3.8: a binary upload walks pending → ready via the extraction rail ────────────
//
// The uploaded BYTES are extraction sentinels (SMOKE::extract:: / SMOKE::transcribe::), so the
// Lane-1/4 actions short-circuit with no model call, and the "extracted text" they hand the seam
// is ITSELF the SMOKE::graph:: ingest sentinel — the downstream embed (SMOKE:: bypass) + graph
// extract (deterministic fixture) run offline exactly like the paste test above. Ready status +
// the entity chips ARE the searchable proof (the doc is embedded + graphed; hybrid retrieval
// quality stays the live smoke:vault gate's job, per the header).
//
// (03.8-06: all four lanes merged — the extraction/transcription rails are real, so the walk
// asserts a clean pending → ready terminal. No stub skip-guard.)
async function extractionWalk(
  page: import("@playwright/test").Page,
  opts: { filename: string; mimeType: string; bytes: string; tab: string; entity: string },
) {
  await page.goto("/dashboard/vault");
  await expect(page.getByRole("heading", { name: "Knowledge Vault" })).toBeVisible({
    timeout: 15_000,
  });

  // Upload the sentinel bytes through the real Dropzone input (binary mime → accept-but-defer →
  // the vaultUpload hook schedules the extraction action; NO refresh from here on).
  // The FILE input, not the two folder pickers (both carry an aria-label and `webkitdirectory`);
  // since the folder-import controls landed, a bare `input[type="file"]` resolves to three elements.
  await page.locator('input[type="file"]:not([aria-label])').setInputFiles({
    name: opts.filename,
    mimeType: opts.mimeType,
    buffer: Buffer.from(opts.bytes),
  });

  const tablist = page.getByRole("tablist", { name: "Vault categories" });
  await tablist.getByRole("tab", { name: opts.tab }).click();

  // `.first()`: since the reel/preview controls landed, a disabled "Still reading your document"
  // action button also carries the filename in its accessible name; the card is the first match.
  const card = page.getByRole("button", { name: new RegExp(opts.filename) }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });

  // The pill walks reactively: pending → extracting → processing → ready (no refresh).
  const ready = card.getByText("ready", { exact: true });
  await expect(ready).toBeVisible({ timeout: 30_000 });

  // Ready without a refresh — now the preview proves the doc landed in the search planes:
  // the SMOKE::graph:: extracted text produced the deterministic entity chips.
  await card.click();
  const dialog = page.getByRole("dialog", { name: /./ });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("list", { name: "Entities found" }).getByText(opts.entity).first(),
  ).toBeVisible({ timeout: 15_000 });
  // Two-step removal since the preview controls landed: request, then confirm.
  await dialog.getByRole("button", { name: "Remove from vault" }).click();
  await dialog.getByRole("button", { name: "Yes, remove it" }).click();
  await expect(dialog).toBeHidden();
}

test("EXTR-H: a SMOKE::extract:: pdf upload walks pending → ready → searchable", async ({
  page,
}) => {
  await extractionWalk(page, {
    filename: "smoke-extract.pdf",
    mimeType: "application/pdf",
    bytes: "SMOKE::extract::SMOKE::graph::Alice|Acme|works_at",
    tab: "My Uploads",
    entity: "Alice",
  });
});

test("EXTR-H: a SMOKE::transcribe:: mp4 upload walks pending → ready → searchable", async ({
  page,
}) => {
  await extractionWalk(page, {
    filename: "smoke-transcribe.mp4",
    mimeType: "video/mp4",
    bytes: "SMOKE::transcribe::SMOKE::graph::Bob|Initech|works_at",
    tab: "Videos",
    entity: "Bob",
  });
});
