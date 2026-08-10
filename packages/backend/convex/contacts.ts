// The person store — the THIN Convex adapter over the Phase-19 substrate (CLAUDE.md §1).
//
// Every tenant-scoped write on `contacts`, `followUps` and `suppressions` lives here, plus the
// internals the rest of the phase consumes: the send-path suppression backstop, the CAN-SPAM
// footer, and the unsubscribe token pair. PIPE-01's central worry is a SECOND CRM data plane, so
// this is the one substrate no later plan may duplicate — the Pipeline page, the send guard, the
// unsubscribe route and the cockpit tools all read or write through this module.
//
// Three invariants this file is responsible for keeping true (docs/playbooks/contacts-crm.md):
//   1. A row exists ONLY because a human deliberately acted. There is NO auto-upsert from mailbox
//      or Gmail-header resolution anywhere below — that absence IS the "no contacts cache at rest"
//      argument (SC#7). Adding one re-opens the invariant.
//   2. `normalizeAddress` (@pikar/core) is the identity function, imported, never re-implemented.
//      A local `.toLowerCase()` here would be a second chance for the guard and the contact row to
//      disagree about who someone is.
//   3. The ONLY audit row written here is on `unsuppress`, and its payload is an id and a hash —
//      CLAUDE.md §3 (insert-only) and §4 (refs/ids/counts only). No address, no consent wording,
//      no note text ever reaches `audit`.
//
// There is no opportunity concept, no pipeline-value field and no monetary type in this module,
// and `contacts.test.ts` scans this file to keep it that way (PIPE-01, SC#8).
import {
  compareDashboardOrder,
  createDashboardBound,
  dashboardCursorFor,
  followUpIsDue,
  needsAttention,
  normalizeAddress,
  parseCrmOperations,
  parseDashboardCursor,
  rankCandidates,
  renderFooter,
} from "@pikar/core";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { hmacHex } from "./gmailAuth";
import { tenantMutation, tenantQuery } from "./lib/functions";
import { contentHash } from "./lib/hash";

// ── Shared readers ────────────────────────────────────────────────────────────
// One indexed lookup each, both keyed on `normalizeAddress` output. Every write below routes
// through these rather than re-deriving the key at the call site.

async function contactByEmail(
  ctx: QueryCtx,
  tenantId: string,
  address: string,
): Promise<Doc<"contacts"> | null> {
  return await ctx.db
    .query("contacts")
    .withIndex("by_tenant_email", (q) => q.eq("tenantId", tenantId).eq("email", address))
    .unique();
}

async function suppressionByAddress(
  ctx: QueryCtx,
  tenantId: string,
  address: string,
): Promise<Doc<"suppressions"> | null> {
  return await ctx.db
    .query("suppressions")
    .withIndex("by_tenant_address", (q) => q.eq("tenantId", tenantId).eq("address", address))
    .unique();
}

/** The comma-joined group recipient string, exploded into normalized members. Empty members are
 *  dropped so a trailing comma cannot produce a `""` lookup that matches nothing meaningful. */
function recipientMembers(recipient: string): string[] {
  return recipient
    .split(",")
    .map(normalizeAddress)
    .filter((a) => a !== "");
}

// ── The shared write helpers (19-06) ──────────────────────────────────────────
// Plain async functions over an explicit `tenantId`, NOT Convex functions — so the public
// tenant-scoped mutations below AND `cockpit.ts`'s `crm_write` applier perform the SAME writes.
// Three copies of the identity/upsert rule would be three chances to disagree about who someone
// is (invariant 4, CLAUDE.md §8 rung 2). The tenantId is INJECTED by the wrapper at every public
// call site and read off the approved plan row at the applier; neither is model-supplied.

/** Create or update ONE contact, keyed on the normalized address. Returns the row id. */
export async function upsertContactRow(
  ctx: MutationCtx,
  tenantId: string,
  { email, name, origin }: { email: string; name?: string; origin: ContactOrigin },
): Promise<Id<"contacts">> {
  const address = normalizeAddress(email);
  // Trust boundary: `normalizeAddress` deliberately does not validate, so the refusal is here.
  // An empty key would collapse every nameless save onto one row.
  if (address === "") throw new Error("CONTACT_EMAIL_REQUIRED");

  const now = Date.now();
  const existing = await contactByEmail(ctx, tenantId, address);
  if (existing) {
    // A blank/absent name must not erase a name already on record.
    const trimmed = name?.trim();
    await ctx.db.patch(existing._id, { ...(trimmed ? { name: trimmed } : {}), updatedAt: now });
    return existing._id;
  }
  return await ctx.db.insert("contacts", {
    tenantId,
    email: address,
    ...(name?.trim() ? { name: name.trim() } : {}),
    origin,
    createdAt: now,
    updatedAt: now,
  });
}

/** Insert ONE follow-up. `contactId` is optional here because a USER may file a contactless one;
 *  the AGENT may not, and that refusal lives in `parseCrmOperations` (@pikar/core). */
