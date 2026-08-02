# 20-02 — SUMMARY

**Plan:** the schema and trace freeze. **Status: complete** (2026-08-02). Every union, table and
field Phase 20 needs is widened ONCE, here — no later plan reopens `schema.ts` except 20-07's
`plans.kind`.

## Lane gate — re-checked at execution, and it is CLEAR

The plan's `lane_gate` warned that Lane D held `schema.ts` and `cards.tsx`. At execution both files
were **clean in the working tree** and Lane D's work is committed (`efc8a82` / `476d4c5` 18-02,
`1c53030` 18-07). No `PARALLELIZATION.md` contract was needed.

**The plan's captured anchors were stale, as it predicted.** The live `agentSteps.tool` union ends
at **`createDocument`** (18-02), not `declareUnsupported`; the `VERB` map likewise. `dispatchMedia`
was appended after `createDocument` in both.

## What shipped

**`schema.ts`**

- **`mediaJobs`** — one table for the job AND its asset, four-kind closed `kind` union, `spec` as a
  discriminated union of exactly what was SUBMITTED, `estUsd` in **fractional USD**, four-value
  `verdict`, `by_plan` + `by_batch`. **No url-shaped field anywhere**, deliberately and comment-
  documented.
- **`plans`** — the block deck (`shots` with `narration`, `artDirection`, `script`, `clipSeconds`)
  and the six render-plane fields (`renderStatus`, `renderStorageId`, `sidecarStorageId`,
  `sidecarHash`, `renderReason`, `renderedAt`). All optional → zero migration.
- **`guardrailConfig.mediaKillSwitch`** — optional, so a missing row still reads OFF.
- **`agentSteps.tool`** — `v.literal("dispatchMedia")`.

**`cards.tsx`** — `dispatchMedia: ["Writing the script and art direction…", "Storyboard ready"]`,
shipped in the SAME commit as its schema literal. The copy never says "Generated" or "Reel ready":
the specialist PROPOSES (D2).

**`plans.ts`** — `resetPlan` wipes the deck and all six render fields; `patchPlan` gains **no** deck
or render args, with the `calendarEventId` comment shape explaining why that absence is the
guarantee.

**`plans.test.ts`** — one new test asserting all ten fields are cleared by `resetPlan`.

**`docs/playbooks/cockpit.md`** — bumped, with the reset rule, the no-args rule, and the
**hand-maintained mirror pair** invariant recorded.

## The DELIBERATE DEVIATION the plan asked to be recorded

**Dropped: research §5.2's stored `callbackHash` field and its `by_callback` index.** The webhook
path segment is `${jobId}.${hmacHex(jobId, FAL_WEBHOOK_SECRET)}`; **plan 20-06 must resolve the row
with `ctx.db.normalizeId("mediaJobs", raw)` and RE-DERIVE the HMAC** — which is exactly what
`gmailAuth.verifyState` already does for the OAuth `state`, in an `httpAction`, in production today.
Storing the digest buys nothing and costs a field plus an index. `normalizeId` returning `null` for
a malformed or foreign-table id is the fail-closed shape. **20-06 is written against this decision.**

## The render-plane field names AS SHIPPED — 20-16 patches these, 20-10 renders them

```ts
renderStatus:      "pending" | "rendering" | "rendered" | "failed"   // v.optional(v.union(...))
renderStorageId:   v.optional(v.id("_storage"))   // final.mp4
sidecarStorageId:  v.optional(v.id("_storage"))   // final.mp4.assembly.json
sidecarHash:       v.optional(v.string())
renderReason:      v.optional(v.string())         // a reasonCode, NEVER ffmpeg stderr
renderedAt:        v.optional(v.number())
```

**A reel is publishable only when `sidecarStorageId` is also set and its sidecar has validated.**
Presence of a valid sidecar IS the proof-of-governed-render — `renderStorageId` alone is not.

## The deck field names AS SHIPPED — 20-08 writes these, 20-09 edits them

`plans.shots[]` = `{ index, type, seconds, windowStartMs, description, overlay?, prompt, narration }`
— field-for-field the `Block` type from `@pikar/core/storyboard`, so a parsed deck patches straight
in. `type` is `v.string()` in Convex; the CLOSED `ShotType` set lives in `@pikar/core` and the
parser is what enforces it (a Convex literal union would be a second place to widen).

## `plans.kind` is UNTOUCHED — and it is now a THREE-way mirror

The plan named two mirrors; there are three, and 20-07 must move all of them in one commit:

1. `schema.ts` `plans.kind`
2. `plans.ts` `patchPlan`'s hand-maintained `kind` union (a runtime *validator*, so a mismatch
   rejects at the boundary while the schema would happily store the value)
3. `packages/core/src/actionType.ts` — `actionTypeOf(kind: "memo" | "calendar_event" | undefined)`,
   called at `cockpit.ts` with `plan.kind`. **This is why widening the schema alone is a NON-TEST
   typecheck error**, and it is the one the plan's interfaces section flagged.

## Verification

- `traceParity.test.ts` **green** (2/2) — it asserts set equality BOTH ways.
- `plans.test.ts` **green** (15/15), including the new deck+render reset test.
- **Backend typecheck: 13 errors, ALL in test files, ZERO non-test — delta exactly 0.** (Note: the
  plan's "150 baseline" is stale; `de2fdc2` (22.1-03) took it 50 → 13 and left the last 13 RED on
  purpose.)
- `pnpm --filter @pikar/web build` — run after the `cards.tsx` edit.
- `node scripts/check-playbooks.mjs` — exits 0.

**Both mutation checks observed RED, then restored:**

| mutation | what fired |
|---|---|
| delete the `dispatchMedia` VERB entry | `agentSteps.tool literals with no VERB entry … dispatchMedia` |
| drop `renderStorageId` from `resetPlan` | `renderStorageId survived resetPlan` |
