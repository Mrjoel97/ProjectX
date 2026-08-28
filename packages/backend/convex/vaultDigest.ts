// The folder digest (VALT-08/09/10) — one folder synthesised into ONE vault document, plus the
// exact folder-scoped staleness diff that drives the Rebuild banner.
//
// DEFAULT-runtime (V8) module — NO `"use node"` directive: llm.ts is the ONE node module and a
// second re-triggers the TS `internal`-graph circular-inference cliff (02-06). Every exported
// handler carries an EXPLICIT `Promise<...>` return type for the same reason (vaultLlm.ts:3-7).
//
// ⚠ THE SINGLE MOST MISREADABLE FACT IN THIS FEATURE. `origin: "folder_digest"` is INERT. There is
// NO `origin` predicate anywhere in retrieval — the `origin: "agent"` exclusion works by the ABSENT
// `startIngest` call (`vault.ts:950-999`), not by a filter. The digest is groundable ONLY because
// `writeDigest` calls `startIngest`. Delete that call and the feature is silently dead WITH EVERY
// ORIGIN-LITERAL ASSERTION STILL GREEN. The observable check is `ragEntryId != null`.
//
// RECURSION GUARD, and the shape is chosen rather than open: the digest carries **NO `folderId`**;
// the folder points at it via `digestDocId`. A digest therefore cannot enter a member-set query at
// all, so no predicate is needed anywhere — and `vault.countTerminal` (gated on `before.folderId`)
// can never bump its own folder's `terminalCount` past `memberCount` when the digest's own ingest
// completes. Two independent reasons, one absent field.
//
// §5: the prompt loads from the skill registry (`folder-digest`) and fails closed when unseeded —
// never hardcoded. §4: the assembled manifest is scanned (fail-closed) BEFORE the model call.
// A `SMOKE::digest::` sentinel in the FOLDER NAME returns a deterministic fixture with NO model
// call (the offline convex-test path). Never in the prompt — see the seam note below.
import { FOLDER_DIGEST_SKILL } from "@pikar/contracts/skill";
import { DEFAULT_MODEL, priceUsage } from "@pikar/cost";
import { scanText } from "@pikar/pii";
import {
  capGraphText,
  categoryFor,
  VAULT_FOLDER_MEMBER_BATCH,
  VAULT_GRID_READ_BUDGET_BYTES,
} from "@pikar/vault";
import { generateText } from "ai";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { resolveModel } from "./lib/models";
import { startIngest } from "./vaultIngest";

// Per-call wall-clock ceiling + one retry budget (mirrors llm.ts / vaultLlm.ts).
const CALL_TIMEOUT_MS = 45_000;

/** The excerpt budget. Mirrors `vaultGround.ts:29-30`'s PER_DOC_CHAR_CAP / TOTAL_CHAR_CAP, which
 *  are module-private `const`s there and therefore cannot be imported. Same numbers, same job: cap
 *  each member so one large document cannot swamp the prompt, and cap the total so a 300-member
 *  folder never blows the model's context. */
const DIGEST_PER_DOC_CHARS = 1500;
const DIGEST_TOTAL_CHARS = 8000;

const DIGEST_KIND = "folder_digest";

// ── Types ────────────────────────────────────────────────────────────────────

/** What the synthesis reads about ONE member. Projected metadata + a BOUNDED head slice — never
 *  the whole `text` (schema.ts:887-890: ~40 max-size member rows exhaust the 16 MiB read cap, on
 *  the very feature that is supposed to make a big folder usable). */
type MemberMeta = {
  docId: string;
  title: string;
  kind: string;
  /** ABSENT ⇒ never classified, which is semantically DISTINCT from `"unclassified"` (classified
   *  and unplaceable) — schema.ts:900. The manifest renders the two differently; do not collapse. */
  docType?: string;
  identityLine?: string;
  status: string;
  failureReason?: string;
  size: number;
  createdAt: number;
  excerpt?: string;
};

type MembersPage = {
  members: MemberMeta[];
  cursor: string;
  isDone: boolean;
  usedChars: number;
};