export async function createFollowUpRow(
  ctx: MutationCtx,
  tenantId: string,
  { contactId, note, dueAt }: { contactId?: Id<"contacts">; note: string; dueAt: number },
): Promise<Id<"followUps">> {
  // `v.number()` is a float64 and admits NaN/Infinity, either of which would produce a follow-up
  // that can never be due and can never be found by the `by_tenant_status_dueAt` range read.
  if (!Number.isFinite(dueAt)) throw new Error("FOLLOWUP_DUEAT_REQUIRED");
  if (note.trim() === "") throw new Error("FOLLOWUP_NOTE_REQUIRED");

  if (contactId) {
    const contact = await ctx.db.get(contactId);
    // Without this a second tenant could hang a follow-up off a foreign contact id.
    if (!contact || contact.tenantId !== tenantId) throw new Error("CONTACT_NOT_FOUND");
  }

  return await ctx.db.insert("followUps", {
    tenantId,
    ...(contactId ? { contactId } : {}),
    note: note.trim(),
    dueAt,
    status: "open",
    createdAt: Date.now(),
  });
}

/** Move ONE follow-up between its three states, tenant-checked. */
export async function setFollowUpStatusRow(
  ctx: MutationCtx,
  tenantId: string,
  followUpId: Id<"followUps">,
  status: "open" | "done" | "canceled",
): Promise<void> {
  const row = await ctx.db.get(followUpId);
  if (!row || row.tenantId !== tenantId) throw new Error("FOLLOWUP_NOT_FOUND");
  await ctx.db.patch(followUpId, {
    // Re-opening clears the stamp, so "last touch" cannot count a completion that was undone.
    status,
    completedAt: status === "done" ? Date.now() : undefined,
  });
}

/** Provenance of the DATA on a contact row, set once on creation. Mirrors the schema union. */
export type ContactOrigin = "mailbox-resolved" | "user-entered" | "inbound";

/**
 * Apply an APPROVED `crm_write` plan's operation list (19-06, ACTN-05). Called from `executePlan`'s
 * `inline` arm and from nowhere else — the human Approve gate is the only trigger.
 *
 * `raw` is `plans.crmOperations`, which is CONTENT PLANE: it was validated when the plan was
 * staged, but the row could have been revised since, so it is re-parsed HERE. `parseCrmOperations`
 * is idempotent over its own output, so the second parse cannot refuse what the first accepted.
 *
 * ALL-OR-NONE FOR FREE: a Convex mutation is one serializable transaction, so a throw on the third
 * operation discards the first two. There is no saga, no compensation and no idempotency key
 * beyond `executePlan`'s existing `proposed → approved` CAS — which is also what makes a
 * double-approve apply nothing a second time.
 *
 * A follow-up UPSERTS its contact rather than refusing when the address is unknown: the human
 * approved a card naming that address, so the row is a deliberate human act (invariant 1), and
 * refusing after Approve would surface an error on a plan the user already agreed to.
 */
export async function applyCrmOperations(
  ctx: MutationCtx,
  tenantId: string,
  raw: unknown,
): Promise<number> {
  const operations = parseCrmOperations(raw);
  for (const operation of operations) {
    switch (operation.op) {
      case "addContact":
        await upsertContactRow(ctx, tenantId, {
          email: operation.email,
          name: operation.name,
          origin: operation.origin,
        });
        break;
      case "addFollowUp": {
        const contactId = await upsertContactRow(ctx, tenantId, {
          email: operation.email,
          origin: "mailbox-resolved",
        });
        await createFollowUpRow(ctx, tenantId, {
          contactId,
          note: operation.note,
          dueAt: operation.dueAt,
        });
        break;
      }
      default: {
        // `db.get` THROWS on a string that is not an id of this table; normalizeId returns null,
        // which turns a malformed ref into the same named refusal as a foreign one.
        const followUpId = ctx.db.normalizeId("followUps", operation.followUpRef);
        if (!followUpId) throw new Error("FOLLOWUP_NOT_FOUND");
        await setFollowUpStatusRow(
          ctx,
          tenantId,
          followUpId,
          operation.op === "completeFollowUp" ? "done" : "canceled",
        );
      }
    }
  }
  return operations.length;
}

// ── Public writes (tenant-scoped; CLAUDE.md §2 — no raw builders) ─────────────

/**
 * Create or update ONE contact, keyed on the normalized address. Email is REQUIRED, name is
 * OPTIONAL (the Pipeline table falls back to the address), so saving from an agent resolution card
 * never blocks on data Gmail did not provide.
 *
 * `origin` is the provenance of the DATA and is set once, on creation: a later save from a
 * different surface does not rewrite where the address originally came from.
 */
export const upsertContact = tenantMutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    origin: v.union(v.literal("mailbox-resolved"), v.literal("user-entered"), v.literal("inbound")),
  },
  handler: async (ctx, args): Promise<Id<"contacts">> =>
    await upsertContactRow(ctx, ctx.tenantId, args),
});

