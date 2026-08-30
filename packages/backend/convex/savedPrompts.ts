// Pinned prompts — "routine v0" (SKILL-01, 21-05).
//
// A pinned prompt is INERT TENANT-OWNED TEXT. Saving one does nothing; it sits in a row until the
// user presses Run in the workspace, and Run is an ordinary fresh cockpit turn through the browser's
// `useSendCockpitMessage` hook — the same door every typed message uses.
//
// THERE IS DELIBERATELY NO AUTOMATION SUBSTRATE HERE, and none may be added on the strength of the
// word "routine": no `routines` table, no cron, no `ctx.scheduler`, no trigger, no recurrence, no
// next-run timestamp, no execution history, no status machine. The whole point of v0 is to find out
// whether a user re-runs the same prompt twice before any of that is built. `savedPrompts.test.ts`
// scans this file for every one of those words.
//
// The text is CONTENT PLANE: it is the user's own words, stored raw on their own tenant row like
// `plans.body`, and it is NEVER copied into an audit or dead-letter payload (CLAUDE.md §4). Nothing
// here writes an audit event at all — a reversible UI preference is not a governance event, and an
// audit row carrying the prompt would turn the log into the PII honeypot §4 exists to prevent.
//
// ponytail: the four pure helpers below live in this file rather than in `packages/*`. They are
// string trims and a byte count with exactly one caller; a package module for them would be an
// abstraction nobody asked for. Upgrade path: move them to `packages/core` the moment a second
// runtime needs the same normalization.
import { v } from "convex/values";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";

/** UTF-8 BYTES, not characters — a character cap lets one multibyte paste carry ~3x the tokens the
 *  number implies. Conservative on purpose: a pinned prompt is a shortcut, not a document. */
export const SAVED_PROMPT_MAX_BYTES = 4_000;

/** The list is a `take`, not a page. A tenant with more than this many pins sees the newest ones;
 *  a menu that scrolls past twenty entries has stopped being a shortcut anyway. */
export const SAVED_PROMPT_LIST_LIMIT = 20;

/** The menu label only. The TEXT is never truncated — a shortened prompt would replay a different
 *  instruction than the one the user pinned. */
export const SAVED_PROMPT_TITLE_MAX = 80;

/** Fold line endings and trim the OUTSIDE only. Interior blank lines are part of what the user
 *  wrote. This is what both the hash and the stored text are computed from, so a re-pin that
 *  differs by a trailing newline is recognised as the same prompt. */
export function normalizePromptText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").trim();
}

/** A bounded label derived from the first nonblank line — code-derived, never client-supplied. */
export function derivePromptTitle(text: string): string {
  const first =
    text
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? "";
  return first.length <= SAVED_PROMPT_TITLE_MAX
    ? first
    : `${first.slice(0, SAVED_PROMPT_TITLE_MAX - 1)}…`;
}

/**
 * Pin a prompt. Idempotent within one tenant: the same normalized text returns the existing row
 * instead of filling the menu with near-duplicates. Two tenants pinning byte-identical text get
 * two separate rows — the dedupe is scoped, not global.
 *
 * `text` is the ONLY argument. `tenantId`, `title`, `textHash` and `createdAt` are derived
 * server-side, so Convex's arg validator is the refusal boundary: a caller cannot even NAME a
 * field it does not own, and there is no `schedule`, `trigger` or `status` to name in the first
 * place.
 */
export const save = tenantMutation({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const normalized = normalizePromptText(text);
    if (normalized === "") throw new Error("SAVED_PROMPT_EMPTY");
    const bytes = new TextEncoder().encode(normalized).length;
    // The error carries the measured size and the cap — counts, never the text itself (§4).
    if (bytes > SAVED_PROMPT_MAX_BYTES)
      throw new Error(`SAVED_PROMPT_TOO_LONG: ${bytes} > ${SAVED_PROMPT_MAX_BYTES} bytes`);

    const textHash = await contentHash(normalized);
    const existing = await ctx.db
      .query("savedPrompts")
      .withIndex("by_tenant_textHash", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("textHash", textHash),
      )
      .unique();
    if (existing) return { id: existing._id, inserted: false as const };

    const id = await ctx.db.insert("savedPrompts", {
      tenantId: ctx.tenantId,
      text: normalized,
      title: derivePromptTitle(normalized),
      textHash,
      createdAt: Date.now(),
    });
    return { id, inserted: true as const };
  },
});

/**
 * The tenant's newest pins. No arguments — there is no id to point at another tenant. The
 * projection is explicit rather than the raw row: `tenantId` and `textHash` have no business in a
 * browser that already knows who it is, and a raw-row return quietly ships every future column.
 */
export const list = tenantQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("savedPrompts")
      .withIndex("by_tenant_createdAt", (q) => q.eq("tenantId", ctx.tenantId))
      // 29-08: PROMPT pins only. A row carrying `templateId` is a pinned WORKFLOW
      // (`pinnedWorkflows.ts`), and Run in this menu is an ordinary Executive-Agent turn through
      // `sendCockpitMessage` — so a workflow pin listed here would offer "Business pulse" and then
      // run something that is not the Business pulse pack. Its own surface (`/dashboard/workflows`)
      // runs it through `startWorkflowPack`, which is the allow-listed pack agent.
      //
      // FILTERED BEFORE THE TAKE, and that ordering is the whole point: filtering the taken page
      // instead made every workflow pin EVICT a saved prompt from this menu, so the twenty-entry
      // cap silently shrank by one for each pinned workflow. This is one predicate on the same
      // indexed range, not a second read — `take` still bounds it.
      .filter((q) => q.eq(q.field("templateId"), undefined))
      .order("desc")
      .take(SAVED_PROMPT_LIST_LIMIT);
    return rows.map((r) => ({
      id: r._id,
      title: r.title,
      text: r.text,
      createdAt: r.createdAt,
    }));
  },
});

/**
 * Unpin. Reads the exact row and compares `tenantId` before deleting anything.
 *
 * A missing id and another tenant's id return the SAME `{removed: false}` — the answer must not be
 * an oracle for "does this id exist somewhere else?". This deletes the pin and only the pin: a
 * saved prompt has no `threadId`, owns no conversation, and unpinning one leaves every chat,
 * plan and message exactly where it was.
 */
export const remove = tenantMutation({
  args: { id: v.id("savedPrompts") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row || row.tenantId !== ctx.tenantId) return { removed: false };
    await ctx.db.delete(id);
    return { removed: true };
  },
});
