import type { EntryId } from "@convex-dev/rag";
import {
  type DeletableTenantTable,
  deletableTables,
  STORAGE_ID_FIELDS,
  storageIdsIn,
  type TenantDeletionCursor,
  tenantTableScope,
} from "@pikar/core/tenantData";
import type { RevocationUpstream } from "@pikar/revenue";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { tenantAction } from "./lib/functions";
import { contentHash } from "./lib/hash";
import { rag } from "./vaultRag";
import { CURSOR_NAME } from "./wormCursor";

export const TENANT_DELETE_BATCH_SIZE = 2;

type ProviderDeletionResult = {
  /** 28.1-08 widened this to three and the connector arm to seven. BOTH this type AND
   *  `providerResultValidator` below must carry the same members — a value that satisfies one and
   *  not the other is a runtime rejection under a perfectly green typecheck. */
  provider: "google" | "microsoft" | "billing" | "hubspot" | "quickbooks" | "stripe" | "paypal";
  localRowDeleted: boolean;
  revokedAtProvider: boolean;
  failure: boolean;
  /**
   * WHY A BOOLEAN IS NOT ENOUGH FOR A CONNECTOR, and the reason this field exists.
   *
   * `revokedAtProvider: false` cannot distinguish "we asked and the provider refused" from "this
   * provider documents no revocation endpoint at all". For three of the four Phase 28 connectors
   * the second is the permanent truth — PayPal documents none anywhere, Stripe Apps have no
   * documented platform-initiated revocation, and HubSpot's cascade to already-issued access
   * tokens is unproven — so collapsing them would re-create exactly the boolean the four-value
   * `RevocationUpstream` enum was built to prevent.
   *
   * It matters most HERE. `connectorConnections` is `tenant_credential`, so the page loop deletes
   * the row carrying `revocation.upstream`; after an erasure this audit payload is the ONLY place
   * that truth survives. Absent for google/microsoft/billing, which are not connector lanes.
   */
  revokeUpstream?: RevocationUpstream;
};

/** The four connector lanes, in the order their entries are appended. */
const CONNECTOR_PROVIDERS = ["hubspot", "quickbooks", "stripe", "paypal"] as const;
type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number];

/**
 * LEAST REASSURING WINS. A tenant may hold both a sandbox and a production grant for one provider
 * and they can come back with different answers; one entry per provider has to pick one. It picks
 * the worst, because an erasure report that rounds a partial failure up to `confirmed` is the one
 * error this record must never make.
 */
const UPSTREAM_SEVERITY: Record<RevocationUpstream, number> = {
  attempted_failed: 3,
  unsupported: 2,
  not_attempted: 1,
  confirmed: 0,
};
const leastReassuring = (states: readonly RevocationUpstream[]): RevocationUpstream =>
  states.reduce((worst, s) => (UPSTREAM_SEVERITY[s] > UPSTREAM_SEVERITY[worst] ? s : worst));

const deletionCursorValidator = v.object({ tableIndex: v.number() });
const providerResultValidator = v.object({
  provider: v.union(
    v.literal("google"),
    v.literal("microsoft"),
    v.literal("billing"),
    v.literal("hubspot"),
    v.literal("quickbooks"),
    v.literal("stripe"),
    v.literal("paypal"),
  ),
  localRowDeleted: v.boolean(),
  revokedAtProvider: v.boolean(),
  failure: v.boolean(),
  revokeUpstream: v.optional(
    v.union(
      v.literal("confirmed"),
      v.literal("attempted_failed"),
      v.literal("unsupported"),
      v.literal("not_attempted"),
    ),
  ),
});
const auditLog = makeFunctionReference<
  "mutation",
  {
    tenantId: string;
    correlationId: string;
    eventType: string;
    actor: string;
    payload: Record<string, string | number | boolean>;
  }
>("audit:log");

/**
 * Delete the Convex Auth rows bound to the erased person, keyed by `userId`.
 *
 * WHY THIS IS NOT IN `TENANT_TABLE_CLASSIFICATION`: those tables belong to `@convex-dev/auth`, and
 * they are keyed by `userId`, not `tenantId` — the registry-driven page loop below queries
 * `by_tenant` and structurally cannot reach them. Excluding non-tenant tables is what keeps `audit`
 * unreachable (CLAUDE.md §3), so the exclusion itself is right; the bug was assuming every excluded
 * table should therefore SURVIVE.
 *
 * MEASURED CONSEQUENCE OF LEAVING THEM (production, 2026-08-16): erasure deleted the `users` row and
 * left one `authAccounts` row pointing at it. Every later Google sign-in for that identity resolved
 * that orphan, called `defaultCreateOrUpdateUser` against a document that no longer exists, and
 * threw *"the user has been deleted but their account has not"* — a 500 on
 * `/api/auth/callback/google` and a PERMANENT lockout, because re-registering matches the same
 * orphan. Erasure has to remove the person's ability to sign in, not only their data; leaving the
 * credential binding turns Art. 17 into an account brick.
 *
 * ORDERING mirrors the tenant walk — dependents before the row they reference (refresh tokens →
 * sessions, verification codes → accounts) — so a failure part-way never strands a token pointing at
 * a session that is already gone.
 *
 * NOT TOUCHED: `authRateLimits` is keyed by identifier, not user, and is abuse-control state rather
 * than personal data; deleting it on request would hand every rate limit a free reset.
 *
 * ponytail: one transaction, no cursor — bounded by providers (≤3 accounts) and one person's session
 * history. Page it the way the tenant tables page if a real account ever exceeds a mutation's write
 * budget.
 */
