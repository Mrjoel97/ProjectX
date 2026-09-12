// Insert-only audit module (OPSG-02).
//
// This is the SOLE write surface for the `audit` table. It exposes ONLY an
// insert (`internalMutation`) — no patch/replace/delete functions exist here,
// and no public (client-callable) builder writes `audit`. Immutability is
// enforced by this convention plus the static-scan test (auditImmutability.test.ts);
// true WORM retention lives outside Convex via the scheduled S3 export.
//
// `payload` is redaction-safe (refs/hashes/ids/counts only — see AuditPayload /
// CLAUDE.md rule 4). Redaction must happen BEFORE calling log().

import type { AuditPayload } from "@pikar/contracts/audit";
import { classifyPayload } from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { auditCounts } from "./aggregates";
import { migrations } from "./migrations";

/** Reserved owner control plane, never an authenticated user's tenant or an eval purge prefix. */
export const VERTICAL_EVAL_AUDIT_NAMESPACE = "control:vertical-eval-evidence:v1";
export const VERTICAL_EVAL_EVENT_PREFIX = "vertical_evidence.";

/** Code-only append primitive. Generic RPC writers cannot mint reserved evidence receipts. */
export async function appendAudit(
  ctx: MutationCtx,
  args: {
    tenantId: string;
    correlationId: string;
    eventType: string;
    actor: string;
    payload: AuditPayload;
  },
) {
  const id = await ctx.db.insert("audit", { ...args, ts: Date.now(), exportVersion: 2 });
  await ctx.db.insert("auditExportQueue", { auditId: id });
  const doc = await ctx.db.get(id);
  if (doc) await auditCounts.insert(ctx, doc);
  return id;
}

export const log = internalMutation({
  args: {
    tenantId: v.string(),
    correlationId: v.string(),
    eventType: v.string(),
    actor: v.string(),
    // v.any() at the Convex boundary; the redaction-safe shape is the AuditPayload
    // contract (enforced upstream at redact-then-write time).
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    if (
      args.tenantId === VERTICAL_EVAL_AUDIT_NAMESPACE ||
      args.eventType.startsWith(VERTICAL_EVAL_EVENT_PREFIX)
    )
      throw new Error("RESERVED_EVIDENCE_NAMESPACE");
    await appendAudit(ctx, args);
  },
});

// OPSG-01 read side: count a tenant's audit rows in O(log n) — never a .collect() scan.
export const countAudit = internalQuery({
  args: { tenantId: v.string() },
  handler: async (ctx, { tenantId }) => auditCounts.count(ctx, { namespace: tenantId }),
});

/**
 * The most recent audit payloads of ONE `eventType`, newest first — the read side of a diagnosis.
 *
 * Exists because the counts written on a refusal path had no reader. `dispatch.deckTokenCounts`
 * puts five numbers beside `media.deck_refused` precisely so a `no_deck` / `bad_target_duration`
 * can be told apart from its twin cause after the fact — but the specialist's raw body is never
 * persisted on that path (`landStoryboardRefusal` stores the COMPOSED refusal, not the model's
 * prose), so those numbers ARE the whole evidence, and until now the only way to reach them was a
 * browser session against the deployment. One `npx convex run --prod` now answers it:
 *
 *   npx convex run --prod audit:recentByType '{"eventType":"media.deck_refused"}'
 *
 * CROSS-TENANT on purpose, and that is the point rather than an oversight: `by_ts` is already the
 * named cross-tenant exception in `isolation.test.ts` ("a named internal/owner-plane consumer with
 * no tenant-facing caller"), and this is one — `internalQuery`, never client-callable. A
 * tenant-scoped variant would make the owner look up a tenantId first, which is the browser
 * session this replaces.
 *
 * Returning `payload` verbatim needs no redaction step, and that is CLAUDE.md §4 paying out: the
 * table's contract is refs/hashes/ids/counts ONLY, enforced redact-then-WRITE. If a payload ever
 * carried content, this query would not be the bug.
 *
 * ponytail: the `sinceMs` window is the scan bound, NOT `limit`. Convex's `.filter()` post-filters
 * the index range, so with a rare eventType `.take()` alone would walk the table backwards to the
 * first row. Ceiling: fine while a window holds a beta's worth of rows. Upgrade path if it stops
 * being: a `by_eventType_ts` index, which makes the range itself the filter.
 */
