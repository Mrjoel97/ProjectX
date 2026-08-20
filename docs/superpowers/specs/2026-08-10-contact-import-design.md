# Bulk contact import (CSV) — design

**Date:** 2026-08-10
**Status:** implemented and verified in canonical GSD Phase 19.1
**GSD phase:** `19.1-bulk-contact-import-csv`
**Requirements:** `ACTN-05`, `PIPE-01`
**Execution state:** `verified`
**Canonical evidence:** [19.1 closing summary](../../../.planning/phases/19.1-bulk-contact-import-csv/19.1-07-SUMMARY.md) · [19.1 owner gate/validation](../../../.planning/phases/19.1-bulk-contact-import-csv/19.1-VALIDATION.md) · [19.1 verification](../../../.planning/phases/19.1-bulk-contact-import-csv/19.1-VERIFICATION.md)
**Remaining gates:** none. Verification retains one explicitly unobserved consent-chip comparison that the owner closed in favor of the visible Origin-column distinction; it is not a code or phase blocker.
**Scope:** the first of four contact-acquisition subsystems (see *Decomposition*)

---

## Problem

A user arriving at Pikar with an existing business has their contacts somewhere else — a CRM,
a spreadsheet, an address book. Today the only way to get them into the phase-19 contacts
substrate is to type them one at a time on `/dashboard/pipeline`. That is a migration wall:
the Pipeline is empty on day one and stays empty, so nothing downstream of contacts
(follow-ups, the CRM plan type, suppression) has anything to work with.

## Decomposition

The original request spanned four independent subsystems. Each gets its own spec → plan →
build cycle. **This spec covers only #1.**

1. **Bulk file import (CSV)** — this document
2. **Extract contacts from documents** — a proposal or contract yields people plus context
3. **Search-then-import** — find documents already in the vault, pull contacts from them
4. **Third-party CRM migration** — HubSpot/Pipedrive/etc.

#2 and #3 are nearly the same feature (both end in "extract people from a document"; they
differ only in how the document is chosen) and should be specced together.

**#4 will not use MCP.** ADR-011 records that the Pikar-Ai MCP is an account-level OAuth
connector on the claude.ai client and is *"structurally unreachable from a Convex action."*
A Convex action could speak MCP to a third-party server over HTTP, but that requires building
an MCP client plus per-provider OAuth — strictly more work than calling the provider's REST
API, which every candidate CRM offers. When #4 is specced, it is REST connectors.

Most of #1–#3's infrastructure already exists and should be reused rather than rebuilt:
`intakeDb.generateUploadUrl` (browser→storage), `vaultDrive.listDriveFolders` /
`importDriveFolder` (folder browse + tree import), `vaultExtract.extractDoc` (PDF page
fan-out), `packages/extraction` (`classify`, `frame`), and `vaultRag` / `searchVaultSpine`.

---

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Format | **CSV only** | Every CRM exports it. vCard is a later addition if asked for; building it now is speculative. |
| Where parsing happens | **In the browser; the file is never stored** | No PII at rest, no retention policy, no cleanup job, instant preview. |
| Scale | **≤1,000 rows, hard cap** | Fits a real address book. Removes the entire job/reservation/resume machinery. |
| Duplicates | **Fill empty fields only; never overwrite** | A CRM export is usually staler than what the user has since typed. Nothing typed by hand can be destroyed. |
| Consent | **One attestation at import, recorded per contact** | Reproducible SC#4 evidence, honest about who asserted it, one action rather than 500. |
| Who can import | **Human only** | The attestation is a legal statement a person makes; the agent cannot see the file; keeps a new registration surface off the 14-site checklist. |
| Storage | **The existing `contacts` table** | PIPE-01 forbids a second CRM store; 19-02's structural scan enforces it. |
| CSV parser | **Hand-rolled RFC-4180 in `packages/core`** | ~60 lines for a frozen, well-specified format, versus a 45KB dependency. Correctness comes from the test, not the line count. |