async function deleteAuthCredentials(ctx: MutationCtx, userId: Id<"users">): Promise<number> {
  let deleted = 0;

  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  for (const session of sessions) {
    const tokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
      .collect();
    for (const token of tokens) {
      await ctx.db.delete(token._id);
      deleted++;
    }
    await ctx.db.delete(session._id);
    deleted++;
  }

  // The account row LAST of the credential set: it is the one that actually bricks sign-in, so if
  // anything above fails the binding is still present and the state stays diagnosable.
  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
    .collect();
  for (const account of accounts) {
    const codes = await ctx.db
      .query("authVerificationCodes")
      .withIndex("accountId", (q) => q.eq("accountId", account._id))
      .collect();
    for (const code of codes) {
      await ctx.db.delete(code._id);
      deleted++;
    }
    await ctx.db.delete(account._id);
    deleted++;
  }

  return deleted;
}

export const authorizeTenantDeletion = internalMutation({
  args: { tenantId: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    /**
     * SELF, not OWNER. `String(args.userId) !== args.tenantId` is the whole authorization: both
     * values are derived from the authenticated identity by `tenantAction`, never from client
     * args, so this can only ever erase the caller's own tenant.
     *
     * This clause used to ALSO require `user?.owner === true`, and that was wrong. `users.owner`
     * is the DEPLOYMENT-owner grant minted by `bootstrapOwner` (GOVN-01) — it gates the optimizer
     * and skill activation. Erasure is not an administrative privilege; it is GDPR Art. 17, a
     * right every user holds over their own data, and the published privacy policy promises it to
     * everyone. Requiring the deployment grant meant every real signup got `OWNER_REQUIRED`
     * (production request `9a23216e3f16ebe8`), so the control the policy advertises did not exist
     * for anyone but the operator.
     *
     * It bought no isolation either: `deleteTenantDataPage` scopes the identity row by
     * `String(user._id) === args.tenantId` and every other table by the `by_tenant` index. Dropping
     * it removes a false gate, not a real one — and `tenantDelete.test.ts`'s non-owner case is the
     * regression guard, because every other fixture in that file seeds `owner: true`.
     */
    if (!user || String(args.userId) !== args.tenantId) {
      throw new Error("TENANT_SELF_REQUIRED");
    }
    const google = await ctx.db
      .query("gmailTokens")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .unique();
    const microsoft = await ctx.db
      .query("microsoftCalendarTokens")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .unique();
    // 28.1-08: the third probe. `billingCustomers` is `tenant_owned`, so the page loop below will
    // delete this row — which is exactly why the arm that needs it runs before the loop.
    const billing = await ctx.db
      .query("billingCustomers")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .first();
    /**
     * THE FOURTH PROBE. `connectorConnections` is `tenant_credential`, so the page loop deletes
     * these rows — including the sealed blob the revocation needs. Same reason as billing above:
     * the arm that uses this must run BEFORE the loop.
     *
     * `sealed` is what separates a live grant from one already disconnected. `recordRevocation`
     * CLEARS the ciphertext and KEEPS the row, deliberately, so the UI can still say "we deleted
     * our copy; your grant stays live upstream". Re-revoking one of those would report a second
     * revocation of a credential we no longer hold.
     */
    const connectorRows = await ctx.db
      .query("connectorConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    return {
      googleConnected: !!google,
      microsoftConnected: !!microsoft,
      billingActive: !!billing,
      connectorGrants: connectorRows.map((row) => ({
        provider: row.provider,
        environment: row.environment,
        sealed: row.credentialCiphertextB64 !== undefined,
      })),
    };
  },
});

/**
 * One bounded transaction in the tenant-erasure sequence. This adapter can only obtain table
 * names from deletableTables(); audit/global names are absent from its type and runtime source.
 * The public owner/revocation orchestration is layered over this primitive in Task 2.
 */
