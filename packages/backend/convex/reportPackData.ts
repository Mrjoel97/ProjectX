// RPRT-01 — the DB half of the board pack (plan 26-16): the one capture transaction and the one
// write that lands it.
//
// NOT `"use node"` — and that is the whole reason this module exists. `reportPack.ts` must be a
// node module to import `markdownToPdf` from `llm.ts` (which imports `node:crypto` at top level),
// and a node module may hold ONLY actions. So the internalQuery and the internalMutation live
// here, exactly the `media.ts` / `mediaComplete.ts` split already shipped: one file owns the
// submit, its sibling owns the landing, and each half can be reasoned about — and statically
// scanned — on its own.
//
// This module contains NO `.patch`, NO `.replace`, NO `.delete` and NO ingest door. A generated
// pack is an ordinary tenant vault row that nothing on this rail ever rewrites, which is what makes
// "disable generation, existing artifacts stay immutable" a property of the code rather than a
// promise in a playbook. `reportPack.test.ts` scans for all four.
import type { BoardPackInput } from "@pikar/core";
import { resolveDashboardWindow } from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { MAX_WINDOW_MS, readBusiness, readOperations } from "./reportsBusiness";
import { readAuditPage } from "./reportsGovernance";

/** One page of the governance record. The section's honesty flag is `nextCursor !== null`. */
const PACK_AUDIT_LIMIT = 25;

/** How far into one (tenant, contentHash) group to look for this rail's own row — see `landPack`. */
const DUP_SCAN = 8;

/**
 * **THIS QUERY IS THE SNAPSHOT.** There is no snapshot table and there must not be one (26-02).
 *
 * Convex read transactions are serializable, so ONE query across all three planes IS the immutable
 * input: the value it returns can no longer change, and the renderer never re-reads anything. A
 * second `runQuery` from the action would reintroduce exactly the `buildBlueprintDraft`
 * seven-transaction shape this plan exists to avoid, where each section is a different instant and
 * a send can appear without its own delivery audit row.
 *
 * **`asOf` IS THE WINDOW'S EXCLUSIVE UPPER BOUND, NEVER A WALL CLOCK.** A `Date.now()` here would
 * make every replay produce different markdown, different bytes and a different content hash —
 * which destroys the replay key and turns every double-click into a second artifact. Pinned to the
 * window, the markdown is a pure function of (window, data). The generation INSTANT still exists;
 * it lives on the vault row's `createdAt`, which is where a fact about the render belongs.
 *
 * `satisfies BoardPackInput` is the compile-time honest-numbers guard: every count in that type is
 * declared beside its `DashboardBound` and `CoverageLabel`, so if the read plane ever drops a bound
 * this line fails to build rather than letting the pack print a confident zero.
 *
 * DELIBERATELY ABSENT: `wormExport` (reads `audit.by_ts` with no tenant predicate — its figures are
 * aggregates over other tenants), `activeSkills` (deployment-global registry state), and the
 * `sentMail` rows (a 50-row sample against a 1000-row `sentCount` prints a floor as a ratio, and
 * the recipient address is a personal identifier that must not ride a distributable PDF).
 */
export const snapshot = internalQuery({
  args: {
    tenantId: v.string(),
    sinceMs: v.number(),
    untilMs: v.number(),
    browserTimeZone: v.string(),
  },
  handler: async (ctx, args) => {
    // Re-resolved HERE rather than accepted as an argument: this query stays self-sufficient
    // instead of trusting a caller's window, and the resolution is deterministic and free.
    const window = resolveDashboardWindow({
      sinceMs: args.sinceMs,
      untilMs: args.untilMs,
      browserTimeZone: args.browserTimeZone,
      maxSpanMs: MAX_WINDOW_MS,
    });

    const [business, operations, audit] = await Promise.all([
      readBusiness(ctx, args.tenantId, window),
      readOperations(ctx, args.tenantId, window),
      readAuditPage(ctx, args.tenantId, window, PACK_AUDIT_LIMIT, undefined),
    ]);

    return {
      asOf: window.untilMs,
      window,
      business,
      operations,
      audit,
    } satisfies BoardPackInput;
  },
});

