# 20-18 — SUMMARY

**Plan:** the D5 reconciliation readers. **Status: complete** (2026-08-02). Cost: **$0**.

Closes the half of the D5 procedure that `media.md` has promised since 20-01 and that no plan owned:
`mediaJobs.actualCents` was written by 20-06 and read by nobody, and
`npx convex run media:spendForPeriod` was a command that did not exist.

## The two signatures VERBATIM

```ts
export const spendForPeriod = internalQuery({
  args: { tenantId: v.string(), sinceMs: v.number(), untilMs: v.number() },
  handler: async (ctx, a): Promise<{
    estCents: number; actualCents: number; rowCount: number; unlanded: number;
    byKind: Record<string, { estCents: number; actualCents: number; rowCount: number }>;
    notes: { ttsReservedAt2x: boolean; reservedTotalNotDerivable: true };
  }> => { … },
});

export const listJobs = internalQuery({
  args: { tenantId: v.string(), planId: v.id("plans") },
  handler: async (ctx, a): Promise<Array<{
    batchId: string; blockIndex: number; kind: string; model: string; status: string;
    estUsd: number; actualCents: number | null; verdict: string | null;
    failureReason: string | null; promptHash: string;
  }>> => { … },
});
```

Both iterate the `by_plan` index with the **tenantId prefix as the tenant boundary** — never a
full-table scan, never a cross-tenant read. Both are pure folds: no patch, no re-pricing, no
rate-limiter call, so they are safe against production mid-batch.

## The three things that would have made the number lie

| # | The trap | How the payload handles it |
|---|---|---|
| 1 | `Σ estUsd` is **not** the reserved amount — the reservation included the `render` line (which has no row) and floored once, per batch | `notes.reservedTotalNotDerivable: true`, a literal in the return shape so the CLI output carries its own caveat |
| 2 | A `tts` row's `estUsd` is **double** by design (20-04's rewrite allowance), so est/actual ≈ 2 on voice is HEALTHY | `notes.ttsReservedAt2x`, true whenever any voice line is in range |
| 3 | `actualCents` is absent until a row lands and stays absent if it failed — a naive Σ reports an in-flight period as **cheaper** | `unlanded` counts them; `unlanded > 0` means the period is not final |

Trap 3 is the one that mattered most: it is the single failure mode a reconciliation tool must not
have, and it is the mutation check below.

## Both mutation checks — OBSERVED RED, then restored byte-identical

| Mutation | What fired |
|---|---|
| the `unlanded` counter dropped | `expected +0 to be 2` — the period reported 3 landed rows as the whole story while 2 were still in flight |
| the `createdAt` window made inclusive at both ends | `expected 3 to be 2` — the boundary row counted in **both** adjacent periods |

`media.ts` diffed byte-identical against its pre-mutation copy after each restore.

## Deliberate design decisions worth knowing

1. **The window is HALF-OPEN `[sinceMs, untilMs)`.** Consecutive periods partition rows exactly
   once. A test seeds rows at `since-1`, `since`, `since+999` and `until` and asserts the split.
2. **`tenantId` is a REQUIRED arg, not optional.** A deployment-wide figure is the sum of per-tenant
   runs; there is deliberately no unscoped query to reach for.
3. **`byKind` subtotals are each rounded once**, so they can differ from `estCents` by a cent or two.
   The total is authoritative; the breakdown exists because a drift in ONE table row is invisible in
   a single number. Recorded in the doc comment and the playbook so it is not read as a bug.
4. **`listJobs` is a PROJECTION.** `assetStorageId` / `assetHash` / `mimeType` / `bytes` are omitted —
   an operator reconciling money has no use for storage handles, and a reader returning them is the
   easiest accidental route to a fal URL (§4). A **key-set equality** test enforces it, so a field
   added to the row cannot appear here by accident.
5. **`actualCents` / `verdict` / `failureReason` are `| null`, not optional**, so a JSON CLI dump
   shows the ABSENCE explicitly rather than dropping the key — `unlanded` at row level.

## Note for whoever builds 20-06

The est-vs-actual comparison is **vacuous for `EXACT_SPEND_KINDS`**, because 20-06 sets
`actualCents = Math.round(row.estUsd * 100)` for those. For those kinds the real signal is our total
vs fal's dashboard — an EXTERNAL comparison this query supplies only one side of. That is stated in
the module doc comment; do not "fix" it by re-pricing inside the reader.

## Verification

`media` **34/34** (22 from 20-04, unchanged, + 12 new). Full backend **942/942 across 56 files**.
Backend typecheck **13, delta 0** (run `npx convex codegen` first — a new export is absent from the
generated API until then). Biome clean. `check-playbooks` satisfied for `media.md`.