export const deleteTenantDataPage = internalMutation({
  args: {
    tenantId: v.string(),
    userId: v.id("users"),
    cursor: v.optional(deletionCursorValidator),
    completion: v.optional(
      v.object({
        tenantIdHash: v.string(),
        deletedByTable: v.record(v.string(), v.number()),
        providers: v.array(providerResultValidator),
      }),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    table: DeletableTenantTable;
    deleted: number;
    nextCursor: TenantDeletionCursor | null;
  }> => {
    const tableIndex = args.cursor?.tableIndex ?? 0;
    if (!Number.isInteger(tableIndex) || tableIndex < 0) {
      throw new Error("INVALID_DELETE_CURSOR");
    }

    const tables = deletableTables();
    const table = tables[tableIndex];
    if (!table) throw new Error("INVALID_DELETE_CURSOR");

    if (tenantTableScope(table) === "identity") {
      const user = await ctx.db.get(args.userId);
      if (user && String(user._id) === args.tenantId) {
        const authRowsDeleted = await deleteAuthCredentials(ctx, user._id);
        if (args.completion) {
          const payload: Record<string, string | number | boolean> = {
            tenantIdHash: args.completion.tenantIdHash,
            deleted_authCredentials: authRowsDeleted,
          };
          for (const [deletedTable, count] of Object.entries(args.completion.deletedByTable)) {
            payload[`deleted_${deletedTable}`] = count;
          }
          for (const provider of args.completion.providers) {
            payload[`${provider.provider}LocalRowDeleted`] = provider.localRowDeleted;
            payload[`${provider.provider}RevokedAtProvider`] = provider.revokedAtProvider;
            payload[`${provider.provider}Failure`] = provider.failure;
            // The connector lanes only. After the walk deletes `connectorConnections`, THIS is the
            // only surviving record of whether the grant is actually dead upstream — and it is a
            // closed enum member, never provider prose (CLAUDE.md §4).
            if (provider.revokeUpstream !== undefined) {
              payload[`${provider.provider}RevokeUpstream`] = provider.revokeUpstream;
            }
          }
          await ctx.runMutation(auditLog, {
            tenantId: args.tenantId,
            correlationId: `tenant-delete:${args.completion.tenantIdHash}`,
            eventType: "tenant.deleted",
            // The erasing party is the TENANT acting on itself, which is usually not the
            // deployment owner. Recording "owner" here would put a false actor in the immutable
            // log — provenance the compliance read cannot later correct.
            actor: "user",
            payload,
          });
        }
        // ADR-044 D3(a), owner decision 2026-09-08 — SEVER THE ADMISSION BRIDGE.
        //
        // `betaInvites` is `admission_plane`, which `deletableTables()` structurally cannot reach,
        // so the row survives erasure carrying `email` AND `redeemedUserId`. Because `tenantId` is
        // `String(userId)`, that row joins every audit row's identifier straight back to the erased
        // person's address — which is the named falsifier of the “no personal data” claim on three
        // user-facing surfaces (ADR-044 C2).
        //
        // CLEARED, NOT DELETED, and the distinction is the whole decision. `redeemedAt` stays, so
        // the invite remains SPENT and cannot be re-redeemed; deleting the row would hand a used
        // invite code back to whoever still has it. What goes is the identifying half: the email,
        // the user id, and `redeemedSubject` (`provider|oauthSubject`, which identifies just as
        // well as the address does).
        //
        // BY EMAIL, using the shipped `by_email` index, because there is no index on
        // `redeemedUserId` and a table scan inside the erasure terminal would be a scale defect on
        // the one path that must always finish. The email comes off the `users` row this branch
        // has already loaded — read one line above, before it is deleted.
        //
        // NO EMAIL, NO LOOKUP, and that guard is load-bearing rather than tidy. An invite is
        // reachable only BY the address it names, so a user without one has no bridge to sever —
        // while `q.eq("email", "")` would match every invite ALREADY cleared by this very code, an
        // unbounded `.collect()` growing with each erasure until it trips the per-mutation read
        // limit and WEDGES the one path that must always finish.
        //
        // ponytail: NO TEST GUARDS THIS LINE, deliberately, and the reason is worth recording.
        // Removing it changes nothing observable — the patch below is idempotent on an already
        // cleared row, and the `redeemedUserId` check keeps it off everyone else's — so the harm
        // is READ VOLUME alone, which `convex-test` does not enforce. A test written against this
        // mutation passes, and one that cannot fail is worse than none. Upgrade path: if betaInvites
        // ever grows an index on `redeemedUserId`, look up by that instead and the ambiguity goes.
        const erasedEmail = user.email;
        const invited = erasedEmail
          ? await ctx.db
              .query("betaInvites")
              .withIndex("by_email", (q) => q.eq("email", erasedEmail))
              .collect()
          : [];
        // An invite this address holds but never redeemed is cleared too: it still NAMES the
        // erased person, and they have just deleted the account it would have admitted.
        for (const invite of invited) {
          if (
            invite.redeemedUserId !== undefined &&
            String(invite.redeemedUserId) !== args.tenantId
          )
            continue;
          await ctx.db.patch(invite._id, {
            email: "",
            redeemedUserId: undefined,
            redeemedSubject: undefined,
          });
        }
        await ctx.db.delete(user._id);
      }
      return {
        table,
        deleted: user && String(user._id) === args.tenantId ? 1 : 0,
        nextCursor: null,
      };
    }

    const page = await ctx.db
      .query(table as Exclude<DeletableTenantTable, "users">)
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .take(TENANT_DELETE_BATCH_SIZE + 1);
    const rows = page.slice(0, TENANT_DELETE_BATCH_SIZE);
    // THE BYTES GO FIRST, IN THE SAME TRANSACTION AS THE ROW. Before 2026-09-08 this loop was
    // `ctx.db.delete(row._id)` and nothing else — a case-insensitive grep of this file for
    // "storage" returned ZERO — so erasure deleted the POINTERS to a user's files and left the
    // FILES. With the pointer gone the bytes were unreachable AND unremovable by any product
    // path, which is worse than a leak, while `DataControls.tsx` promised erasure removes
    // "vault documents … generated media".
    //
    // SAME TRANSACTION IS SAFE, and it was established by experiment rather than assumed: a
    // mutation that deletes a blob and then THROWS leaves the blob intact (convex-test probe,
    // 2026-09-08 — `ctx.storage.delete` rolls back with the transaction). So an aborted page
    // rolls back rows and bytes together and the retry redoes both. Had it NOT rolled back, this
    // ordering would wedge the walk for ever: `ctx.storage.delete` THROWS on an already-gone id
    // (`renderReel.ts:644`), so every retry would re-throw on the first blob it had already
    // removed and the tenant could never finish erasing.
    //
    // THE EXISTENCE CHECK IS THAT THROW'S ONLY REAL DEFENCE. Two rows can point at ONE blob —
    // across pages and across tables (a `plans` attachment and an `attachments` row are the
    // shipped case) — and deduping within a page cannot see that. A try/catch would also work and
    // was rejected: it cannot tell "already gone" from a real storage failure, and swallowing the
    // latter deletes the row anyway and strands the bytes forever.
    //
    // `ctx.db.system.get("_storage", id)`, NEVER `ctx.storage.getUrl`. The first draft used getUrl
    // and a shipped source scan (`llmRedaction.test.ts`) went red: a storage URL is a BEARER
    // CAPABILITY, and that guard keeps every one of them inside a tenant-guarded read. Minting one
    // purely to throw it away is exactly what it forbids, and it was right to fire. The system
    // table answers the same question — null when the blob is gone — and mints nothing.
    for (const row of rows) {
      for (const storageId of storageIdsIn(table, row as unknown as Record<string, unknown>)) {
        const id = storageId as Id<"_storage">;
        if ((await ctx.db.system.get("_storage", id)) !== null) await ctx.storage.delete(id);
      }
      // THE RAW DOCUMENT TEXT, which is not in this database at all. `vault.ts` says it in code:
      // the RAG chunks are "the only raw-content stores" — so deleting a `vaultDocuments` row
      // removed the INDEX ENTRY's owner and left the searchable text of the user's documents
      // standing inside the component. An Art. 17 erasure that leaves the prose behind is the
      // clearest possible failure of the promise the UI makes.
      //
      // The narrow per-table branch is deliberate. It mirrors `vault.deleteVaultDoc`'s shipped
      // cascade rather than inventing a second one, and the SMOKE sentinel case it guards against
      // is the same: an offline embed never creates a component entry, so passing that sentinel
      // to `deleteAsync` would violate the component's contract.
      if (table === "vaultDocuments") {
        const ragEntryId = (row as { ragEntryId?: string }).ragEntryId;
        if (
          typeof ragEntryId === "string" &&
          ragEntryId.length > 0 &&
          !ragEntryId.startsWith("smoke")
        )
          await rag.deleteAsync(ctx, { entryId: ragEntryId as EntryId });
      }
      await ctx.db.delete(row._id);
    }

    return {
      table,
      deleted: rows.length,
      nextCursor: {
        tableIndex: page.length > TENANT_DELETE_BATCH_SIZE ? tableIndex : tableIndex + 1,
      },
    };
  },
});

const authorizeTenantDeletionRef = makeFunctionReference<
  "mutation",
  { tenantId: string; userId: Id<"users"> },
  {
    googleConnected: boolean;
    microsoftConnected: boolean;
    billingActive: boolean;
    /** A THIRD copy of a shape that has to move together — the hand-written reference type does
     *  not follow the handler's inference, so a probe added above and not here is a `tsc` error
     *  rather than a silent `undefined` at runtime. It caught this one. */
    connectorGrants: {
      provider: ConnectorProvider;
      environment: "sandbox" | "production";
      sealed: boolean;
    }[];
  }
>("tenantDelete:authorizeTenantDeletion");
/** The billing arm. A `makeFunctionReference`, matching the two above, so this module keeps its
 *  deliberate lack of a static import edge into the feature modules it orchestrates. */
const terminateBillingRef = makeFunctionReference<
  "action",
  { tenantId: string },
  { hadSubscription: boolean; cancelled: boolean; failure: boolean; failureCode?: string }
>("billing:terminateBilling");
/**
 * The three connector lanes that expose an INTERNAL disconnect. `makeFunctionReference` for the
 * same reason as the billing arm: this module names its callees as strings rather than importing
 * four provider modules into the erasure orchestrator.
 *
 * HubSpot is deliberately absent and is called through `api.hubspotAuth.disconnectHubSpot` below —
 * it never grew a `disconnectForTenant`, and its tenant action derives the tenant from the
 * authenticated identity exactly as the Google and Microsoft arms do, so no new surface was added
 * to reach it. That asymmetry is recorded in docs/playbooks/connector-hubspot.md.
 */
const connectorDisconnectRefs = {
  quickbooks: makeFunctionReference<
    "action",
    { tenantId: string; environment: "sandbox" | "production"; confirm: "revoke" },
    { cleared: boolean; upstream: string; statusCode: number | null }
  >("quickbooksAuth:disconnectForTenant"),
  stripe: makeFunctionReference<
    "action",
    { tenantId: string; environment: "sandbox" | "production"; confirm: "revoke" },
    { cleared: boolean; upstream: string; statusCode: number | null }
  >("stripeAuth:disconnectForTenant"),
  paypal: makeFunctionReference<
    "action",
    { tenantId: string; environment: "sandbox" | "production"; confirm: "revoke" },
    { cleared: boolean; upstream: string; statusCode: number | null }
  >("paypalAuth:disconnectForTenant"),
} as const;

const deleteTenantDataPageRef = makeFunctionReference<
  "mutation",
  {
    tenantId: string;
    userId: Id<"users">;
    cursor?: TenantDeletionCursor;
    completion?: {
      tenantIdHash: string;
      deletedByTable: Record<string, number>;
      providers: ProviderDeletionResult[];
    };
  },
  { table: DeletableTenantTable; deleted: number; nextCursor: TenantDeletionCursor | null }
>("tenantDelete:deleteTenantDataPage");

/** Owner-gated, revoke-first orchestration over bounded mutation pages. */
export const deleteTenantData = tenantAction({
  args: { confirmation: v.literal("DELETE MY DATA") },
  handler: async (
    ctx,
  ): Promise<{
    deletedByTable: Record<string, number>;
    providers: ProviderDeletionResult[];
  }> => {
    const connected = await ctx.runMutation(authorizeTenantDeletionRef, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
    });

    let googleRevoked = false;
    let googleFailure = false;
    if (connected.googleConnected) {
      try {
        const result: { revoked: boolean } = await ctx.runAction(
          api.gmailAuth.disconnectGoogle,
          {},
        );
        googleRevoked = result.revoked;
        googleFailure = !result.revoked;
      } catch {
        googleFailure = true;
      }
    }

    let microsoftRevoked = false;
    let microsoftFailure = false;
    if (connected.microsoftConnected) {
      try {
        const result: { deleted: boolean; revokedAtProvider: boolean } = await ctx.runAction(
          api.microsoftAuth.disconnectMicrosoft,
          {},
        );
        microsoftRevoked = result.revokedAtProvider;
        microsoftFailure = !result.deleted;
      } catch {
        microsoftFailure = true;
      }
    }

    // ── THE BILLING ARM (28.1-08, BILL-06) ────────────────────────────────────────────────────
    // THIS MUST STAY ABOVE THE PAGE LOOP. `billingCustomers` is `tenant_owned`, so
    // `deleteTenantDataPage` deletes the row that holds `subscriptionId` — the only place it is
    // stored. An arm moved below the loop would find nothing to cancel and report
    // `hadSubscription: false`, which is indistinguishable from a tenant who never subscribed:
    // a silent, permanent subscription charging a card belonging to nobody. Same shape and same
    // reason as the two revoke-first blocks above.
    //
    // `terminateBilling` never throws — it reports every failure class as a code — so this
    // try/catch is the belt for the unforeseeable, exactly like Google's and Microsoft's.
    let billingCancelled = false;
    let billingFailure = false;
    if (connected.billingActive) {
      try {
        const result: { cancelled: boolean; failure: boolean } = await ctx.runAction(
          terminateBillingRef,
          { tenantId: ctx.tenantId },
        );
        billingCancelled = result.cancelled;
        billingFailure = result.failure;
      } catch {
        billingFailure = true;
      }
    }

    // ── THE CONNECTOR ARM (Phase 28) ──────────────────────────────────────────────────────────
    // THIS MUST STAY ABOVE THE PAGE LOOP, for the same reason as billing: `connectorConnections`
    // is `tenant_credential`, so the loop deletes the row holding the sealed credential the
    // revocation needs. An arm below the loop could only ever report "nothing to revoke".
    //
    // WHAT THIS ARM CAN HONESTLY CLAIM IS NARROW, AND THAT IS THE POINT. Only QuickBooks documents
    // a revocation endpoint. Stripe Apps have no documented platform-initiated revocation, PayPal
    // documents none anywhere, and HubSpot's cascade to already-issued access tokens is unproven.
    // `classifyRevokeOutcome` already refuses to say `confirmed` for those, so this arm reads the
    // upstream state it returns rather than inferring one from "the call did not throw".
    //
    // A LANE THAT CANNOT REVOKE IS NOT A FAILURE. `failure` means we tried and could not, or
    // something faulted — not that the vendor offers nothing. Reporting a documented absence as a
    // failure on every erasure would train the reader to ignore the field, which is precisely how
    // a real failure goes unnoticed. The absence is carried by `revokeUpstream: "unsupported"`.
    const connectorOutcomes = new Map<
      ConnectorProvider,
      { hadRow: boolean; upstreams: RevocationUpstream[]; failure: boolean }
    >();
    for (const grant of connected.connectorGrants) {
      const entry = connectorOutcomes.get(grant.provider) ?? {
        hadRow: false,
        upstreams: [],
        failure: false,
      };
      entry.hadRow = true;
      if (grant.sealed) {
        try {
          const outcome =
            grant.provider === "hubspot"
              ? await ctx.runAction(api.hubspotAuth.disconnectHubSpot, {
                  environment: grant.environment,
                })
              : await ctx.runAction(connectorDisconnectRefs[grant.provider], {
                  tenantId: ctx.tenantId,
                  environment: grant.environment,
                  confirm: "revoke" as const,
                });
          entry.upstreams.push(outcome.upstream as RevocationUpstream);
        } catch {
          // The call itself faulted, so nothing upstream was established. `attempted_failed` is
          // the honest record: we tried, and we do not know that the grant is dead.
          entry.upstreams.push("attempted_failed");
          entry.failure = true;
        }
      }
      connectorOutcomes.set(grant.provider, entry);
    }

    const providers: ProviderDeletionResult[] = [
      {
        provider: "google",
        localRowDeleted: connected.googleConnected,
        revokedAtProvider: googleRevoked,
        failure: googleFailure,
      },
      {
        provider: "microsoft",
        localRowDeleted: connected.microsoftConnected,
        revokedAtProvider: microsoftRevoked,
        failure: microsoftFailure,
      },
      {
        // APPENDED, not inserted: the two existing arms keep their positions so every assertion
        // written against them stays true unchanged. `localRowDeleted` is the mapping row, which
        // the page loop below erases; `revokedAtProvider` is the cancellation at Stripe.
        provider: "billing",
        localRowDeleted: connected.billingActive,
        revokedAtProvider: billingCancelled,
        failure: billingFailure,
      },
      // APPENDED after billing, in `CONNECTOR_PROVIDERS` order, and only for providers that
      // actually had a row — so a tenant who never connected a connector produces the same
      // three-entry array every existing assertion was written against.
      ...CONNECTOR_PROVIDERS.flatMap((provider): ProviderDeletionResult[] => {
        const outcome = connectorOutcomes.get(provider);
        if (outcome === undefined) return [];
        // No sealed grant means nothing was asked of the provider. `not_attempted` says that,
        // rather than `unsupported`, which would libel a provider we never called.
        const upstream =
          outcome.upstreams.length === 0 ? "not_attempted" : leastReassuring(outcome.upstreams);
        return [
          {
            provider,
            localRowDeleted: outcome.hadRow,
            // ONLY `confirmed` earns this. Three of the four lanes can never reach it today, and
            // that is the truth the tenant is owed rather than a defect to paper over.
            revokedAtProvider: upstream === "confirmed",
            failure: outcome.failure,
            revokeUpstream: upstream,
          },
        ];
      }),
    ];

    const deletedByTable: Record<string, number> = {};
    // THE CHAT HISTORY, and it is deleted HERE rather than inside the paged mutation.
    //
    // Agent threads live in the `agent` COMPONENT, so no `by_tenant` row walk can reach them:
    // erasure removed every plan, memo and artifact while the user's actual conversations
    // survived. This is the same call `cockpit.clearChatHistory` makes — the component owns its
    // own message/stream cascade, so reusing it beats a second copy (§8).
    //
    // WHY THE ACTION AND NOT THE `users` TERMINAL PAGE, which is where it first went: it is a
    // ONE-SHOT, not a per-page step, and putting a component call inside `deleteTenantDataPage`
    // forced every harness that drives the walk to register the whole `agent` module tree. Six
    // test harnesses went red at once, and 19-02/19-05 record that each extra `registerComponent`
    // loads another module tree into another in-memory backend. The orchestrator is the honest
    // home for a one-shot; the page mutation stays a row walk.
    //
    // BEFORE the walk, deliberately. The component deletes a bounded first page inline and
    // SCHEDULES the rest, so it must be started while the tenant's rows — and the authorization
    // this action already performed — still stand. It is idempotent: a second erasure of an
    // already-empty user is a no-op.
    await ctx.runMutation(components.agent.users.deleteAllForUserIdAsync, {
      userId: ctx.tenantId,
    });

    let cursor: TenantDeletionCursor | undefined;
    do {
      const currentTable = deletableTables()[cursor?.tableIndex ?? 0];
      const completion =
        currentTable === "users"
          ? {
              tenantIdHash: await contentHash(ctx.tenantId),
              deletedByTable: { ...deletedByTable, users: 1 },
              providers,
            }
          : undefined;
      const page = await ctx.runMutation(deleteTenantDataPageRef, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        ...(cursor ? { cursor } : {}),
        ...(completion ? { completion } : {}),
      });
      deletedByTable[page.table] = (deletedByTable[page.table] ?? 0) + page.deleted;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    return { deletedByTable, providers };
  },
});