/**
 * Record that the USER asserts consent for this contact ("they signed up at the trade show").
 *
 * NOTHING is ever defaulted to consented — absent stays absent, and the Pipeline cell then reads
 * "none on record", which is the truth. This is also the reproducible-wording machinery Phase 31
 * will later write real captured wording into, exercised now rather than shipped unused.
 *
 * `wording` and `context` are CONTENT PLANE (CLAUDE.md §4). They are stored on the contact row and
 * never audited — this function writes no audit row at all.
 */
export const assertConsent = tenantMutation({
  args: {
    contactId: v.id("contacts"),
    wording: v.string(),
    context: v.optional(v.string()),
  },
  handler: async (ctx, { contactId, wording, context }): Promise<null> => {
    const row = await ctx.db.get(contactId);
    // ONE message for "gone" and "not yours": a distinct error would confirm the id exists.
    if (!row || row.tenantId !== ctx.tenantId) throw new Error("CONTACT_NOT_FOUND");
    // A consent record with no wording is a defaulted consent wearing a timestamp.
    if (wording.trim() === "") throw new Error("CONSENT_WORDING_REQUIRED");

    const now = Date.now();
    await ctx.db.patch(contactId, {
      consentAt: now,
      consentSource: "asserted-by-user",
      consentWording: wording.trim(),
      ...(context?.trim() ? { consentContext: context.trim() } : {}),
      updatedAt: now,
    });
    return null;
  },
});

/** What `assertConsent` wrote, read back whole. `null` fields are "not recorded", never "". */
export type ConsentRecord = {
  at: number;
  source: "asserted-by-user" | "inbound-form";
  /** The EXACT wording shown at capture — the thing you hand a regulator. */
  wording: string | null;
  /** The user's free-text capture context ("Trade show, March"). */
  context: string | null;
};

/**
 * Reproduce ONE contact's consent record on request (SC#4's second sentence).
 *
 * `assertConsent` stores `consentWording` and `consentContext` and `listContacts` deliberately does
 * NOT project them — a durable free-text record does not belong in a table cell that renders for
 * every row. This is the request path that makes the stored record reachable, and it is the ONLY
 * reader of those two fields: without it they are write-only, which is a compliance obligation that
 * quietly becomes untrue (the `mediaJobs.actualCents` shape, closed by 20-18).
 *
 * `null` (not a throw) when there is no consent on record — "none on record" is the truth for most
 * contacts and is not an error. The CONTACT being absent or foreign IS a throw, and carries the
 * same single `CONTACT_NOT_FOUND` message as `assertConsent` so a distinct error cannot confirm
 * that an id exists in another tenant.
 *
 * Writes NOTHING — no audit row, here or in the wrapper. CLAUDE.md §4 is why this is a query and
 * not a "consent export" action: the wording is content plane, so the moment it is read under an
 * audited actor it becomes a candidate for a payload. `contacts.test.ts` pins that the whole audit
 * table still contains neither the wording nor the context AFTER this read has run.
 *
 * ponytail: id-at-a-time, no bulk export. A regulator request is per-person; the upgrade path (a
 * paged whole-book export) is `listContacts`'s pagination plus this projection, and costs nothing
 * to take later.
 */
export const consentRecord = tenantQuery({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, { contactId }): Promise<ConsentRecord | null> => {
    const row = await ctx.db.get(contactId);
    if (!row || row.tenantId !== ctx.tenantId) throw new Error("CONTACT_NOT_FOUND");
    if (row.consentAt === undefined) return null;
    return {
      at: row.consentAt,
      source: row.consentSource ?? "asserted-by-user",
      wording: row.consentWording ?? null,
      context: row.consentContext ?? null,
    };
  },
});

/**
 * Suppress an address. IDEMPOTENT: the suppressions row is the trust boundary, so being asked
 * twice must leave exactly one row rather than racing two.
 *
 * The `contacts.unsubscribedAt` write is a DISPLAY MIRROR and is best-effort by design — no
 * contact row is created here, and its absence never blocks the suppression (suppression outlives
 * the contact, and can exist without one).
 */
export const markSuppressed = tenantMutation({
  args: { address: v.string() },
  handler: async (ctx, { address }): Promise<null> => {
    await suppress(ctx, ctx.tenantId, address, "user-marked");
    return null;
  },
});

/** The shared suppression write. One implementation for the user-marked and unsubscribe-link
 *  paths so the two can never disagree about what a suppression is. */
async function suppress(
  ctx: MutationCtx,
  tenantId: string,
  rawAddress: string,
  source: "user-marked" | "unsubscribe-link",
): Promise<boolean> {
  const address = normalizeAddress(rawAddress);
  if (address === "") return false;

  const now = Date.now();
  const existing = await suppressionByAddress(ctx, tenantId, address);
  if (existing) {
    // Already suppressed. Do NOT bump `suppressedAt` — the fact of record is WHEN they asked to
    // stop, and a replayed unsubscribe link must not rewrite it.
    return false;
  }
  await ctx.db.insert("suppressions", { tenantId, address, suppressedAt: now, source });

  const contact = await contactByEmail(ctx, tenantId, address);
  if (contact) await ctx.db.patch(contact._id, { unsubscribedAt: now, updatedAt: now });
  return true;
}