type BuildDigestResult =
  | {
      ok: false;
      reason:
        | "no_folder"
        | "not_complete"
        | "already_built"
        | "kill_switch"
        | "daily_budget_exhausted"
        | "deployment_budget_exhausted";
    }
  | {
      ok: true;
      docId: Id<"vaultDocuments">;
      memberCount: number;
      unreadableCount: number;
    };

/** The drill-in banner's one read. `unincorporatedCount` rides along so the banner needs no second
 *  round-trip (the `blueprintState` pattern). */
type FolderDigestState = {
  state: "none" | "fresh" | "stale";
  unincorporatedCount: number;
};

// ── Prompt assembly (pure) ───────────────────────────────────────────────────

const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * folder name + one numbered `[#n]` block per member + the bounded excerpts, exactly as the
 * `folder-digest` skill body describes its inputs. System-supplied facts only — the model gets no
 * field the database did not write.
 */
function digestPrompt(folderName: string, members: readonly MemberMeta[]): string {
  const blocks = members.map((m, i) =>
    [
      `[#${i}] ${m.title}`,
      `  kind: ${m.kind} | docType: ${m.docType ?? "not classified"} | status: ${m.status}`,
      `  identity: ${m.identityLine ?? "(none recorded)"}`,
      `  size: ${m.size} bytes | created: ${isoDate(m.createdAt)}`,
      // Part 3 of the output contract is only answerable if the manifest carries the reason.
      m.status === "ready" ? "" : `  could not be read: ${m.failureReason ?? m.status}`,
    ]
      .filter((line) => line !== "")
      .join("\n"),
  );
  const excerpts = members
    .map((m, i) => (m.excerpt ? `[#${i}] ${m.title}\n${m.excerpt}` : ""))
    .filter((block) => block !== "");
  return [
    `folder: ${folderName}`,
    "",
    `manifest (${members.length} member(s)):`,
    blocks.join("\n\n"),
    "",
    excerpts.length === 0
      ? "excerpts: none — no member of this folder had readable text."
      : `excerpts (head slices, truncated):\n\n${excerpts.join("\n\n")}`,
  ].join("\n");
}

// ── Offline SMOKE seam ───────────────────────────────────────────────────────
// convex-test and a dev-deployment smoke must drive synthesis deterministically and offline (no
// model credentials on the local backend).
//
// ⚠ THE SENTINEL IS MATCHED AGAINST THE FOLDER NAME ONLY, NEVER THE ASSEMBLED PROMPT. It used to
// be `.includes` over the whole prompt (blueprint.ts's variant), which meant it could ride in any
// member TITLE or any member's TEXT — and members are ingested Drive files and email, i.e. text a
// third party authors. One document containing this string was enough to make a real folder's
// digest a FIXTURE: the stored vault artifact, the thing the tenant then reads and grounds on,
// silently stops being synthesis. The folder name is the tenant's own, chosen when the folder is
// created, and it still reaches this point for the case the prompt match existed for — a folder
// whose only member FAILED contributes no excerpt at all.
// ponytail: content sentinel on ONE tenant-owned field, not an env flag — keeps the seam
// per-request and out of shared deployment config. Remove once a mock-model vault smoke exists.
const SMOKE_DIGEST_PREFIX = "SMOKE::digest::";

/**
 * The offline digest. Deterministic, derived from the SAME projected metadata the real prompt
 * carries, and it honours all three contract sections — part 3 in particular names every non-ready
 * member with its reason, so the offline path can prove the honest-manifest promise.
 *
 * ⚠ IT MUST START WITH `SMOKE::graph::`. This text becomes a vault document, and that document's
 * OWN ingest runs `vaultRag.embedDoc` (free on any `SMOKE::` prefix) and `vaultLlm.extractGraph`,
 * whose only free path is `safeText.startsWith("SMOKE::graph::")` at position 0. Drop the prefix
 * and every offline folder smoke starts paying for a real embedding + a real extraction call.
 */
function smokeDigestFixture(folderName: string, members: readonly MemberMeta[]): string {
  const unread = members.filter((m) => m.status !== "ready");
  return [
    `SMOKE::graph::${folderName}|folder digest|digest_of`,
    "",
    "## What this folder is",
    `${members.length} document(s) in "${folderName}".`,
    ...members.map((m) => `- ${m.title} — ${m.identityLine ?? m.kind}`),
    "",
    "## What it says",
    "(offline fixture — no synthesis was performed)",
    "",
    "## What could not be read",
    unread.length === 0
      ? "Every document in this folder was read."
      : unread.map((m) => `- ${m.title} — ${m.failureReason ?? m.status}`).join("\n"),
  ].join("\n");
}

