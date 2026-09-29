# Phase 30 local browser review — 2026-09-28

Scope: one synthetic, invited tenant on a fresh loopback Convex instance and a production
Next build, operated through Playwright CLI. No paid provider, customer data, live send,
pack activation, hosted deployment or production endpoint was involved.

The terminal-held `phase49-disposable-stack.mjs --interactive` reached
`http://127.0.0.1:3112` after a fresh function push, disposable JWT/JWKS configuration
and production web build. A synthetic `example.test` account signed up through the real
browser form. The fixture helper used only the owned temporary instance to create one
ordinary `vertical-product` candidate/artifact origin and an Output-card thread.

The browser showed the original document and review controls. Opening Edit prefilled
the persisted text and left no-op Save disabled. A human-initiated browser click saved
`# Human-edited synthetic product draft`. The card then showed a PDF iframe and
`Review recorded: edited draft saved.` Both remained after a browser reload. A separate
tenant-bound server readback found the exact edited text SHA-256, a present stored PDF,
and exactly one `review_edited` outcome with content revision 1; the refs-only event
contained no draft text. The runner's in-stack audit check exited 0. Its owned
temporary root was removed, and ports 3112/3410/3411 had no listeners afterward.

Local screenshots: `output/playwright/phase30-vertical-edit-2026-09-28.png` and
`output/playwright/phase30-vertical-review-status-2026-09-28.png`. These are synthetic
inspection artifacts, not a cryptographic attestation or a committed qualification
receipt. The test covered one long-form positive edit, not refusal branches, sheet/short
rendering, external semantic quality, hosted tenant UAT, candidate activation or
Waves 7–8 acceptance. The interactive runner's terminal/timeout hardening was added
after this run and still requires source-level verification; no claim is made that the
post-hardening bytes ran in this browser observation.

After the hardening edit, a separate terminal-held smoke reached the fresh production
web app, accepted the exact `stop` input, exited 0 after its in-stack audit, removed
its owned temporary root, and left no listeners on ports 3112/3410/3411. This
exercises the current interactive branch's startup/normal shutdown, not its 20-minute
timeout or a second edit. The current 71-file Phase 49 aggregate separately passed
all 21 required repository/local planes on digest
`66b53e7c88a3e5227b5be199876408cc1b46a2ba23431d5a456d8fa3c2722acd`.

## Second disposable browser run: short and sheet

A new synthetic invited tenant on another fresh owned loopback stack exercised two
separate ordinary product artifacts. Short content began with no file bytes; the
browser saved a changed body and the server readback matched its edited hash, absent
storage and one `review_edited` outcome. For the spreadsheet branch, the signed-in
browser's tenant upload door supplied initial placeholder storage bytes so the
server could identify the artifact as a sheet. The initial bytes were *not* a valid
workbook fixture and were never presented as one. The Output card showed the
original Markdown table. A table-free edit displayed the specific refusal; server
readback retained the original hash and zero edit outcomes. A valid multiline table
then saved; after reload the browser showed the edited cells and recorded status.
Server readback matched the edited text hash and one outcome. The browser's
authenticated download of the replacement returned XLSX MIME and 16,137 bytes with
a ZIP `PK` signature. This checks transport/rendering shape, not cell-level workbook
parsing or semantic quality. The isolated audit exited 0, its exact root was removed,
and ports 3112/3410/3411 were not listening after shutdown. Synthetic screenshots
are in `output/playwright/phase30-sheet-edited-2026-09-28.png` and
`output/playwright/phase30-sheet-status-2026-09-28.png` (local, not committed).

A subsequent backend regression strengthens the renderer/store boundary beyond
the browser's ZIP/MIME observation: after an authenticated sheet edit, it reads
the replacement blob through Convex storage, parses it as XLSX, and asserts the
actual `Item, Count` header and `Revised, 2` row. The same test checks that the
old blob is gone. This is a synthetic local workbook-content proof, not a
cell-level parse of the particular browser-downloaded bytes or hosted UAT.

## Third disposable browser run: downloaded workbook cells

A further fresh owned loopback stack used a new invited synthetic tenant and the
real Output-card editor. The signed-in tenant upload door supplied initial
placeholder bytes solely to classify the created artifact as a spreadsheet;
those initial bytes were not a valid workbook. The browser changed the table
to `Item | Value` / `Browser Edited | 7`, saved it, and displayed the edited
cells and review-recorded status. From the app's full-document preview, the
browser clicked **Download original** and saved the resulting file to
`output/playwright/phase30-browser-sheet-2026-09-28.xlsx` (local, ignored).
An independent local SheetJS parse of those *actual browser-downloaded bytes*
found one sheet named `Sheet 1` with exactly those two rows; the 16,145-byte
file's SHA-256 was
`8903621f230361e31d9d17ede123e1d9816512969aba02cc64036e074bd311a1`.
The isolated audit exited 0, the exact owned root was removed, and ports
3112/3410/3411 had no listeners after shutdown. This is local synthetic
download-content evidence, not proof that the original placeholder was a valid
workbook, hosted tenant UAT, semantic quality or native pack activation.