/**
 * THE EVAL HARNESS'S TEARDOWN — delete one SYNTHETIC eval tenant, rows and blobs.
 *
 * WHY IT EXISTS, measured on production 2026-09-08. `run-eval-golden.mjs` mints a throwaway
 * `eval-<runId>` tenant per run and `run-workflow-pack-evals.mjs` a `packeval-<runId>` one, and
 * NEITHER has ever cleaned up. The result, on the live deployment: **472 of 632 `plans` rows, 189 of
 * 733 `vaultDocuments`, and 1007 of 1894 AUDIT rows belonged to 18 synthetic tenants**, plus 140
 * orphaned blobs (65 MB) that no row referenced at all. Every gate run made it worse.
 *
 * That is not merely untidy. ADR-044 holds the WORM export OFF, and its second and stronger reason
 * is now this: arming it would freeze a MAJORITY-SYNTHETIC archive into 7-year COMPLIANCE objects
 * that cannot be deleted for seven years. Cleaning the debris is a precondition for that decision,
 * not housekeeping.
 *
 * WHY IT IS NOT `deleteTenantDataPage`. That path authorizes on `String(userId) === tenantId` and
 * takes an `Id<"users">` — it can only ever erase a REAL account, which is exactly right for
 * Art. 17 and exactly useless here: an eval tenant is a bare synthetic string with no `users` row.
 * Reusing it would have meant loosening its authorization, which is the one thing that must not
 * happen to the erasure terminal.
 *
 * THE SAFETY PROPERTY IS THE PREFIX, and it is checked FIRST, before a single row is read. This
 * function is structurally incapable of touching a real tenant: a real `tenantId` IS
 * `String(userId)`, a Convex id, and no Convex id can begin `eval-` or `packeval-`. That is why an
 * `internalMutation` with no owner check is safe here — the argument it would need to do harm
 * cannot be constructed.
 *
 * Blobs go FIRST, via the same `storageIdsIn` map the erasure walk reads (44-01), so the two cannot
 * drift and a table one clears is a table the other clears. `ctx.storage.delete` throws on an
 * already-gone id, so existence is checked through the `_storage` SYSTEM table rather than
 * `getUrl` — minting a bearer capability only to discard it is what `llmRedaction.test.ts` forbids.
 *
 * A PREFIX RANGE, not an equality, and that is required rather than convenient. A run does not mint
 * ONE tenant: `authoringTenantFor` derives `eval-<runId>-<fixture>-a<attempt>` for every authoring
 * fixture, so the five `agent-author-*` cases leave four or five extra tenants behind. An exact
 * match would purge the parent and leave the children — the same partial cleanup that produced the
 * mess, wearing a fix's clothes. The range is safe because the run id is the prefix: `runId` is 8
 * hex characters, so nothing outside this run's own family can fall inside it.
 *
 * PAGED and IDEMPOTENT. Returns `done` when a full pass moved nothing, so a caller loops until then.
 */