// ── Reads the synthesis needs (actions cannot touch ctx.db) ──────────────────

/** The guard read. Refs and scalars only — never a member, never any text. */
export const folderForDigest = internalQuery({
  args: { tenantId: v.string(), folderId: v.id("vaultFolders") },
  handler: async (
    ctx,
    { tenantId, folderId },
  ): Promise<{ name: string; status: string; digestBuiltAt?: number } | null> => {
    const folder = await ctx.db.get(folderId);
    if (!folder || folder.tenantId !== tenantId) return null; // the lenient join, and the tenant guard
    return { name: folder.name, status: folder.status, digestBuiltAt: folder.digestBuiltAt };
  },
});

/**
 * ONE bounded page of a folder's members, projected down to metadata + a head slice.
 *
 * PAGINATED, and that is the whole point: Convex has no projection, so reading a member reads its
 * whole row including a `text` blob of up to 400k chars — ~40 max-size rows exhaust the 16 MiB
 * per-transaction read cap. A `.collect()` here would fault on exactly the 300-member folder the
 * digest exists to make usable. One page = one transaction; the ACTION loops the cursor and keeps
 * only this projection, so its own memory stays bounded by the char budget below.
 *
 * `remainingChars` is the running-total half of the budget (`vaultGround.ts:187-212`): the action
 * carries the total spent across pages, this query spends what is left of it.
 */
export const digestMembersPage = internalQuery({
  args: {
    tenantId: v.string(),
    folderId: v.id("vaultFolders"),
    cursor: v.union(v.string(), v.null()),
    remainingChars: v.number(),
  },
  handler: async (ctx, { tenantId, folderId, cursor, remainingChars }): Promise<MembersPage> => {
    const page = await ctx.db
      .query("vaultDocuments")
      .withIndex("by_tenant_folder", (q) => q.eq("tenantId", tenantId).eq("folderId", folderId))
      .paginate({ cursor, numItems: VAULT_FOLDER_MEMBER_BATCH });

    let used = 0;
    const members: MemberMeta[] = page.page.map((doc) => {
      const remaining = remainingChars - used;
      // Excerpt ONLY for a readable member, and only while budget remains. A member with no
      // excerpt still appears in the manifest — parts 1 and 3 are metadata-only by design.
      const excerpt =
        doc.status === "ready" && doc.text && remaining > 0
          ? doc.text.slice(0, Math.min(DIGEST_PER_DOC_CHARS, remaining))
          : undefined;
      if (excerpt) used += excerpt.length;
      return {
        docId: doc._id,
        title: doc.title,
        kind: doc.kind,
        docType: doc.docType,
        identityLine: doc.identityLine,
        status: doc.status,
        failureReason: doc.failureReason,
        size: doc.size,
        createdAt: doc.createdAt,
        excerpt,
      };
    });

    return { members, cursor: page.continueCursor, isDone: page.isDone, usedChars: used };
  },
});

// ── The synthesis ────────────────────────────────────────────────────────────

/**
 * Synthesise ONE completed folder into ONE vault document.
 *
 * Scheduled from `vaultFolders.tryComplete` (auto) and from `rebuildDigest` (the user's click).
 * `tenantId` is an EXPLICIT arg because a scheduled function has no identity.
 *
 * ⚠ IT OBSERVES THE FOLDER AS `complete`, NEVER `ingesting`. `tryComplete`'s three steps are the
 * order of STATEMENTS in one transaction; this action is a `scheduler.runAfter(0, …)` and by
 * definition runs after that transaction commits — i.e. after the flip AND after
 * `guardrails.settleFolder` has already zeroed the reservation.
 */