/**
 * Reverse a suppression. Deliberately NOT a plain toggle: `acknowledged` must be exactly `true`,
 * which is the UI's explicit confirm that re-subscribing without fresh consent is the user's
 * responsibility. This is the ONLY audit row this module writes.
 */
export const unsuppress = tenantMutation({
  args: { address: v.string(), acknowledged: v.boolean() },
  handler: async (ctx, { address, acknowledged }): Promise<null> => {
    // Exact `true` only, and BEFORE any read — a truthy non-boolean must not un-suppress anyone.
    if (acknowledged !== true) throw new Error("UNSUPPRESS_NOT_ACKNOWLEDGED");

    const normalized = normalizeAddress(address);
    if (normalized === "") throw new Error("CONTACT_EMAIL_REQUIRED");

    const row = await suppressionByAddress(ctx, ctx.tenantId, normalized);
    if (!row) throw new Error("SUPPRESSION_NOT_FOUND");
    await ctx.db.delete(row._id);

    const contact = await contactByEmail(ctx, ctx.tenantId, normalized);
    if (contact)
      await ctx.db.patch(contact._id, { unsubscribedAt: undefined, updatedAt: Date.now() });

    // CLAUDE.md §4: an id and a hash. The key set is EXACTLY {contactId, addressHash} and
    // `contacts.test.ts` / `llmRedaction.test.ts` pin it by key-set EQUALITY — adding a key here
    // fails those tests on purpose. `contactId` is null (never absent) when no contact row exists,
    // so the key set does not depend on the data. The address itself never appears, here or in
    // `correlationId`.
    const addressHash = await contentHash(normalized);
    await ctx.runMutation(internal.audit.log, {
      tenantId: ctx.tenantId,
      correlationId: addressHash,
      eventType: "contact.unsuppressed",
      actor: "user",
      payload: { contactId: contact ? String(contact._id) : null, addressHash },
    });
    return null;
  },
});

/**
 * Create a follow-up. `contactId` is OPTIONAL — free-standing follow-ups are allowed ("chase the
 * supplier quote"). `dueAt` is REQUIRED: "Follow-ups due" is a headline tile and an undated
 * follow-up could never appear in it. Moving the date IS the snooze, which is why there is no
 * snooze state.
 */