### Rejected approaches

- **Upload and parse server-side.** Reuses `intakeDb.generateUploadUrl` and keeps the file as
  an audit artifact — but puts a raw file of real people's names and addresses at rest, with
  no retention rule. Phase 19 worked hard to keep `audit.payload` from becoming a PII
  honeypot; this would recreate one a layer over. No user-visible gain at 1,000 rows.
- **Route the CSV through vault ingest.** One pipeline for all four subsystems, but vault
  ingest is LLM extraction — a CSV is structured data needing no model, so every import would
  cost money and inherit extraction's accuracy questions. Right pipeline for #2, wrong for #1.

---

## Data model

The `contacts` table currently holds only `email`, `name`, `origin` and the consent fields.
"Fill empty fields only" needs fields to fill, so three are added.

### New optional fields on `contacts`

```
company: v.optional(v.string())
phone:   v.optional(v.string())
title:   v.optional(v.string())
```

Three, and no more. Custom fields / tags / arbitrary key-value is a schema-design project,
not an import feature, and the table is deliberately narrow. All three are content plane.

### Two union extensions

```
origin:        + "imported"           (was: mailbox-resolved | user-entered | inbound)
consentSource: + "imported-attested"  (was: asserted-by-user | inbound-form)
```

`origin` is documented as *the provenance of the data, not who triggered the write*, so
`"imported"` is the correct axis — and it lets the Pipeline always distinguish a contact that
came from a file from one the user typed.

`"imported-attested"` is deliberately **distinct** from `"asserted-by-user"`. A single
attestation covering 500 rows is weaker evidence than consent recorded for one person the
user spoke to. The schema should not flatten that difference; a regulator asking "how do you
know?" gets a different, honest answer for each.

### The consent tension, stated

`schema.ts` says *"NOTHING is defaulted to consented."* Writing a consent row for every
imported contact brushes against that. It is still honest because it is an explicit human
act, not a default — but only if two things hold, and both are requirements:

1. The attestation checkbox **starts unticked** and Confirm is **disabled** until it is
   ticked. A pre-ticked box would make the stored wording a false statement about what the
   user did.
2. `consentWording` stores the **exact sentence shown**, byte-for-byte, never a paraphrase or
   a key into a message table. It is the evidence.

### The attestation wording

The sentence is part of the spec, not an implementation detail — it is the stored evidence,
so it must be settled deliberately and versioned in `@pikar/core` alongside the parser:

> **I have a lawful basis to contact these people** — they are business contacts of mine, and
> I am not importing a purchased or scraped list.

The free-text *"where did these come from?"* is stored separately as `consentContext`
(e.g. *"HubSpot export, August 2026"*). Wording and context are stored per contact, not once
per import batch, so a single contact's record is answerable on its own without reconstructing
which import it belonged to.

If the wording is ever changed, the new text applies only to imports after the change —
existing rows keep the sentence their user actually saw. That is the whole point of storing
it verbatim rather than by reference.

`consentWording` and `consentContext` are content plane. **Neither may reach `audit.payload`**
(CLAUDE.md §4). Import audit rows carry counts and contact ids only.

---

## Architecture

```
browser                                     backend (contacts.ts)
───────                                     ─────────────────────
file picked
  ↓ read as text (never uploaded)
parseCsv(text)          @pikar/core
  ↓ string[][]
mapRows(rows, mapping)  @pikar/core
  ↓ valid rows + rejected rows
  ├──────────────────────────────────────→  matchExisting({ emails })   tenantQuery
  ↓                                    ←──  per address: exists? which fields empty?
preview: N new · M enriched · K unchanged · R rejected
  ↓ user ticks attestation, adds source note
  └──────────────────────────────────────→  importContacts({ rows, attestation })
                                             tenantMutation, batched ~100
                                             per row: normalize → validate →
                                             upsert fill-empty-only → write consent
```

### `packages/core/src/contactImport.ts`