export const buildFolderDigest = internalAction({
  args: {
    tenantId: v.string(),
    folderId: v.id("vaultFolders"),
    /** The user's Rebuild click. Absent ⇒ the automatic first build, which refuses to run twice. */
    rebuild: v.optional(v.boolean()),
  },
  handler: async (ctx, { tenantId, folderId, rebuild }): Promise<BuildDigestResult> => {
    // FIN-01 replay identity, MINTED not derived. `folderId` alone is TOO COARSE by design:
    // Rebuild is deliberately "the only way to spend twice" (the `already_built` belt below waves
    // `rebuild: true` through), so two clicks on one folder are two real `generateText` calls —
    // and an action re-entry after a mid-flight failure is a third. A folder-scoped constant would
    // collapse every rebuild after the first onto one `actual` row and leave the ledger BELOW the
    // limiter, the unrecoverable direction. Exactly one model call per run, so `runId` alone
    // separates run N from run N+1; `folderId` rides along as a typed ref instead.
    const runId = crypto.randomUUID();
    // Load the digest prompt FIRST — before the offline seam, deliberately (blueprint.ts:245-246):
    // an unseeded deployment must never synthesise from a hardcoded fallback, and the SMOKE path
    // has to exercise the registry too or the seam hides an unseeded backend. Throws
    // NO_ACTIVE_SKILL when there is no active row (§5, fail-closed) — do not catch it.
    const skill: { body: string; version: number } = await ctx.runQuery(
      internal.skills.getActiveSkill,
      { name: FOLDER_DIGEST_SKILL },
    );

    const folder = await ctx.runQuery(internal.vaultDigest.folderForDigest, {
      tenantId,
      folderId,
    });
    if (!folder) return { ok: false, reason: "no_folder" };
    if (folder.status !== "complete") return { ok: false, reason: "not_complete" };
    // Idempotency for the AUTO path only. `tryComplete`'s status CAS already makes it fire once per
    // folder; this is the second belt, and it is what makes Rebuild the only way to spend twice.
    if (folder.digestBuiltAt !== undefined && rebuild !== true) {
      return { ok: false, reason: "already_built" };
    }

    // Gather EVERY member (part 3 must name every unread one, so the manifest cannot be truncated)
    // while the per-transaction read stays bounded — one page per transaction, cursor in the action.
    const members: MemberMeta[] = [];
    let cursor: string | null = null;
    let usedChars = 0;
    for (;;) {
      const page: MembersPage = await ctx.runQuery(internal.vaultDigest.digestMembersPage, {
        tenantId,
        folderId,
        cursor,
        remainingChars: Math.max(0, DIGEST_TOTAL_CHARS - usedChars),
      });
      members.push(...page.members);
      usedChars += page.usedChars;
      if (page.isDone) break;
      cursor = page.cursor;
    }

    // The digest is FOLDER work, so it is gated and priced on the INGEST rail (15.3-03's selector)
    // — it must not eat the cockpit's $5 token window.
    // NO `reserved: true`, on purpose: by the time this runs `settleFolder` has already zeroed
    // `reservedCents`, so `reserved` would wave the call through on the kill switch alone with no
    // money behind it (guardrails.ts:294-298). This is ONE small call; it can afford the honest
    // two-window ingest check. A refusal is a governed STOP — a typed return, never a throw.
    const gate = await ctx.runMutation(internal.guardrails.preCall, { tenantId, rail: "ingest" });
    if (!gate.ok) {
      // ⚠ THE ONLY REFUSAL ON THIS PATH THAT NOBODY WOULD OTHERWISE SEE, so it is the only one
      // that is audited. `buildFolderDigest` is reached by `scheduler.runAfter` from `tryComplete`,
      // which discards the return value — there is no caller to hand a typed refusal to. The other
      // `ok: false` reasons are self-evident from the folder row (`no_folder`, `not_complete`,
      // `already_built`); this one leaves NO trace anywhere: `digestBuiltAt` is never set, so the
      // `already_built` belt does not apply and nothing retries, and the folder reads `complete`
      // with `digestDocId` undefined — indistinguishable from a digest that was never attempted.
      // A large folder that just drained the ingest window it does NOT hold a reservation against
      // (see the `reserved` note above) lands exactly here. Refs and ids only (§4).
      await ctx.runMutation(internal.audit.log, {
        tenantId,
        correlationId: folderId,
        eventType: "folder.digest_refused",
        actor: "system",
        payload: { folderId, reason: gate.reason, memberCount: members.length },
      });
      return { ok: false, reason: gate.reason };
    }

    // Redact BEFORE the model call (§4), fail CLOSED. The manifest carries titles and identity
    // lines and the excerpts carry document text — both are user content.
    const scan = scanText(digestPrompt(folder.name, members));
    if (!scan.ok) throw new Error("vaultDigest: folder-digest scan failed");
    const safePrompt = scan.value.safeText;

    let markdown: string;
    if (folder.name.includes(SMOKE_DIGEST_PREFIX)) {
      markdown = smokeDigestFixture(folder.name, members);
    } else {
      // `generateText`, not `generateObject`: the contract's three sections ARE markdown headings,
      // and the artifact stored in the vault is one markdown document (vaultExtract.ts:119-124).
      // `capGraphText` is the OUTER guard only — the per-member budget above is what actually
      // bounds this string.
      const { text, usage } = await generateText({
        model: resolveModel(DEFAULT_MODEL),
        system: skill.body,
        prompt: capGraphText(safePrompt),
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        maxRetries: 1,
      });
      const priced = priceUsage(DEFAULT_MODEL, usage);
      if (priced.ok) {
        await ctx.runMutation(internal.guardrails.recordSpend, {
          tenantId,
          costUsd: priced.value,
          // `recordSpend` has NO `reserved` param — the rail selector applies regardless, and the
          // digest's real cost must move the ingest window it was priced against.
          rail: "ingest",
          correlationId: `vault:digest:${folderId}:${runId}`,
          model: DEFAULT_MODEL,
          kind: "vault.folder_digest", // code-owned token, refs only (§4)
          folderId,
        });
      }
      markdown = text;
    }

    // The source set is exactly the READY members — which is what makes staleness meaningful: a
    // member that was failed at completion and later succeeds (`vaultSweep.retryExtraction`, the
    // only shipped way a complete folder gains a ready member) lands OUTSIDE this set.
    const sourceDocIds = members.filter((m) => m.status === "ready").map((m) => m.docId);
    const docId = await ctx.runMutation(internal.vaultDigest.writeDigest, {
      tenantId,
      folderId,
      markdown,
      sourceDocIds,
    });
    if (docId === null) return { ok: false, reason: "no_folder" }; // cancelled mid-synthesis
    return {
      ok: true,
      docId,
      memberCount: members.length,
      unreadableCount: members.length - sourceDocIds.length,
    };
  },
});