export const createFollowUp = tenantMutation({
  args: {
    contactId: v.optional(v.id("contacts")),
    note: v.string(),
    dueAt: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"followUps">> =>
    await createFollowUpRow(ctx, ctx.tenantId, args),
});

/**
 * Move a follow-up between its three states. `done` stamps `completedAt`; `canceled` does NOT —
 * "I decided not to" and "I did it" are different facts, and only the second is a touch.
 */
export const setFollowUpStatus = tenantMutation({
  args: {
    followUpId: v.id("followUps"),
    status: v.union(v.literal("open"), v.literal("done"), v.literal("canceled")),
  },
  handler: async (ctx, { followUpId, status }): Promise<null> => {
    await setFollowUpStatusRow(ctx, ctx.tenantId, followUpId, status);
    return null;
  },
});

// ── The unsubscribe token ─────────────────────────────────────────────────────
// ONE opaque key over the recipient string AS STORED (in group mode that is the comma-joined
// string), so the footer of a group send carries a single link. Stateless: no token table, no
// expiry bookkeeping, nothing to clean up — the `convex/http.ts` fal-webhook pattern (20-06).

/** The signing secret. A link that lives forever in a recipient's inbox must NOT share the OAuth
 *  signing key, so this is its own deployment env var. Absent ⇒ null ⇒ every path fails CLOSED. */
function unsubscribeSecret(): string | null {
  return process.env.UNSUBSCRIBE_SECRET || null;
}

function base64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(s: string): string | null {
  try {
    const binary = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null; // malformed input is a forged link, not an exception
  }
}

/** `<base64url(tenantId|recipient)>.<hmacHex>` — or null when the secret is unset. */
async function mintUnsubToken(tenantId: string, recipient: string): Promise<string | null> {
  const secret = unsubscribeSecret();
  // Minting with an empty secret yields a digest ANYONE can recompute, so this is a fail-closed
  // refusal, not a duplicate of the verify-side guard below: mint and verify are different paths.
  if (!secret) return null;
  const raw = base64urlEncode(`${tenantId}|${recipient}`);
  return `${raw}.${await hmacHex(raw, secret)}`;
}

export type ResolvedUnsub = { tenantId: string; addresses: string[] };

/** The ONE verifier. Both `resolveUnsubToken` (the landing page's GET) and
 *  `suppressFromUnsubscribe` (the confirm POST) call this, so the POST can never trust a decode
 *  the caller supplied. Copies `mediaComplete.resolveJob`'s rules, including the plain `===`. */
async function verifyUnsubToken(raw: string, digest: string): Promise<ResolvedUnsub | null> {
  // FAIL CLOSED on the env, and this is the ONLY copy of that guard on the verify path. A second
  // one at the HTTP route would make this one vacuous, and this is the place that matters:
  // without it `hmacHex(raw, "")` still yields a digest, which anyone can compute.
  const secret = unsubscribeSecret();
  if (!secret) return null;
  if (raw === "" || digest === "") return null;
  if (digest !== (await hmacHex(raw, secret))) return null;

  const decoded = base64urlDecode(raw);
  if (decoded === null) return null;
  // `tenantId` is the auth userId segment and contains no `|`, so the FIRST separator splits it.
  const bar = decoded.indexOf("|");
  if (bar <= 0) return null;

  const tenantId = decoded.slice(0, bar);
  const addresses = recipientMembers(decoded.slice(bar + 1));
  if (addresses.length === 0) return null;
  return { tenantId, addresses };
}

/** Read-only resolution for the landing page. A GET must write NOTHING — corporate mail scanners
 *  and link prefetchers fire GETs, and a GET-suppresses design unsubscribes people who never
 *  clicked. The confirm button is what stops the feature firing itself. */
export const resolveUnsubToken = internalQuery({
  args: { raw: v.string(), digest: v.string() },
  handler: async (_ctx, { raw, digest }): Promise<ResolvedUnsub | null> =>
    await verifyUnsubToken(raw, digest),
});

/**
 * The confirm POST. Re-verifies from scratch, then suppresses EVERY address in the comma-joined
 * string as an UPSERT — idempotency is the whole abuse mitigation for a replayed link.
 *
 * Writes NO audit row: there is no authenticated actor on this route, and an audit row keyed to
 * an anonymous request is a claim the log cannot support. Returns counts only.
 */
export const suppressFromUnsubscribe = internalMutation({
  args: { raw: v.string(), digest: v.string() },
  handler: async (ctx, { raw, digest }): Promise<{ ok: boolean; suppressed: number }> => {
    const resolved = await verifyUnsubToken(raw, digest);
    if (!resolved) return { ok: false, suppressed: 0 };

    let suppressed = 0;
    for (const address of resolved.addresses) {
      if (await suppress(ctx, resolved.tenantId, address, "unsubscribe-link")) suppressed += 1;
    }
    // `ok` is true on a replay even when `suppressed` is 0 — the recipient's request WAS honoured.
    return { ok: true, suppressed };
  },
});

// ── The send-path internals ───────────────────────────────────────────────────
// Explicit `tenantId` arg, filtered here (internal functions get no wrapper injection). These read
// `suppressions` and NEVER `contacts`: that split is what makes a contacts bug unable to
// un-suppress anyone, and contact deletion a non-event for the guard (SC#5).

/**
 * The send-path backstop: is this recipient suppressed?
 *
 * ponytail: the comma-split is the CEILING of this function. Group mode is ONE `requests` row
 * holding a joined recipient string, so a `true` here can only refuse the WHOLE row — it cannot
 * drop one member and send to the rest. The per-address drop that makes partial group sends work
 * lives at `executePlan`/`startFanout` (19-05), which sees the recipient LIST before the join.
 * Upgrade path is there, not here; widening this function would just move the same limitation.
 */
export const isSuppressed = internalQuery({
  args: { tenantId: v.string(), recipient: v.string() },
  handler: async (ctx, { tenantId, recipient }): Promise<boolean> => {
    for (const address of recipientMembers(recipient)) {
      if (await suppressionByAddress(ctx, tenantId, address)) return true;
    }
    return false;
  },
});

/** The suppressed SUBSET of a recipient list, normalized — what 19-05 drops and then names back to
 *  the user ("withheld from …"). One indexed read per address, no scan. */
export const suppressedAmong = internalQuery({
  args: { tenantId: v.string(), addresses: v.array(v.string()) },
  handler: async (ctx, { tenantId, addresses }): Promise<string[]> => {
    const out: string[] = [];
    for (const raw of addresses) {
      const address = normalizeAddress(raw);
      if (address === "") continue;
      if (out.includes(address)) continue; // a duplicated recipient is named once
      if (await suppressionByAddress(ctx, tenantId, address)) out.push(address);
    }
    return out;
  },
});

/**
 * The CAN-SPAM footer for ONE recipient, or `null` when it cannot be built — in which case the
 * CALLER fails closed and refuses the send. A footer rendering an empty address or a dead link
 * looks compliant and is not, which is worse than no footer at all.
 *
 * Null happens when: the tenant has no `postalAddress`, `UNSUBSCRIBE_SECRET` is unset, or the
 * Convex site origin is unset. All three are configuration, and all three refuse the send.
 */
export const footerFor = internalQuery({
  args: { tenantId: v.string(), recipient: v.string() },
  handler: async (ctx, { tenantId, recipient }): Promise<{ text: string } | null> => {
    const profile = await ctx.db
      .query("tenantProfiles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .unique();
    const postalAddress = profile?.postalAddress?.trim() ?? "";
    if (postalAddress === "") return null;

    // The CONVEX SITE origin, the same origin `http.ts` serves — NOT `SITE_URL`, which is the Next
    // app and cannot serve this route (19-04 mounts it here).
    const siteUrl = process.env.CONVEX_SITE_URL?.replace(/\/+$/, "") ?? "";
    if (siteUrl === "") return null;

    const token = await mintUnsubToken(tenantId, recipient);
    if (!token) return null;

    return {
      text: renderFooter({ postalAddress, unsubscribeUrl: `${siteUrl}/unsubscribe/${token}` }),
    };
  },
});

// ── The Pipeline read models (19-07, PIPE-01 / SC#8) ──────────────────────────
// Three tenant-scoped reads behind `/dashboard/pipeline`. They add NO backing store: every number
// is derived from `contacts`, `followUps`, `suppressions` and the delivery spine's `requests`
// rows. There is no opportunity, no deal state and no monetary field here, deliberately, and the
// structural scan at the top of this file's test covers these lines too.
//
// Bounded by the 26-01 contracts (`@pikar/core` `dashboard.ts`), consumed and never re-implemented:
// `createDashboardBound` enforces `nextCursor ⇒ partial` and `partial ⇔ partialReason`, and
// `dashboardCursorFor`/`parseDashboardCursor` own the validated "v1:" cursor. `DashboardMoney` is
// deliberately NOT imported — importing it on this page would be a signal in the wrong direction.

const PAGE_LIMIT_DEFAULT = 25;
const PAGE_LIMIT_MAX = 50;
/** Row caps for the per-call scans. A read model behind a dashboard route must never be an
 *  unbounded table scan — that is the whole reason the 26-01 bound contract exists. */
const SCAN_LIMIT = 1_000;
/** One contact's whole follow-up history, read through `by_tenant_contact` for the page's rows. */
const PER_CONTACT_FOLLOWUP_LIMIT = 200;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return PAGE_LIMIT_DEFAULT;
  return Math.min(Math.max(Math.floor(limit), 1), PAGE_LIMIT_MAX);
}

/**
 * Page an already-fetched, bounded row set into a `createDashboardBound`-shaped result.
 *
 * ponytail: a bounded scan sorted in memory, beta scale. The ceiling is `SCAN_LIMIT` rows per call
 * — past that the page reports `partial`/`"row-cap"` and the tail is unreachable. Upgrade path when
 * a tenant outgrows it: drive the cursor off the index range itself
 * (`by_tenant_createdAt` + `lte(createdAt)`) so the fetch is limit-sized rather than scan-sized.
 * Don't take it until the scan hurts; the in-memory sort is what makes the createdAt TIE handling
 * (id-descending, `compareDashboardOrder`) exact rather than approximate.
 */
function pageBounded<T extends { createdAt: number; id: string }>(
  rows: T[],
  scanCapped: boolean,
  cursor: string | undefined,
  limit: number,
): { page: T[]; bound: ReturnType<typeof createDashboardBound> } {
  const sorted = [...rows].sort(compareDashboardOrder);
  // `parseDashboardCursor` throws on a forged/oversized cursor — a trust boundary, not a fallback.
  const start =
    cursor === undefined
      ? 0
      : sorted.findIndex((row) => compareDashboardOrder(row, parseDashboardCursor(cursor)) > 0);
  const page = start < 0 ? [] : sorted.slice(start, start + limit);
  const last = page.at(-1);
  const nextCursor =
    last !== undefined && start >= 0 && start + limit < sorted.length
      ? dashboardCursorFor(last)
      : null;
  const partial = nextCursor !== null || scanCapped;
  return {
    page,
    bound: createDashboardBound({
      returned: page.length,
      limit,
      nextCursor,
      partial,
      ...(partial ? { partialReason: "row-cap" as const } : {}),
    }),
  };
}

/**
 * "Last touch", half one — the newest DELIVERED send per address (Open Question 4, resolved here).
 *
 * ONE bounded read of `requests` per page, folded in memory against the recipient string (which in
 * group mode is comma-joined, hence `recipientMembers`). There is deliberately NO denormalized
 * `contacts.lastTouchAt` field: that would be a write-path obligation this phase does not otherwise
 * have.
 *
 * ponytail: one bounded requests scan folded in memory, beta scale. Upgrade path when the scan
 * stops being cheap: a denormalized `contacts.lastTouchAt` written by `recordDeliveryTerminal` and
 * `setFollowUpStatus` — a write-path obligation, so don't take it until the read hurts.
 */
async function newestSendByAddress(
  ctx: QueryCtx,
  tenantId: string,
): Promise<{ newest: Map<string, number>; capped: boolean }> {
  const rows = await ctx.db
    .query("requests")
    .withIndex("by_tenant_status_createdAt", (q) => q.eq("tenantId", tenantId).eq("status", "sent"))
    .order("desc")
    .take(SCAN_LIMIT + 1);
  const capped = rows.length > SCAN_LIMIT;
  const newest = new Map<string, number>();
  for (const row of rows.slice(0, SCAN_LIMIT)) {
    for (const address of recipientMembers(row.recipient)) {
      const seen = newest.get(address);
      if (seen === undefined || row.createdAt > seen) newest.set(address, row.createdAt);
    }
  }
  return { newest, capped };
}

/**
 * The four Pipeline tiles. ALWAYS-KNOWN counts: contacts and follow-ups have no coverage-start
 * concept — the substrate is created by the user, so "we weren't watching then" cannot apply and
 * `Unknown` is never the truth. A real zero is `0` (playbook invariant 3).
 *
 * `needingAttention` is deliberately COMPLEMENTARY to `followUpsDue` rather than a restatement of
 * it: it counts contacts with NO open follow-up, so a contact whose only follow-up is `done` or
 * `canceled` is back in the tile. Both derivations are `@pikar/core`'s, not re-implemented here.
 */
export const pipelineTiles = tenantQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    needingAttention: number;
    followUpsDue: number;
    consentOnRecord: number;
    suppressed: number;
  }> => {
    const now = Date.now();
    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_tenant_createdAt", (q) => q.eq("tenantId", ctx.tenantId))
      .take(SCAN_LIMIT);
    const open = await ctx.db
      .query("followUps")
      .withIndex("by_tenant_status_dueAt", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("status", "open"),
      )
      .take(SCAN_LIMIT);
    const suppressions = await ctx.db
      .query("suppressions")
      .withIndex("by_tenant_address", (q) => q.eq("tenantId", ctx.tenantId))
      .take(SCAN_LIMIT);

    const openContactIds = new Set(
      open.flatMap((row) => (row.contactId ? [String(row.contactId)] : [])),
    );
    return {
      needingAttention: contacts.filter((c) => needsAttention(String(c._id), openContactIds))
        .length,
      // Contactless follow-ups are counted too — one honest total, no asterisk.
      followUpsDue: open.filter((row) => followUpIsDue(row.dueAt, now)).length,
      consentOnRecord: contacts.filter((c) => c.consentAt !== undefined).length,
      suppressed: suppressions.length,
    };
  },
});