Pure TS, no Convex, tested in the core suite.

```
parseCsv(text: string): string[][]
mapRows(rows: string[][], mapping: ColumnMapping): { rows: ImportRow[]; rejected: RejectedRow[] }
```

`parseCsv` implements RFC-4180: quoted fields, commas and newlines inside quotes, doubled
quotes as an escaped quote, a leading BOM, and CRLF or LF line endings. These are not edge
cases — a HubSpot export contains `"Acme, Inc."` on the first page.

Header auto-mapping covers common aliases (`email` / `e-mail` / `email address`; `name` /
`full name` / `first`+`last`; `company` / `organization`; `phone`; `title` / `job title`).
Every column is overridable in the preview. Unmapped columns are dropped.

**Two reuses are load-bearing:**

- Identity comes from `normalizeAddress` (`@pikar/core`) — the one address-identity function
  the whole substrate is keyed on.
- Validity comes from `isValidEmail` (`packages/core/src/validateSubmit.ts`) — the repo's
  designated single email regex, already the send path's rule and wired into
  `parseCrmOperations` by 19-13.

Using both means **import cannot disagree with the send path** about who a row is or whether
an address is real. An import-local rule would produce contacts that exist but can never be
emailed.

**Within-file duplicates collapse client-side** under the same fill-empty rule, before
anything is sent. Two rows sharing a normalized address in one batch would otherwise race on
a single contact.

### Backend — two new public functions in `contacts.ts`

**`matchExisting({ emails: string[] })` — `tenantQuery`.** Bounded by its input, chunked
client-side at 500 addresses per call. Returns, per address: whether it exists, and which of
the four mappable fields (`name`, `company`, `phone`, `title`) are empty. This is what lets
the preview state the counts before any write.

**`importContacts({ rows, attestation })` — `tenantMutation`.** Batched at **100 rows per
call** (a starting value, tunable against Convex's transaction limits during the build; the
correctness argument below does not depend on the number). Per row: normalize the address,
validate it, upsert with fill-empty-only semantics, then write the consent record with
`source: "imported-attested"` and the wording verbatim.
Returns `{ created, enriched, unchanged, rejected }`.

The row shape crossing the boundary is already normalized and validated client-side, but the
mutation **re-validates rather than trusting it** — the same write-boundary discipline
`parseCrmOperations` follows:

```
ImportRow = {
  email:   string            // normalizeAddress applied; re-applied server-side
  name?:   string
  company?: string
  phone?:  string
  title?:  string
}
Attestation = { wording: string; context?: string }
```

Both join the `COVERED` pin in `contacts.test.ts` **with real asA/asB isolation tests**.
19-13 established that bumping the pin without adding the test defeats the pin's purpose.

### Why there is no job queue

Batches are separate transactions, so a failure at batch 3 leaves batches 1–2 landed. Because
the write is **upsert-by-address and fill-empty-only, re-running the same file is safe and
converges**. Retry-the-whole-thing is therefore a complete recovery strategy, which removes
the reservation table, the resumable cursor, the partial-state UI, and the cleanup job that a
job-based design would owe.

The 1,000-row cap refuses larger files outright, naming the limit, and carries a `ponytail:`
comment naming the ceiling and the job-based upgrade path.

---

## Interface

Lives on `/dashboard/pipeline`, beside the existing *"Add your first contact"* — the empty
state is the natural entry point, and the page shown after import is the page that displays
the result. No new route. The file picker follows the vault's `Dropzone.tsx` pattern rather
than introducing a second one.

Three steps in one panel:

1. **Choose a file** — parsed locally, immediately.
2. **Preview** — the auto-detected column mapping (every column overridable) above the counts
   *N new · M enriched · K unchanged · R rejected*, with rejected rows listed by line number
   and reason. This screen has to earn trust; it is the last point before a bulk write.
3. **Attest and confirm** — the consent statement (unticked; Confirm disabled until ticked)
   plus a free-text *"where did these come from?"* that becomes `consentContext`.