/**
 * Land the digest as a vault document AND START ITS INGEST, then point the folder at it — all in
 * ONE transaction, so a folder can never record a digest it does not have.
 *
 * The first build INSERTS; a rebuild PATCHES the row the folder already points at (the
 * `confirmBlueprint` shape) rather than inserting a second one — two digest documents for one
 * folder would both be groundable, and the stale one would keep answering.
 */
export const writeDigest = internalMutation({
  args: {
    tenantId: v.string(),
    folderId: v.id("vaultFolders"),
    markdown: v.string(),
    sourceDocIds: v.array(v.string()),
  },
  handler: async (
    ctx,
    { tenantId, folderId, markdown, sourceDocIds },
  ): Promise<Id<"vaultDocuments"> | null> => {
    const folder = await ctx.db.get(folderId);
    if (!folder || folder.tenantId !== tenantId) return null; // cancelled, or a foreign id

    const title = `Folder digest: ${folder.name}`.slice(0, 120);
    const size = new TextEncoder().encode(markdown).length;
    const hash = await contentHash(markdown);
    const pointed = folder.digestDocId ? await ctx.db.get(folder.digestDocId) : null;

    let vaultDocId: Id<"vaultDocuments">;
    if (pointed && pointed.tenantId === tenantId && pointed.kind === DIGEST_KIND) {
      // ponytail: the previous digest's rag chunks are NOT deleted. `rag.add` keys on
      // `contentHash`, so a rebuild writes a NEW entry and the old one survives under the old key,
      // still mapping (via `metadata.vaultDocId`) to this same row — retrieval can therefore
      // surface a stale PASSAGE of a fresh document. Ceiling accepted because the fix
      // (`rag.deleteAsync`, the `vault.deleteVaultDoc` precedent) drags the rag component into
      // every offline rebuild test. Upgrade path: delete by `pointed.ragEntryId` here.
      await ctx.db.patch(pointed._id, {
        title,
        text: markdown,
        contentHash: hash,
        size,
        status: "processing",
        failureReason: undefined,
      });
      vaultDocId = pointed._id;
    } else {
      vaultDocId = await ctx.db.insert("vaultDocuments", {
        tenantId,
        title,
        kind: DIGEST_KIND, // the queryable class marker (`kind` is v.string() — no schema change)
        category: categoryFor({ source: "agent" }), // → "workspace-docs", like every generated doc
        source: "agent",
        mimeType: "text/markdown", // in SEARCHABLE_MIME ⇒ chunked + embedded + graph-extracted
        size,
        contentHash: hash,
        text: markdown,
        status: "processing",
        // INERT. It excludes nothing and includes nothing — see this module's header. Kept because
        // schema.ts declares it and it is the human-readable provenance marker.
        origin: "folder_digest",
        // NO `folderId`. THE recursion guard — see this module's header.
        createdAt: Date.now(),
      });
    }

    // ⚠⚠ THIS CALL IS THE ONLY REASON THE DIGEST IS GROUNDABLE AT ALL. `origin: "folder_digest"`
    // above is inert; there is no origin predicate in retrieval. Ingest is what embeds the text
    // and hands the row its `ragEntryId`. DELETE THIS LINE AND EVERY ORIGIN-LITERAL ASSERTION
    // STAYS GREEN WHILE THE FEATURE IS SILENTLY DEAD — the observable check is `ragEntryId != null`.
    // `correlationId` is the FOLDER ID, not a fresh uuid: it is the lineage key that joins this
    // ingest to the folder that caused it. `rail: "ingest"` because the digest is folder work; no
    // `reserved` — the folder's reservation was settled before this action was ever scheduled.
    await startIngest(ctx, {
      vaultDocId,
      tenantId,
      correlationId: folderId,
      rail: "ingest",
    });

    // The doc id, the source list and the stamp move together, in the same transaction as the
    // insert (the `confirmBlueprint` rewrite). A field-for-field clone of the blueprint trio —
    // schema.ts decision 3 forbids renaming them. `digestSourceDocIds` is `v.array(v.string())`.
    await ctx.db.patch(folderId, {
      digestDocId: vaultDocId,
      digestSourceDocIds: sourceDocIds,
      digestBuiltAt: Date.now(),
    });
    return vaultDocId;
  },
});

