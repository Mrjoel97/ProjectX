import {
  type DeletableTenantTable,
  deletableTables,
  type TenantDeletionCursor,
  tenantTableScope,
} from "@pikar/core/tenantData";
import type { RevocationUpstream } from "@pikar/revenue";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { tenantAction } from "./lib/functions";
import { contentHash } from "./lib/hash";

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
    for (const row of rows) await ctx.db.delete(row._id);

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