/**
 * Land one rendered pack as a tenant-owned, non-groundable vault row — or return the one that is
 * already there.
 *
 * **THE DEDUP AND THE INSERT ARE ONE TRANSACTION**, which is what makes the replay guard real. A
 * pre-check from the action would be a second roundtrip with a window between it and the write, so
 * two genuine double-clicks could still both insert. `MutationCtx.runMutation` runs
 * `insertCreatedDoc` as a sub-transaction of this one, so the lookup and the write commit or fail
 * together.
 *
 * The key is `(tenantId, contentHash)` on the SHIPPED `by_tenant_contentHash` index — no new index,
 * no new field, no new table. The origin + `storageId` narrowing is not decoration: without it a
 * byte-identical USER UPLOAD with the same hash would be handed back as though it were this
 * tenant's board pack.
 *
 * **`agent_promoted` COUNTS, AND LEAVING IT OUT WAS A REAL BUG.** Promotion is a shipped user
 * control (26-13): it patches this very row's `origin` from "agent" to "agent_promoted". A guard
 * that admits only "agent" therefore stops recognising the pack the moment the user promotes it —
 * regenerate the same window and the replay guard misses, inserting a DUPLICATE row, and every
 * regeneration after that inserts another. The row is still this rail's own artifact; promotion is
 * a trust decision the user took about it, not a change of authorship.
 *
 * `.take()` + `.find()` rather than `.first()` for the same reason one step out: `.first()` returns
 * whatever the index orders first, so ONE foreign row sharing the hash would mask ours and re-arm
 * the same duplicate loop. ponytail: `DUP_SCAN` is 8 because rows sharing one tenant's sha-256 are
 * genuine byte-identical duplicates and the vault's own upload/paste paths already refuse to add a
 * second one (`vault.ts:181`, `vault.ts:259`). Upgrade path if a group ever exceeds it: a
 * `by_tenant_origin_contentHash` index, which makes the range itself the filter.
 *
 * ponytail: the replay key is the CONTENT, so two requests with different `untilMs` are two
 * different reports by definition and land as two rows. That is correct — but it means the caller
 * must pass ONE resolved absolute window per page render, or a live "now" upper bound fills the
 * vault with near-duplicate packs. Upgrade path if that ever stops being true: a per-request
 * idempotency column, not a widening of this key.
 */
export const landPack = internalMutation({
  args: {
    tenantId: v.string(),
    title: v.string(),
    markdown: v.string(),
    contentHash: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args): Promise<{ vaultDocId: Id<"vaultDocuments">; replayed: boolean }> => {
    const sameHash = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant_contentHash", (q) =>
        q.eq("tenantId", args.tenantId).eq("contentHash", args.contentHash),
      )
      .take(DUP_SCAN);
    const dup = sameHash.find(
      (r) => r.storageId !== undefined && (r.origin === "agent" || r.origin === "agent_promoted"),
    );
    if (dup) {
      return { vaultDocId: dup._id, replayed: true };
    }

    // `insertCreatedDoc` UNCHANGED — the one governed created-artifact door. It writes
    // `origin: "agent"`, `status: "ready"`, `mimeType: "text/markdown"` (the artifact of record)
    // and `storedMimeType: "application/pdf"` (the bytes), and it does NOT call `startIngest`.
    // Non-groundability is that ABSENT call, never an origin predicate in retrieval.
    const vaultDocId: Id<"vaultDocuments"> = await ctx.runMutation(
      internal.vault.insertCreatedDoc,
      {
        tenantId: args.tenantId,
        title: args.title,
        form: "long",
        markdown: args.markdown,
        contentHash: args.contentHash,
        storageId: args.storageId,
      },
    );
    return { vaultDocId, replayed: false };
  },
});