/** One Pipeline table row. TYPED FACTS only — the display prose is code-owned on the component
 *  side (`DASHBOARD_STATE_COPY`), so a backend change can never rewrite what the page says. */
export type PipelineContactRow = {
  contactId: Id<"contacts">;
  email: string;
  /** `null`, never `""` — the component falls back to the address rather than rendering a blank. */
  name: string | null;
  origin: ContactOrigin;
  /** `null` means NO contact has ever happened, which is not the same fact as `0`. */
  lastTouchAt: number | null;
  nextStep: { followUpId: Id<"followUps">; note: string; dueAt: number } | null;
  /** `null` = none on record. Nothing is ever defaulted to consented (invariant 6). */
  consent: { at: number; source: "asserted-by-user" | "inbound-form" } | null;
  /** The DISPLAY MIRROR (`contacts.unsubscribedAt`), never the send-path guard — that reads
   *  `suppressions` and only `suppressions` (invariant 2). It decides which row action to offer. */
  suppressed: boolean;
};

/**
 * The contact table: newest-first, bounded, one page at a time.
 *
 * Each row carries its own next step and last touch so the table needs no second round trip. The
 * per-contact follow-up read is indexed (`by_tenant_contact`) and runs once per PAGE row, not once
 * per contact in the tenant.
 */
