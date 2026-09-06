---
phase: 40-document-canvas
plan: 02
status: complete
completed: 2026-09-06
commits: [see the phase-close commit — feat(40-02)]
requirements-completed: []
requirements-pending: [DOC-01]
---

# 40-02 — A real `.xlsx` on both planes, taught by the body

**Measured before (2026-09-06, tree `4b8fe5b`).** `DocFormat` was `pdf | html`, pinned to exactly
that pair by `documentGen.test.ts`. `generateAttachment` carried a two-value enum;
`regenerateAttachment` passed **no** format, so revising an html attachment silently returned a PDF.
`createDocument` had `form: short | long` and a description promising "markdown and a PDF — never
PowerPoint, Word or slides"; `insertCreatedDoc` hardcoded `storedMimeType: "application/pdf"` and
`patchCreatedDoc` never revised it at all. `vaultSources.form` and `FORM_LABEL` were closed
two-value sets, and ContentView's `bytesLabel` would have printed the whole OOXML subtype in caps.

**Owner decisions (2026-09-06):** BOTH planes get `.xlsx`; the cockpit-agent body bumps through the
local eval gate.

**What changed.**
- **Core (`documentGen.ts`):** `XLSX_MIME` written once here; `FORMAT.xlsx`; `DocFormat` gains
  `"xlsx"`; `formatForMime(mime)` is the reverse lookup that lets a regenerate rebuild what it
  already was; `markdownToSheets(markdown)` walks `tokenizeMarkdown` and turns every pipe-table
  token into a sheet named from the heading above it, `[]` when there is no table. One parser for
  every format — the rule `dashboard-pages.md` states.
- **The drafter:** `spreadsheet-drafter` (new registry name, body v1, `.md` + derived constant +
  seed row + the md↔ts no-drift guard). **Deliberately UNGATED**, the `content-drafter` rationale
  verbatim: `run-eval-golden.mjs`'s SKILL_NAMES derives from `GATED_SKILLS` and no golden fixture
  reaches the drafting path, so gating would mint a candidate no eval could certify. That asymmetry
  is also WHY this is a new row rather than an edit to `document-drafter` — which is gated, and
  whose body tells the model the opposite of what a spreadsheet needs ("keep tables to 2–4 columns
  so they fit the page"). The body's rules are the ones code cannot enforce: first row is the
  header, plain numbers with the unit in the column header, `YYYY-MM-DD` dates, one fact per cell,
  no prose, **no formulas** (this system writes values), ≤12 columns, and an empty cell rather than
  an invented figure.
- **Email plane:** the enum is `["pdf","html","xlsx"]`; `renderAndStore` picks the drafter by format
  and renders three ways. A draft with **no table** is refused BEFORE the render with its own
  sentence ("no table in it — ask which columns they want"), because the generic render-fail message
  would send the model round the same loop with the same prose. `regenerateAttachment` now passes
  `formatForMime(old.mimeType)`.
- **Vault plane:** `createDocument.form` gains `"sheet"`. `insertCreatedDoc`/`patchCreatedDoc` share
  one `CREATED_FORM` validator and derive `storedMimeType` through `storedMimeFor(form, storageId)`
  — which also fixes a latent bug the new form made visible: `patchCreatedDoc` never revised
  `storedMimeType`, so a long→short rewrite left a stored type with no bytes under it, and a
  long→sheet rewrite would have framed a workbook in the PDF viewer. `kind` for a sheet is
  `created_document`. `vaultSources.form` widens (schema + validator + write site),
  `FORM_LABEL.sheet = "SPREADSHEET"`, and ContentView's `bytesLabel` maps the OOXML MIME to "XLSX".
- **Body v3 of `cockpit-agent`** (ADR-007: a granted capability must be TAUGHT): the routing bullet,
  the attachments block ("adds one PDF" → a document, PDF unless html or xlsx), the `form` triple,
  and the format caveat (a real `.xlsx` exists; PowerPoint/Word still do not). Every literal other
  tests pin survives, including the contiguous "never PowerPoint, Word or slides".
- **Offline seam:** `parseSmoke` gains `noTable` and the drafter's SMOKE branch returns a TABLE when
  the skill is the spreadsheet drafter — tenant-gated by `fixtureSeamFor` with the rest of that
  parser, and declared in `fixtureSeam.test.ts`'s deep-equal so a new in-band switch cannot be added
  quietly.

**Verified.** Backend `cockpitTools` 161/161. The four new tests assert the thing that matters:
the stored bytes are **read back through `sheetRows`** and yield a sheet with the drafted header row
(asserting the MIME alone would pass a PDF renamed `.xlsx`); a tableless draft refuses with its own
sentence, adds no ref and blocks the plan; html and xlsx attachments each survive a regenerate as
themselves; and `createDocument({form:"sheet"})` writes `mimeType: text/markdown` with
`storedMimeType: XLSX_MIME` and `vaultSources.form === "sheet"`. Contracts 123/123 (the new md↔ts
pair). Core 1,518/1,518 including 5 new `documentGen` tests. Backend shards 2,069 + 1,959 green,
web 888, vault 184, cost 95; `tsc` clean in both apps; `biome --diagnostic-level=error` clean over
631 files.

**Three tripwires fired and were resolved by re-derivation, not refresh.** `schema.test.ts` (the
header index must state the real table count and name every table — 58→59 with `vaultSheets`),
`tenantData.test.ts` (the same count, RE-DERIVED: two independent readers of one file now agree),
and `isolation.test.ts` (every runtime table must be classified). Classifying the table then made
`tenantExport`/`tenantDelete` demand a `by_tenant` index — the promise enforcing itself.

**Open — the one item this plan did not close.** The cockpit-agent v3 body is written and will seed
as a **candidate**; its local eval gate (`pnpm eval:golden --skill cockpit-agent@<v>`, 46 cases,
~$0.80) and `activateSkill` have NOT been run, so the local deployment still executes v2 against the
new tool set — the tool is present and works, the body simply does not yet advertise xlsx. Prod
activation joins the owner's G19 list either way (EVAL_GATE is per deployment).

**Deliberately not done.** DOCX/PPTX generation (ADR-036 says never), a per-document fee row, pack
grants, an e2e case for the xlsx attachment (the SMOKE agent grammar carries `attach=<topic>` with
no format slot; adding one is a parser change with no coverage value beyond the unit chain, so the
`/\.pdf$/` e2e pins are left exactly as they were).