// ── Staleness (VALT-10) ──────────────────────────────────────────────────────

/**
 * The folder-scoped set difference: `ready` members whose id is not in the set the digest was
 * built from. A pure diff — no detector, no cron (`blueprint.unincorporatedFor`'s shape).
 *
 * ⚠ BOUNDED BY THE FOLDER'S OWN `memberCount`, NEVER by blueprint's global `DRIFT_SCAN_CAP = 100`
 * (which is module-private there and cannot be imported anyway). Cloning `.take(100)` onto a
 * 300-member folder inspects an arbitrary hundred and can report 0 stale while dozens are — the
 * banner then silently never fires, which is the failure mode this bound exists to prevent.
 * `+ 1` over-fetches by one so an over-long member set is observable rather than silently exact.
 *
 * No `sealedIn` filter: sealing applies while a folder is `ingesting`, and a folder with a digest
 * is `complete`. No self-exclusion predicate either — the digest carries no `folderId`, so it is
 * structurally outside this query. That absence IS the guard.
 *
 * ⚠ THE ROW BOUND IS NOT A READ BOUND, AND THAT IS THE LESSON 15.3-02 ALREADY PAID FOR. Convex has
 * NO projection — reading a row reads the whole row, including a `text` blob of up to
 * VAULT_EXTRACT_CHAR_CAP (400,000) chars (schema.ts:887-890). `.take(memberCount + 1)` bounds ROWS
 * only, so a 300-member folder of max-size documents reads ~120 MB against a 16 MiB
 * per-transaction cap — 7.5× over. And this runs inside `folderDigestState`, the drill-in BANNER
 * read, so the failure mode is not a wrong number, it is **the folder page throwing**. That is the
 * exact defect `readVaultPage` exists to prevent, on the exact same index, so this streams the same
 * way: stop on whichever bites first, rows or VAULT_GRID_READ_BUDGET_BYTES of text.
 *
 * NEWEST-FIRST (`.order("desc")`) is what keeps the byte bound honest rather than merely safe.
 * Unincorporated members are, by construction, the ones added SINCE the last build — so they sort
 * to the front and a scan that stops early has already seen them. The residual, stated: a member
 * rescued `failed → ready` by `vaultSweep.retryExtraction` is newly unincorporated but OLD by
 * `_creationTime`, so in a folder whose text exceeds the byte budget it can be missed until the
 * next build. Under-reporting a rescued member is a stale banner; throwing is a dead page.
 *
 * ponytail: a bounded diff, not a counter. Upgrade path (the same one `blueprint.unincorporatedFor`
 * names): maintain a count on `vaultFolders`, bumped when a member reaches `ready` outside the
 * source set, and read that instead of diffing — exact and O(1), but it needs a schema field and
 * `schema.ts` is closed for this phase (15.3-01).
 */