export const listContacts = tenantQuery({
  args: { cursor: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    contacts: PipelineContactRow[];
    bound: ReturnType<typeof createDashboardBound>;
  }> => {
    const limit = clampLimit(args.limit);
    const scanned = await ctx.db
      .query("contacts")
      .withIndex("by_tenant_createdAt", (q) => q.eq("tenantId", ctx.tenantId))
      .order("desc")
      .take(SCAN_LIMIT + 1);
    const { page, bound } = pageBounded(
      scanned.slice(0, SCAN_LIMIT).map((doc) => ({ doc, createdAt: doc.createdAt, id: doc._id })),
      scanned.length > SCAN_LIMIT,
      args.cursor,
      limit,
    );

    const { newest } = await newestSendByAddress(ctx, ctx.tenantId);
    const contacts: PipelineContactRow[] = [];
    for (const { doc } of page) {
      const followUps = await ctx.db
        .query("followUps")
        .withIndex("by_tenant_contact", (q) =>
          q.eq("tenantId", ctx.tenantId).eq("contactId", doc._id),
        )
        .take(PER_CONTACT_FOLLOWUP_LIMIT);

      let nextStep: PipelineContactRow["nextStep"] = null;
      let lastCompletedAt: number | null = null;
      for (const row of followUps) {
        if (row.status === "open" && (nextStep === null || row.dueAt < nextStep.dueAt)) {
          nextStep = { followUpId: row._id, note: row.note, dueAt: row.dueAt };
        }
        // Only `done` stamps `completedAt`; a cancel is not a touch, and re-opening clears it.
        if (
          row.completedAt !== undefined &&
          row.status === "done" &&
          (lastCompletedAt === null || row.completedAt > lastCompletedAt)
        ) {
          lastCompletedAt = row.completedAt;
        }
      }

      const lastSentAt = newest.get(doc.email) ?? null;
      const touches = [lastSentAt, lastCompletedAt].filter((t): t is number => t !== null);
      contacts.push({
        contactId: doc._id,
        email: doc.email,
        name: doc.name ?? null,
        origin: doc.origin,
        lastTouchAt: touches.length === 0 ? null : Math.max(...touches),
        nextStep,
        consent:
          doc.consentAt === undefined
            ? null
            : { at: doc.consentAt, source: doc.consentSource ?? "asserted-by-user" },
        suppressed: doc.unsubscribedAt !== undefined,
      });
    }
    return { contacts, bound };
  },
});