export const purgeEvalTenant = internalMutation({
  args: {
    tenantId: v.string(),
    limit: v.optional(v.number()),
    exact: v.optional(v.boolean()),
    preserveAuditId: v.optional(v.id("audit")),
    preserveSpendEvents: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ deleted: number; blobs: number; done: boolean; tenantId: string }> => {
    // FIRST, and before any read. See the safety property above.
    if (!/^(eval|packeval)-/.test(args.tenantId)) {
      throw new Error("NOT_AN_EVAL_TENANT");
    }
    if (args.preserveSpendEvents && !args.exact)
      throw new Error("EVAL_ACCOUNTING_RETENTION_REQUIRES_EXACT");
    const budget = Math.max(args.preserveAuditId ? 2 : 1, Math.min(args.limit ?? 200, 1000));
    let deleted = 0;
    let blobs = 0;
    const checkedVerticalTenants = new Set<string>();
    const checkVerticalRetention = async (tenantId: string) => {
      if (checkedVerticalTenants.has(tenantId)) return;
      const provision = await ctx.db
        .query("audit")
        .withIndex("by_tenant_event_ts", (q) =>
          q.eq("tenantId", tenantId).eq("eventType", "vertical_eval.provisioned"),
        )
        .unique();
      if (provision) {
        // Every page checks this authority in the same transaction as deletion. Prefix cleanup
        // cannot destroy pending review assets or the accounting needed by native issuance.
        if (!args.exact || !args.preserveSpendEvents || args.preserveAuditId !== provision._id)
          throw new Error("VERTICAL_EVAL_REQUIRES_NATIVE_CLEANUP");
        await ctx.runMutation(internal.verticalEvalEvidence.claimCleanup, {
          runId: provision.payload.runId,
          caseId: provision.payload.caseId,
          caseHash: provision.payload.caseHash,
          requestHash: provision.payload.requestHash,
          verticalId: provision.payload.verticalId,
          candidateVersion: provision.payload.candidateVersion,
          bodyHash: provision.payload.bodyHash,
        });
      }
      checkedVerticalTenants.add(tenantId);
    };

    for (const table of deletableTables()) {
      // `users` is the identity table and an eval tenant has no row in it; the `by_tenant` index
      // does not exist there either, so asking would throw rather than return nothing.
      if (table === "users") continue;
      if (table === "spendEvents" && args.preserveSpendEvents) continue;
      if (deleted >= budget) break;
      const rows = await ctx.db
        .query(table as Exclude<DeletableTenantTable, "users">)
        .withIndex("by_tenant", (q) =>
          args.exact
            ? q.eq("tenantId", args.tenantId)
            : q.gte("tenantId", args.tenantId).lt("tenantId", `${args.tenantId}\uffff`),
        )
        .take(budget - deleted);
      for (const row of rows) {
        await checkVerticalRetention(row.tenantId);
        for (const storageId of storageIdsIn(table, row as unknown as Record<string, unknown>)) {
          const id = storageId as Id<"_storage">;
          if ((await ctx.db.system.get("_storage", id)) !== null) {
            await ctx.storage.delete(id);
            blobs += 1;
          }
        }
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }

    // The AUDIT rows are the whole point of this for the WORM decision, and they are the reason
    // this function exists rather than a `deletableTables()` loop alone: `audit` is
    // `audit_immutable`, so `deletableTables()` structurally cannot reach it and the erasure
    // terminal must never touch it. For a SYNTHETIC tenant there is no Art. 17 interest and no
    // integrity claim to preserve — the rows describe a robot talking to itself. CLAUDE.md §3's
    // insert-only rule protects a real tenant's history; it is not a reason to keep 1007 rows of
    // test exhaust in an archive somebody is about to freeze for seven years.
    if (deleted < budget) {
      const checkpoint = await ctx.db
        .query("exportCursors")
        .withIndex("by_name", (q) => q.eq("name", CURSOR_NAME))
        .unique();
      const pending = new Set(checkpoint?.pendingAuditIds ?? []);
      const auditRows = await ctx.db
        .query("audit")
        .withIndex("by_tenant_ts", (q) =>
          args.exact
            ? q.eq("tenantId", args.tenantId)
            : q.gte("tenantId", args.tenantId).lt("tenantId", `${args.tenantId}\uffff`),
        )
        .take(budget - deleted + (args.preserveAuditId ? 1 : 0));
      for (const row of auditRows.slice(0, budget - deleted)) {
        await checkVerticalRetention(row.tenantId);
        // Freeze wins over teardown: a failed/ongoing upload must retain identical
        // bytes. Reading its checkpoint also serializes this decision with beginExport.
        if (pending.has(row._id)) throw new Error("EVAL_AUDIT_EXPORT_PENDING");
        // Keep the case authority across pages and interrupted/frozen cleanup. Delete it only
        // in the same transaction that proves every tenant table and every other audit is empty.
        const terminalReceipt =
          row._id === args.preserveAuditId && deleted === 0 && auditRows.length === 1;
        if (row._id === args.preserveAuditId && !terminalReceipt) continue;
        const queued = await ctx.db
          .query("auditExportQueue")
          .withIndex("by_audit", (q) => q.eq("auditId", row._id))
          .unique();
        if (queued) await ctx.db.delete(queued._id);
        await ctx.db.delete(row._id);
        deleted += 1;
        if (terminalReceipt) return { deleted, blobs, done: true, tenantId: args.tenantId };
      }
    }

    return { deleted, blobs, done: deleted === 0, tenantId: args.tenantId };
  },
});

/**
 * THE FLOOR UNDER `reapOrphanedBlobs`, and the single most important line in it.
 *
 * Intake and requests are UPLOAD-FIRST: `generateUploadUrl` hands the client a URL, the client PUTs
 * the bytes, and only THEN does `attachToThread` write the row that points at them. So a blob with
 * no referencing row is not necessarily garbage — for a few seconds it is a user's file, mid-flight.
 * A reaper without an age floor deletes it and the upload fails for a reason nobody can reconstruct.
 *
 * Twenty-four hours is absurdly generous for an HTTP PUT and costs nothing: every orphan measured on
 * production (2026-09-09) was between 19 and 27 days old.
 */
export const ORPHAN_REAP_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * DELETE STORED BYTES THAT NO ROW POINTS AT — and finish an erasure the product promised.
 *
 * WHAT THESE FILES ARE. Until 44-01, erasure deleted a row and left its blob: `deleteTenantDataPage`
 * and `vault.deleteVaultDoc` both removed the POINTER and kept the BYTES, which made those bytes
 * unreachable AND unremovable by any product path. Measured on production 2026-09-09: 142 blobs,
 * 65.2 MB, every one created between 2026-08-13 and 2026-08-21, referenced by no field of any row.
 * The archive contains exactly ONE `tenant.deleted` event, and that erasure ran before 44-01 — so
 * some of these bytes belong to a person who asked to be forgotten and was told they had been.
 * Reaping them is not housekeeping; it is completing an Art. 17 request.
 *
 * A TENANT PURGE CANNOT REACH THEM, which is why this exists separately. `purgeEvalTenant` and the
 * erasure walk delete blobs REFERENCED BY the rows they delete. These are referenced by nothing, so
 * no row-shaped cleanup will ever find them — the reference is exactly what was lost.
 *
 * THE TWO GUARDS, and both are load-bearing:
 *   1. AGE. See `ORPHAN_REAP_MIN_AGE_MS` — the upload-first race is real and this is the only thing
 *      standing between a reaper and a user's in-flight file.
 *   2. THE REFERENCE SET is built from `STORAGE_ID_FIELDS`, the SAME map the erasure walk and the
 *      export read (44-01, ADR-045). A field added to the schema and not to that map would make this
 *      delete live bytes — which is precisely why a field-level drift guard already parses
 *      `schema.ts` and reddens when the two disagree. Do not hand-roll a second list here.
 *
 * `dryRun` reports what it WOULD delete and touches nothing. Use it first, every time: this is the
 * one function in the repo that permanently destroys bytes no other path can recreate.
 */
export const reapOrphanedBlobs = internalMutation({
  args: {
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    olderThanMs: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    scanned: number;
    orphans: number;
    deleted: number;
    bytes: number;
    done: boolean;
  }> => {
    const minAge = Math.max(args.olderThanMs ?? ORPHAN_REAP_MIN_AGE_MS, ORPHAN_REAP_MIN_AGE_MS);
    const cutoff = Date.now() - minAge;
    const budget = Math.min(args.limit ?? 200, 1000);

    // EVERY reference, from the shared map. Built once per call and held in memory: after the 45-02
    // purge the storage-bearing tables hold a few hundred rows in total, so this is cheap — but it
    // is also why this is a paged mutation rather than a single sweep, because "cheap" is a fact
    // about today's row count and not a guarantee.
    const referenced = new Set<string>();
    for (const table of Object.keys(STORAGE_ID_FIELDS)) {
      const rows = await ctx.db.query(table as Exclude<DeletableTenantTable, "users">).collect();
      for (const row of rows) {
        for (const id of storageIdsIn(table, row as unknown as Record<string, unknown>)) {
          referenced.add(id);
        }
      }
    }

    let scanned = 0;
    let orphans = 0;
    let deleted = 0;
    let bytes = 0;
    const blobs = await ctx.db.system.query("_storage").take(budget);
    for (const blob of blobs) {
      scanned += 1;
      if (referenced.has(blob._id)) continue;
      // The age floor, applied to the ORPHAN and not to the scan: a young referenced blob is fine,
      // a young UNREFERENCED one is the in-flight upload this must not touch.
      if (blob._creationTime > cutoff) continue;
      orphans += 1;
      if (args.dryRun === true) continue;
      await ctx.storage.delete(blob._id);
      deleted += 1;
      bytes += blob.size ?? 0;
    }

    return { scanned, orphans, deleted, bytes, done: blobs.length < budget };
  },
});

/**
 * ADR-044 D4 — THE ONE-TIME SWEEP, for people erased BEFORE D3(a) shipped.
 *
 * D3(a) severs the admission bridge at erasure time, which does nothing for anyone already erased:
 * their `betaInvites` row still carries `email` + `redeemedUserId`, and that is exactly the
 * population Art. 17 protects. A fix that is forward-only would let the claim read as closed while
 * the people it matters most for still have a live join.
 *
 * IT NEEDS NO LIST OF WHO WAS ERASED, and that is what makes it safe to run: the test is simply
 * whether `redeemedUserId` still resolves to a live `users` document. A dangling pointer means the
 * account is gone; a live one means it is not. There is nothing to look up, nothing to remember,
 * and no way to clear a row belonging to a living user.
 *
 * PAGED and IDEMPOTENT. `betaInvites` has no index on `redeemedUserId`, so this is a scan — bounded
 * per call, resumable by cursor, and a second run over swept rows finds nothing to do. Run it from
 * the owner's terminal until `done: true`.
 */
export const sweepOrphanedInviteIdentities = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ scanned: number; cleared: number; cursor: string | null; done: boolean }> => {
    const page = await ctx.db
      .query("betaInvites")
      .paginate({ cursor: args.cursor ?? null, numItems: Math.min(args.limit ?? 100, 500) });
    let cleared = 0;
    for (const invite of page.page) {
      // An UNREDEEMED invite is not an orphan — it never named anybody. Only a redemption that
      // points at a deleted account is one.
      if (invite.redeemedUserId === undefined) continue;
      if ((await ctx.db.get(invite.redeemedUserId)) !== null) continue;
      await ctx.db.patch(invite._id, {
        email: "",
        redeemedUserId: undefined,
        redeemedSubject: undefined,
      });
      cleared += 1;
    }
    return {
      scanned: page.page.length,
      cleared,
      cursor: page.continueCursor,
      done: page.isDone,
    };
  },
});