async function unincorporatedForFolder(
  ctx: QueryCtx,
  folder: Doc<"vaultFolders">,
): Promise<{ count: number; docIds: string[] }> {
  const sourceSet = new Set(folder.digestSourceDocIds ?? []);
  const stream = ctx.db
    .query("vaultDocuments")
    .withIndex("by_tenant_folder", (q) =>
      q.eq("tenantId", folder.tenantId).eq("folderId", folder._id),
    )
    .order("desc");

  const docIds: string[] = [];
  let rows = 0;
  let textBytes = 0;
  for await (const doc of stream) {
    if (rows >= folder.memberCount + 1 || textBytes >= VAULT_GRID_READ_BUDGET_BYTES) break;
    rows++;
    textBytes += doc.text?.length ?? 0;
    if (doc.status === "ready" && !sourceSet.has(doc._id)) docIds.push(doc._id);
  }
  return { count: docIds.length, docIds };
}

/**
 * The drill-in's one read for the digest surface (the `blueprintState` pattern). A folder that has
 * no digest is `none`; one whose members have all been synthesised is `fresh`; one that has gained
 * a `ready` member since is `stale` — and NOTHING here costs a cent. The rebuild is the user's
 * click, never a reaction to this read.
 */
export const folderDigestState = tenantQuery({
  args: { folderId: v.id("vaultFolders") },
  handler: async (ctx, { folderId }): Promise<FolderDigestState> => {
    const folder = await ctx.db.get(folderId);
    // The lenient join + the tenant guard, exactly as `getFolder` makes them.
    if (!folder || folder.tenantId !== ctx.tenantId || folder.digestDocId === undefined) {
      return { state: "none", unincorporatedCount: 0 };
    }
    const { count } = await unincorporatedForFolder(ctx, folder);
    return { state: count > 0 ? "stale" : "fresh", unincorporatedCount: count };
  },
});

/**
 * Rebuild on the user's click. A MUTATION that SCHEDULES the action — a mutation cannot run one,
 * and every cross-plane hand-off in the folder plane is a `scheduler.runAfter(0, internal.*)`.
 *
 * This and `vaultFolders.tryComplete` are the ONLY two things that schedule `buildFolderDigest`,
 * which is what "no model call fires until the user clicks" means structurally: staleness is a
 * pure read, and nothing reacts to it.
 */
export const rebuildDigest = tenantMutation({
  args: { folderId: v.id("vaultFolders") },
  handler: async (ctx, { folderId }): Promise<{ ok: boolean }> => {
    const folder = await ctx.db.get(folderId);
    if (!folder || folder.tenantId !== ctx.tenantId) return { ok: false };
    // Only a completed folder can be re-synthesised: an `ingesting` one is still sealed and its
    // automatic build has not happened yet, and a `reserving`/`refused` one has nothing to say.
    if (folder.status !== "complete") return { ok: false };
    await ctx.scheduler.runAfter(0, internal.vaultDigest.buildFolderDigest, {
      tenantId: ctx.tenantId,
      folderId,
      rebuild: true,
    });
    return { ok: true };
  },
});
