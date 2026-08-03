// The vault's document-type union (VALT-12). Pure TS, Convex-free (CLAUDE.md §1).
//
// HOME IS `packages/core`, NOT `packages/vault`. `apps/web` drives a `<select>` off this union, and
// `ShapePanel.tsx` already imports `REVENUE_STAGES` from `@pikar/core` for exactly that shape —
// `Dropzone.tsx:22-26` and `CategoryTabs.tsx:13-15` record what a third local re-declaration costs.
//
// The literals are kept identical to `vaultDocuments.docType` in `schema.ts`. The two-direction
// compile bridge that makes drift a TYPECHECK failure lives beside the classifier in
// `packages/backend/convex/` (the `tenantProfile.ts:58-67` idiom) — it cannot live here, because
// core must not import Convex's generated `Doc<>` types.

/** The closed set of document types the classifier may assign (VALT-12). `unclassified` is the
 *  explicit no-match member: a document matching nothing is NEVER forced to a nearest match, and it
 *  is also the classifier's fallback when the model call fails. Note ABSENT (every pre-15.3 row)
 *  means "never classified" and is a DIFFERENT state from `"unclassified"`.
 *
 *  Adding a member without a label is a COMPILE error at the label table below. */
export const DOC_TYPES = [
  "pnl",
  "balance_sheet",
  "cash_flow",
  "invoice",
  "contract",
  "policy",
  "deck",
  "report",
  "plan",
  "correspondence",
  "spreadsheet_other",
  "unclassified",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** THE label table. A `satisfies Record<DocType, string>` bind, not a ternary or a `??` fallback:
 *  either of those is total by construction, so widening DOC_TYPES would silently render the new
 *  member as whatever the else-branch names. This way adding a member without deciding how it reads
 *  to a human is a COMPILE error HERE — which is what lets the `<select>` be driven straight off
 *  `DOC_TYPES` with no per-member UI edit. Exported (unlike `actionType.ts`'s module-private ARMS)
 *  because the picker renders it. */
export const DOC_TYPE_LABEL = {
  pnl: "P&L",
  balance_sheet: "Balance sheet",
  cash_flow: "Cash flow",
  invoice: "Invoice",
  contract: "Contract",
  policy: "Policy",
  deck: "Deck",
  report: "Report",
  plan: "Plan",
  correspondence: "Correspondence",
  spreadsheet_other: "Spreadsheet (other)",
  unclassified: "Unclassified",
} as const satisfies Record<DocType, string>;

/** The trust boundary between a MODEL STRING and the schema's closed `v.union`. An unrecognised
 *  value is coerced to `"unclassified"` by the caller — it is never written through, because an
 *  out-of-union `docType` throws "invalid argument" inside the ingest workflow and would fail the
 *  whole document for a cosmetic label. */
export const isDocType = (x: unknown): x is DocType =>
  typeof x === "string" && (DOC_TYPES as readonly string[]).includes(x);
