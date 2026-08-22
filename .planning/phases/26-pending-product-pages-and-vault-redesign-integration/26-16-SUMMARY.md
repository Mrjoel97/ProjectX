---
phase: 26-pending-product-pages-and-vault-redesign-integration
plan: 16
wave: 12
requirements: [RPRT-01]
status: complete
executed: 2026-08-22
---

# 26-16 — the board pack: one transaction is the snapshot, and promotion is not a new authorship

## How this plan ran

Authored by a multi-agent workflow (four subsystem readers → one design spec → one implementer),
**stopped mid-flight by the owner** because the adversarial-review phase spawned a refuter per
finding and the fan-out was multiplying without a ceiling. The implementation phase had already
landed. The review it never reached was done by hand, and it found a real defect (below).

## What shipped

**The snapshot is a transaction, not a table.** 26-02 had already decided there must be no snapshot
table; `reportPackData.snapshot` is one `internalQuery` that reads all three planes through
`Promise.all` and returns the whole immutable input. Convex read transactions are serializable, so
that returned value *is* the snapshot — the renderer never re-reads anything, and there is exactly
one `ctx.runQuery` in the whole module (statically asserted).

**`asOf` is the window's exclusive upper bound, never a wall clock.** A `Date.now()` there would
make every replay produce different markdown, different bytes and a different content hash —
destroying the replay key and turning every double-click into a second artifact. Pinned to the
window, the markdown is a pure function of (window, data). The generation instant still exists; it
lives on the vault row's `createdAt`, where a fact about the render belongs.

**Nothing is a second mechanism.** The window contract is `resolveDashboardWindow`, the reads are
the 26-14/26-15 planes lifted to plain functions (`readBusiness`, `readOperations`,
`readAuditPage` — the `readLiveForTenant` precedent), the markdown is a pure `@pikar/core` builder,
the renderer is the shipped `markdownToPdf`, the row is the shipped `vault.insertCreatedDoc`
**unchanged**, and the log is the insert-only `audit.log`.

**`kind: "created_document"`, not a new `board_pack` kind.** That kind is already inside
`content.ts`'s positive `LANE_BY_KIND` whitelist, so the Content shelf, the preview and the
promotion control all work with zero new code. A new kind would have landed *outside* that
whitelist and been silently absent from the shelf — the 26-13.1 "images missing from the shelf"
defect, repeated.

**The `"use node"` split.** `markdownToPdf` lives in `llm.ts`, which imports `node:crypto` at top
level, so the module importing it must be a node module — and a node module may hold only actions.
Hence `reportPack.ts` (the action) and `reportPackData.ts` (the query + mutation), the shipped
`media.ts` / `mediaComplete.ts` split. Both modules appear in `_generated/api.d.ts`, so the real
deployment analyzed them, not just the test harness.

**Deliberately absent from the pack, each for its own reason:** `wormExport` (reads `audit.by_ts`
with no tenant predicate — its figures aggregate over other tenants), `activeSkills`
(deployment-global registry state), and the `sentMail` rows (a 50-row sample against a 1000-row
`sentCount` prints a floor as a ratio, and a recipient address must not ride a distributable PDF).

**Honest numbers reach the bytes.** `countCell` refuses to print a number under unknown coverage,
`floorCell` prints "at least N (partial)", and `partialSections` is derived in the markdown builder
and handed back so the audit payload reports the same number rather than recomputing it.

## The defect the hand review found

> **The replay guard admitted only `origin: "agent"`. Promotion patches that very field.**

`vault.promoteToReference` — the control 26-13 shipped — flips a pack's `origin` from `"agent"` to
`"agent_promoted"`. A replay guard that admits only `"agent"` therefore stops recognising the pack
the moment the user promotes it: regenerate the same window and it inserts a **duplicate** row, and
every regeneration after that inserts another.

Both halves were already tested. `replaying the same window returns the SAME row` proved the guard.
`the SAME reads DO change when the pack is promoted` proved promotion works. **Neither test
composed them**, and the suite was 19/19 green over the defect.

Fixed to admit `"agent"` or `"agent_promoted"` — the row is still this rail's own artifact;
promotion is a trust decision the user took *about* it, not a change of authorship. The lookup also
moved from `.first()` to `.take(DUP_SCAN)` + `.find()`: `.first()` returns whatever the index orders
first, so one foreign row sharing the hash would mask ours and re-arm the same duplicate loop.

Two tests added. Both mutation-verified: restoring `origin === "agent"` turns the promotion test
red, and restoring `.take(1)` turns the masking test red. The masking test drives `landPack`
directly, because reaching that branch through `generateBoardPack` would need a user upload
byte-identical to a future pack — without it the `.find()` would have been decoration.

## Deviations

- **Files the plan did not list.** `reportPackData.ts` (new — the `"use node"` constraint forces the
  DB half into a sibling module); `reportsBusiness.ts` and `reportsGovernance.ts` (their tenantQuery
  bodies lifted to plain `readX(ctx, tenantId, window)` functions so one transaction can call all
  three — the `blueprint.readLiveForTenant` precedent, and the alternative was a second definition
  of each read); `packages/core/src/reports.ts` (the pure markdown builder + coverage cells);
  `packages/contracts/src/auditProjection.ts` (the `report.pack_generated` allowlist row — 26-15's
  drift guard requires it, and its 14 keys were checked against the write site by hand);
  `docs/playbooks/audit-dead-letter.md` and `watch.json` beyond the two playbooks named.
- **No kill switch and no `generation_disabled` reason.** A refusal nothing can produce is a lie in
  a discriminated union. Rollback is 26-17's route/nav gate or reverting the module; existing packs
  are ordinary vault rows nothing on this rail rewrites (no `.patch`, `.replace` or `.delete` in
  either module — statically scanned).

## Evidence

- reportPack **21/21**; backend **95 files / 2338 passed / 0 failed**; core 40/1096; contracts 4/64.
- Backend, core and contracts typechecks clean; biome clean on every touched file; watcher clean.
- Mutation-verified this session: `origin === "agent"` only (caught), `.take(1)` (caught).
- Anti-vacuity built in by the implementer and checked by hand: the snapshot test's equality is
  paired with a fresh capture that DOES differ, and the non-groundability test's absence assertions
  are paired with a promotion that flips the same fields.

## Not done / handed on

- **No `apps/web` file.** 26-17 owns the route, the download control and the browser gate. Download
  reuses `api.vault.vaultDownloadUrl` unchanged — no new URL surface; a foreign tenant gets `null`
  rather than a distinguishable error.
- **The `_scheduled_functions` trap, recorded in vault.md:** that table is NOT the discriminator for
  "did ingest start" — `workflow.start` schedules inside the workflow component, so the root
  scheduler stays empty for a real ingest too. The non-groundability proof is the field flip under
  promotion, not an empty scheduler.
- Still open, not introduced here: the agent-relayed citation-label gap from 26-12-SUMMARY, and
  26-VALIDATION rows 26-06/07/08.