export const recentByType = internalQuery({
  args: {
    eventType: v.string(),
    /** Epoch ms; only rows strictly newer are considered. Defaults to the last 7 days. */
    sinceMs: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { eventType, sinceMs, limit }) => {
    const since = sinceMs ?? Date.now() - 7 * 24 * 60 * 60 * 1000;
    const rows = await ctx.db
      .query("audit")
      .withIndex("by_ts", (q) => q.gt("ts", since))
      .order("desc")
      .filter((q) => q.eq(q.field("eventType"), eventType))
      .take(Math.min(limit ?? 20, 100));
    // tenantId rides along: an id is §4-clean, and without it a cross-tenant read cannot say whose
    // run refused. `actor` and `eventType` are dropped — the caller already knows both.
    return rows.map((r) => ({
      ts: r.ts,
      tenantId: r.tenantId,
      correlationId: r.correlationId,
      payload: r.payload,
    }));
  },
});

/**
 * ADR-044 T3 — THE §4 CHECK THAT READS ROWS INSTEAD OF SOURCE.
 *
 * Every §4 guard in this repo scans SOURCE. ADR-044 says that is not enough and says why: "every
 * latent §4 defect in the history becomes permanent on arming day, and a source scan cannot see a
 * single already-written row. The honest check reads rows, not code." `recentByType` above states
 * the same assumption from the other side — "if a payload ever carried content, this query would
 * not be the bug" — and that is the claim nobody had tested until this query existed.
 *
 * THE CLASSIFICATION HAPPENS HERE, INSIDE THE DEPLOYMENT, AND VALUES NEVER CROSS THE WIRE. What
 * comes back is a field PATH, a code-owned reason, a count, and a redacted fingerprint (length and
 * character classes). A checker that shipped suspected PII to a terminal, a CI log or an agent
 * transcript would have moved the leak rather than found it — so it cannot, by construction.
 *
 * FINDINGS ARE AGGREGATED by (eventType, path, reason). 672 rows sharing one defect are one line,
 * not 672: a report nobody reads is a check nobody runs. `count` is how many rows hit it.
 *
 * BOTH §4 TABLES, one query. `deadLetters.payload` carries the same contract as `audit.payload`,
 * and a second near-identical query is a second place to forget a table.
 *
 * ponytail: paginated rather than `.collect()`. Ceiling — the caller drives the cursor to the end;
 * a partial walk reports a partial answer and says so via `isDone`. Upgrade path if the log ever
 * outgrows an operator loop: an aggregate keyed by the finding, written at insert.
 */
export const payloadShapes = internalQuery({
  args: {
    table: v.union(v.literal("audit"), v.literal("deadLetters")),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { table, cursor, limit }) => {
    const page = await ctx.db
      .query(table)
      .paginate({ cursor: cursor ?? null, numItems: Math.min(limit ?? 200, 500) });

    /** key -> aggregated finding. The key is what makes 672 rows one line. */
    const agg = new Map<
      string,
      {
        kind: string;
        path: string;
        verdict: string;
        reason: string;
        count: number;
        fingerprint?: string;
      }
    >();

    for (const row of page.page) {
      // `eventType` on audit, `error` class on deadLetters — both code-owned literals, §4-clean,
      // and both answer "which writer produced this?" which is the only question a finding raises.
      const kind =
        table === "audit"
          ? ((row as { eventType?: string }).eventType ?? "(none)")
          : ((row as { source?: string }).source ?? "workflow");
      for (const f of classifyPayload((row as { payload?: unknown }).payload)) {
        const key = `${kind}|${f.path}|${f.reason}`;
        const hit = agg.get(key);
        if (hit) {
          hit.count += 1;
          continue;
        }
        agg.set(key, {
          kind,
          path: f.path,
          verdict: f.verdict,
          reason: f.reason,
          count: 1,
          fingerprint: f.fingerprint,
        });
      }
    }

    return {
      scanned: page.page.length,
      isDone: page.isDone,
      cursor: page.continueCursor,
      // Worst first, then loudest: an operator reads the top of this list and stops.
      findings: [...agg.values()].sort(
        (a, b) =>
          (a.verdict === b.verdict
            ? 0
            : a.verdict === "violation"
              ? -1
              : b.verdict === "violation"
                ? 1
                : 0) || b.count - a.count,
      ),
    };
  },
});

// One-time reconciliation for pre-existing dev rows the aggregate never saw: clear
// then re-insert every audit row so counts match the table. Idempotent.
// 25.3 (G17): the re-insert is a BATCH JOB over `audit`, not a `.collect()` of the whole log. Note
// the window: counts are cleared at once and rebuilt over the following batches, so `count` reads
// are LOW until the walk finishes. This is an operator backfill, run deliberately, never on a cron.
export const reinsertAuditCounts = migrations.define({
  table: "audit",
  batchSize: 200,
  migrateOne: async (ctx, row) => {
    await auditCounts.insert(ctx, row);
  },
});

export const backfillAuditCounts = internalMutation({
  args: {},
  handler: async (ctx) => {
    await auditCounts.clearAll(ctx);
    await migrations.runOne(ctx, internal.audit.reinsertAuditCounts, { reset: true });
  },
});
