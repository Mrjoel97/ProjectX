# ADR-062: Produce typed Excel reports and editable PowerPoint presentations

- **Status**: **Accepted** — 2026-10-21, owner requested the formats and approved implementation.
- **Supersedes**: only ADR-036 decision 1's exclusion of PPTX generation and its values-only/basic
  XLSX output boundary. ADR-036 itself and its historical evidence remain unchanged.
- **Does not supersede**: original-download ownership, capped uploaded-file projections, optional
  preview failure semantics, PDF handling, explicit retrieval promotion, durable file-link
  disclosure, tenant isolation, existing spending controls or ADR-046's publishing approval rule.

## Context

The owner explicitly requested professional Excel reports in their actual file format and beautiful
editable PowerPoint presentations, then said "proceed" after the isolated discovery packet. This is
the demand ADR-036 named as a reason to revisit its output restriction. The existing Markdown-table
writer produces real XLSX files but stores all cells as strings and has no report design contract.
Pinned SheetJS 0.20.3 was tested against actual ZIP output: it did not preserve requested font/fill
styles or frozen-header metadata. PPTX upload extraction does not create an editable presentation.

## Decision

1. The generated format set may add `pptx` to `pdf | html | xlsx`. DOCX is not introduced. Shared
   MIME/extension metadata remains in `@pikar/core/documentGen`; all creation and regeneration
   callers must retain the actual requested format.
2. Rich XLSX uses a bounded pure TypeScript report schema and ExcelJS 4.4.0 behind a static,
   subpath-only Node writer. The simple SheetJS helper remains available. Explicit numeric/date/
   boolean/text types, source metadata and code-owned supported calculations replace implicit
   coercion and arbitrary formula generation. Cached calculation values are computed before export;
   writing a formula is not general workbook recalculation. Conservative conversion of old Markdown
   tables preserves ambiguous values and identifiers, and does not verify model-authored totals.
3. One bounded native single-series column/line chart may use controlled OOXML parts added with
   installed fflate after ExcelJS serialization. The serializer owns all markup, references,
   relationships and caches; model-written XML, macros, arbitrary formulas and external links are
   excluded. This path requires structural regression checks and actual Office visual qualification.
4. PPTX uses a bounded presentation specification, a registry-owned `presentation-drafter` and
   reviewed native layouts through a static PptxGenJS 4.0.1 writer. Text, tables, shapes, supported
   charts, speaker notes and source references remain editable. Arbitrary rendering programs,
   untrusted markup and remote media fetches are outside this initial contract.
5. Generated presentations retain their text outline and tenant-owned original bytes. An optional
   separately stored, capped presentation specification supplies a scriptless HTML layout preview.
   This is a same-spec view, not a pixel-identical PowerPoint render or a PDF slide twin. Missing
   preview data must leave the original artifact downloadable. Uploaded Office text/grid contracts
   are unchanged; this is not arbitrary lossless Office round-trip editing.
6. The existing Executive, skill registry, Vault/Content surfaces, storage lifecycle, redaction and
   paid-call rails own the new outputs. Additive presentation/campaign metadata remains tenant data
   and follows export/erasure ownership; content never enters refs-only audit payloads.

## Consequences and acceptance

No second document service or Office conversion runtime is admitted by this decision. Native file
generation, semantic correctness, preview usefulness, Office editability and visual quality have
separate acceptance evidence. Actual file bytes must be reopened and representative artifacts
visually inspected in their intended software before release; passing local structural tests is
insufficient. Registry changes need current qualification and explicit activation under existing
rules. Package dependencies must remain pinned and their Node bundling verified.

The owner's implementation approval admits this isolated parallel offline lane. It does not reorder
the Phase 48–52 managed-service programme, authorize deployment/paid comparisons, activate skills or
give blanket consent to publish generated files or campaign items.