/**
 * The contactless follow-ups, which get their OWN section BENEATH the table rather than em-dash
 * rows inside it: the table is one row per PERSON, and a row with no person is a different fact.
 * Contactless follow-ups are a USER-only capability (invariant 11) — the agent must always name a
 * contact — so this section is also the visible proof of that asymmetry.
 */
export const listUnassignedFollowUps = tenantQuery({
  args: { cursor: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    followUps: Array<{ followUpId: Id<"followUps">; note: string; dueAt: number }>;
    bound: ReturnType<typeof createDashboardBound>;
  }> => {
    const limit = clampLimit(args.limit);
    const scanned = await ctx.db
      .query("followUps")
      .withIndex("by_tenant_status_dueAt", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("status", "open"),
      )
      .take(SCAN_LIMIT + 1);
    const { page, bound } = pageBounded(
      scanned
        .slice(0, SCAN_LIMIT)
        .filter((row) => row.contactId === undefined)
        .map((row) => ({
          followUpId: row._id,
          note: row.note,
          dueAt: row.dueAt,
          createdAt: row.createdAt,
          id: row._id as string,
        })),
      scanned.length > SCAN_LIMIT,
      args.cursor,
      limit,
    );
    return {
      followUps: page.map(({ followUpId, note, dueAt }) => ({ followUpId, note, dueAt })),
      bound,
    };
  },
});

// ── The cockpit's saved-contact read (19-08, ACTN-05) ─────────────────────────

/**
 * Look a NAME up against the saved contacts, with each match's OPEN follow-ups.
 *
 * `tenantId` is an EXPLICIT arg, not `ctx.tenantId`: the caller is a cockpit TOOL running inside
 * an action that carries no auth identity and passes the tenant it was built for (the
 * `internal.vaultSources.latestCreated` precedent).
 *
 * **This is a READ and there is deliberately no write anywhere in it.** Resolving a name must
 * never mint a contact row — that absence is invariant 1 / SC#7 ("no contacts cache at rest")
 * enforced at its one enforcement point, and `cockpitTools.test.ts` counts the rows to prove it.
 *
 * Matching is `rankCandidates` (@pikar/core) — the SAME ranker the Gmail-header path runs, fed the
 * saved rows shaped as header records. ONE definition of "does this name mean this person", so the
 * saved plane and the header plane can never disagree about who Sarah is (CLAUDE.md §8 rung 2).
 *
 * ponytail: bounded scan + the in-memory ranker, because `contacts` has no name index and a saved
 * book past SCAN_LIMIT is not this phase's problem. Upgrade path: a `searchIndex` on
 * `contacts.name` — at which point the ranker still decides, only the shortlist changes.
 */
export const savedForName = internalQuery({
  args: { tenantId: v.string(), name: v.string() },
  handler: async (
    ctx,
    { tenantId, name },
  ): Promise<{
    matches: ReturnType<typeof rankCandidates>;
    followUps: Array<{ note: string; dueAt: number }>;
  }> => {
    const rows = await ctx.db
      .query("contacts")
      .withIndex("by_tenant_createdAt", (q) => q.eq("tenantId", tenantId))
      .take(SCAN_LIMIT);

    const matches = rankCandidates(
      name,
      // A saved row rendered as the header value the ranker already parses. `name` is optional on
      // a contact, so a nameless row still matches on its address, exactly as a bare header would.
      rows.map((row) => ({ from: row.name ? `${row.name} <${row.email}>` : row.email })),
    );
    if (matches.length === 0) return { matches: [], followUps: [] };

    const byEmail = new Map(rows.map((row) => [row.email, row._id]));
    const followUps: Array<{ note: string; dueAt: number }> = [];
    for (const match of matches) {
      const contactId = byEmail.get(match.address);
      if (!contactId) continue;
      const hers = await ctx.db
        .query("followUps")
        .withIndex("by_tenant_contact", (q) =>
          q.eq("tenantId", tenantId).eq("contactId", contactId),
        )
        .take(PER_CONTACT_FOLLOWUP_LIMIT);
      // OPEN only: a done or canceled follow-up is history, and surfacing it would have the agent
      // re-raise something the user already closed.
      for (const row of hers) {
        if (row.status === "open") followUps.push({ note: row.note, dueAt: row.dueAt });
      }
    }
    return { matches, followUps };
  },
});