Tokens from `globals.css`, no component library, refusals rendered inline in grey
`--ink-soft` — phase 19's established rule that a refusal is information, not failure
(never amber).

### Failure handling

| Condition | Behaviour |
|---|---|
| File over the row cap | Refused outright, naming the limit |
| No email column detectable | Refused, asks the user to map one |
| Invalid or missing address in a row | Row skipped and listed; good rows still import |
| Partial batch failure | Reports what landed, and that re-running the same file is safe |

---

## Testing

| Layer | What it proves |
|---|---|
| `packages/core` | The CSV cases that break naive parsers (quoted comma, embedded newline, doubled quote, BOM, CRLF); header alias mapping; within-file dedup |
| `contacts.test.ts` | asA/asB isolation on both new functions; fill-empty-only asserted **on stored state, not on the reply**; consent wording stored byte-for-byte; the §4 scan extended to prove no wording reaches `audit.payload` |
| `pipeline-uat.spec.ts` | **A real browser** uploading a real fixture CSV, seeing the preview counts, confirming, and finding the rows in the table |

Every new guard is mutation-proven: broken, observed red, reverted, with the failing text
recorded.

**The browser row is a requirement, not a nicety.** Phase 19 shipped a capability that unit
tests, SMOKE tests and a paid eval gate all certified while it was completely unreachable
from the product, because each of those supplies its own context that a browser never
provides. An import feature has the same shape: a `tenantMutation` passing every backend test
can still be unreachable because the button is not wired. Only a browser test sees that.

### The riskiest part of the build

Not the parser — **the two schema union extensions**. `origin` and `consentSource` are
discriminated unions consumed at multiple sites, and 19-06 established that widening such a
union produces a compile error at *most* call sites but falls through silently where a
consumer is typed loosely (`PlanRow` never declares `kind`, so `media` shipped a whole phase
without reaching its branch). Both extensions need a deliberate site walk against the
registration checklist in `cockpit.md`, not faith in `tsc`.

---

## Amendments after research (2026-08-10)

Phase research (`.planning/phases/19.1-bulk-contact-import-csv/19.1-RESEARCH.md`) found three
things this spec got wrong or omitted. All are now binding.

**Consent must never be downgraded — omitted from this spec.** If a contact already carries
`consentSource: "asserted-by-user"`, the batch attestation must not replace it. Bulk data may
never destroy stronger hand-recorded data — the same principle as fill-empty-only, which this
spec applied to fields but failed to apply to consent.

**`upsertContactRow`'s current rule is "don't erase", not "fill empty only".** A non-blank name
overwrites today, and only the blank case is tested. Fill-empty-only is therefore a genuine
behaviour change and must arrive as a flag on the shared helper so hand-add behaviour and
playbook invariant 13 are preserved.

**The batch numbers are right; the reasoning in this spec is not.** 100 rows and 500 addresses
sit at roughly 1% of every hard Convex limit — every limit would permit the whole 1,000-row file
in a single call. The real justification is retry blast radius, progress granularity and the OCC
window, and it should be stated that way rather than citing a limit the design never approaches.

Three smaller decisions, now locked: preview counts are defined over the four mappable fields
only (otherwise a consent write makes everything "enriched" and `unchanged` is always 0); a
rejected row reports its physical file line rather than the record index (they diverge on a
quoted newline); and two owner decisions taken 2026-08-10 — the Pipeline consent chip renders
`consent.source` rather than flattening it to `Consented {date}`, and `pipelineTiles` reports its
scan bound like its siblings instead of silently under-counting past 1,000 contacts.

## Out of scope

- vCard, XLSX, or any format other than CSV
- Custom fields, tags, or arbitrary key-value on a contact
- Agent-initiated import
- Imports above 1,000 rows
- Any change to whether consent gates sending (it currently does not; that is a separate
  decision affecting hand-added contacts too)
- Undo / rollback of an import
