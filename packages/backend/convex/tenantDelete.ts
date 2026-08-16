import {
  type DeletableTenantTable,
  deletableTables,
  type TenantDeletionCursor,
  tenantTableScope,
} from "@pikar/core/tenantData";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { tenantAction } from "./lib/functions";
import { contentHash } from "./lib/hash";

export const TENANT_DELETE_BATCH_SIZE = 2;

type ProviderDeletionResult = {
  provider: "google" | "microsoft";
  localRowDeleted: boolean;
  revokedAtProvider: boolean;
  failure: boolean;
};

const deletionCursorValidator = v.object({ tableIndex: v.number() });
const providerResultValidator = v.object({
  provider: v.union(v.literal("google"), v.literal("microsoft")),
  localRowDeleted: v.boolean(),
  revokedAtProvider: v.boolean(),
  failure: v.boolean(),
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
    return { googleConnected: !!google, microsoftConnected: !!microsoft };
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
  { googleConnected: boolean; microsoftConnected: boolean }
>("tenantDelete:authorizeTenantDeletion");
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
