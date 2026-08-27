// Phase 28 connector credential lifecycle — the THIN adapter (CLAUDE.md §1).
//
// All of the cryptography lives in `@pikar/revenue/credential`, which knows nothing about Convex.
// This module does the three things that package cannot: read the deployment key out of Convex
// environment configuration, persist what comes back, and project a client-safe status.
//
// NOT "use node": these are DB helpers (internalQuery/internalMutation) plus one client-safe
// tenantQuery, exactly like `gmailAuth.ts`. Provider callback handlers and refresh actions live in
// their own modules and reach these through ctx.runQuery/runMutation.
//
// THE CROWN-JEWEL RULE, inherited verbatim from `gmailAuth.ts` and then tightened: the sealed
// credential is read by internal functions ONLY, never returned to a client query, and never
// placed in an audit or dead-letter payload (CLAUDE.md §4). There is deliberately NO public
// mutation here — only a provider callback handler may create or replace an envelope
// (28-RESEARCH), and `connectorCredentials.test.ts` scans this file to keep it that way.
import {
  type ConnectorEnvironment,
  type CredentialKey,
  type CredentialKeyVersion,
  importCredentialKey,
} from "@pikar/revenue";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { tenantQuery } from "./lib/functions";

// ── Argument validators, spelled once ─────────────────────────────────────────────────────

const providerArg = v.union(
  v.literal("hubspot"),
  v.literal("quickbooks"),
  v.literal("stripe"),
  v.literal("paypal"),
);
const environmentArg = v.union(v.literal("sandbox"), v.literal("production"));
const keyVersionArg = v.union(v.literal("v1"), v.literal("v2"));
const failureClassArg = v.union(
  v.literal("reauth"),
  v.literal("forbidden"),
  v.literal("rate_limited"),
  v.literal("provider_error"),
  v.literal("unsupported_account"),
  v.literal("network"),
  v.literal("timeout"),
);

/** The tuple that identifies a connection everywhere in this module. */
const connectionArgs = {
  tenantId: v.string(),
  provider: providerArg,
  environment: environmentArg,
} as const;

// ── Key access ────────────────────────────────────────────────────────────────────────────

/**
 * The deployment key, per version. FAILS CLOSED — a missing key THROWS.
 *
 * `p25-no-dev-fallback` in the readiness gate exists precisely to forbid the alternative. A
 * connector that quietly falls back to a development key writes rows that look encrypted and are
 * not, and the failure is invisible until someone reads the database.
 *
 * The base64 never appears in an error message, a log line or a return value.
 */
export async function requireCredentialKey(
  version: CredentialKeyVersion = "v1",
): Promise<CredentialKey> {
  const name = version === "v1" ? "CONNECTOR_CREDENTIAL_KEY_V1" : "CONNECTOR_CREDENTIAL_KEY_V2";
  const raw = process.env[name];
  if (!raw) throw new Error(`Connector credential key not configured: ${name}`);
  return importCredentialKey(raw, version);
}

/** A fresh opaque connection id. Server-minted and bound into the credential AAD. */
export function newConnectionId(): string {
  return `conn_${crypto.randomUUID()}`;
}

/**
 * SHA-256 hex of a provider account/realm id, so re-consent can prove the SAME account came back
 * (28-RESEARCH callback step 3) without the id ever sitting in a column. Same hex idiom as
 * `gmailAuth.hmacHex`.
 */
export async function hashExternalAccountId(externalAccountId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(externalAccountId));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Row access (internal only) ────────────────────────────────────────────────────────────

/** The one lookup every internal caller uses. Returns the FULL row, credential included. */
export const get = internalQuery({
  args: connectionArgs,
  handler: async (ctx, { tenantId, provider, environment }) =>
    ctx.db
      .query("connectorConnections")
      .withIndex("by_tenant_provider_environment", (q) =>
        q.eq("tenantId", tenantId).eq("provider", provider).eq("environment", environment),
      )
      .unique(),
});

/**
 * Create or replace the sealed credential after a consent callback.
 *
 * PATCHES an existing row rather than deleting and re-inserting it, unlike `gmailAuth.store`. That
 * module deletes to reset `_creationTime` for Google's 7-day testing-mode refresh clock; here the
 * row's `revocation` history and its `revision` fence are worth keeping, and no provider clock
 * hangs off `_creationTime`.
 */
export const upsertSealed = internalMutation({
  args: {
    ...connectionArgs,
    connectionId: v.string(),
    credentialCiphertextB64: v.string(),
    credentialIvB64: v.string(),
    keyVersion: keyVersionArg,
    accessExpiresAt: v.optional(v.number()),
    refreshExpiresAt: v.optional(v.number()),
    externalAccountHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { tenantId, provider, environment, ...rest } = args;
    const now = Date.now();
    const existing = await ctx.db
      .query("connectorConnections")
      .withIndex("by_tenant_provider_environment", (q) =>
        q.eq("tenantId", tenantId).eq("provider", provider).eq("environment", environment),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...rest,
        status: "connected",
        revision: existing.revision + 1,
        connectedAt: now,
        updatedAt: now,
        // A fresh consent retires the previous terminal state and the stale failure banner.
        revocation: undefined,
        lastFailureClass: undefined,
        lastFailureAt: undefined,
        refreshLeaseId: undefined,
        refreshLeaseExpiresAt: undefined,
      });
      return existing._id;
    }

    return ctx.db.insert("connectorConnections", {
      tenantId,
      provider,
      environment,
      status: "connected",
      revision: 1,
      connectedAt: now,
      updatedAt: now,
      ...rest,
    });
  },
});

// ── Refresh: single-flight lease + compare-and-set ────────────────────────────────────────

/**
 * Take the refresh lease, or refuse.
 *
 * WHY A LEASE AT ALL. Intuit documents that two concurrent refreshes with the same refresh token
 * leave the first successful and the second `invalid_grant` — and that Intuit's servers MAY then
 * revoke the token the first call issued, so the next refresh also fails and the user must
 * re-consent. A racing refresh does not merely fail; it can kill the connection. The other three
 * providers must not inherit this logic without their own evidence (28-RESEARCH), but the lease is
 * harmless for them and the seam has to exist somewhere.
 *
 * An EXPIRED lease is takeable: a refresher that crashed mid-flight must not wedge the connection
 * forever. That is exactly why `revision` exists as well — see `commitRefresh`.
 */
export const acquireRefreshLease = internalMutation({
  args: { ...connectionArgs, leaseId: v.string(), ttlMs: v.number() },
  handler: async (
    ctx,
    { tenantId, provider, environment, leaseId, ttlMs },
  ): Promise<{ ok: boolean; revision?: number }> => {
    const row = await ctx.db
      .query("connectorConnections")
      .withIndex("by_tenant_provider_environment", (q) =>
        q.eq("tenantId", tenantId).eq("provider", provider).eq("environment", environment),
      )
      .unique();
    if (!row) return { ok: false };

    const now = Date.now();
    const heldUntil = row.refreshLeaseExpiresAt ?? 0;
    if (row.refreshLeaseId && heldUntil > now && row.refreshLeaseId !== leaseId) {
      return { ok: false };
    }
    await ctx.db.patch(row._id, {
      refreshLeaseId: leaseId,
      refreshLeaseExpiresAt: now + ttlMs,
      updatedAt: now,
    });
    return { ok: true, revision: row.revision };
  },
});

/**
 * Replace BOTH tokens, atomically, or do nothing.
 *
 * The credential is ONE sealed blob, so "replace access and refresh together" is a single-field
 * patch inside one Convex transaction — there is no window in which the row holds a new access
 * token beside a dead refresh token.
 *
 * TWO guards, not one. The lease stops a concurrent refresher from starting; `revision` is the
 * FENCING TOKEN that stops one which already started, slept past its lease, and came back with a
 * stale credential. A lease without a fencing token is a lock that lies.
 */
export const commitRefresh = internalMutation({
  args: {
    ...connectionArgs,
    leaseId: v.string(),
    revision: v.number(),
    credentialCiphertextB64: v.string(),
    credentialIvB64: v.string(),
    keyVersion: keyVersionArg,
    accessExpiresAt: v.optional(v.number()),
    refreshExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const { tenantId, provider, environment, leaseId, revision, ...credential } = args;
    const row = await ctx.db
      .query("connectorConnections")
      .withIndex("by_tenant_provider_environment", (q) =>
        q.eq("tenantId", tenantId).eq("provider", provider).eq("environment", environment),
      )
      .unique();
    if (!row) return { ok: false };
    // The fence and the lease, in that order: a stale revision is refused even by the holder.
    if (row.revision !== revision) return { ok: false };
    if (row.refreshLeaseId !== leaseId) return { ok: false };
    // A disconnect that landed mid-refresh wins. Re-sealing a revoked connection would resurrect
    // a grant the user asked us to drop.
    if (row.status === "revoked") return { ok: false };

    await ctx.db.patch(row._id, {
      ...credential,
      status: "connected",
      revision: row.revision + 1,
      lastFailureClass: undefined,
      lastFailureAt: undefined,
      refreshLeaseId: undefined,
      refreshLeaseExpiresAt: undefined,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

// ── Revocation ────────────────────────────────────────────────────────────────────────────

/**
 * Record a disconnect: clear the local ciphertext, KEEP the row, and record what actually
 * happened upstream.
 *
 * THE ROW SURVIVES ON PURPOSE, unlike `gmailAuth.deleteTokens`. Google's revoke is confirmed to
 * kill the whole grant, so there is nothing left to say and deleting the row loses nothing. Three
 * of the four Phase 28 providers are not like that: Stripe Apps has no documented
 * platform-initiated revoke, PayPal documents no revocation endpoint at all, and HubSpot's cascade
 * to already-issued access tokens is unproven. For those, local deletion may be the ONLY
 * revocation Pikar can perform — and the surviving `revocation` record is the only place that
 * truth can live. Delete the row and the connections surface has nothing left to be honest with.
 *
 * The caller passes what it OBSERVED. It must never pass `confirmed` for a provider it never
 * called; `unsupported` is the honest value there.
 *
 * Tenant erasure still removes the row: the table is `tenant_credential` and rides the normal
 * `tenantDelete` walk. Disconnect and erasure are different operations and stay that way.
 */
export const recordRevocation = internalMutation({
  args: {
    ...connectionArgs,
    upstream: v.union(
      v.literal("confirmed"),
      v.literal("attempted_failed"),
      v.literal("unsupported"),
      v.literal("not_attempted"),
    ),
    /** The provider's HTTP status CODE only — never a body (CLAUDE.md §4). */
    statusCode: v.optional(v.number()),
    /** HubSpot's unproven cascade: when already-issued access tokens actually stop working. */
    residualAccessUntil: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ cleared: boolean }> => {
    const { tenantId, provider, environment, upstream, statusCode, residualAccessUntil } = args;
    const row = await ctx.db
      .query("connectorConnections")
      .withIndex("by_tenant_provider_environment", (q) =>
        q.eq("tenantId", tenantId).eq("provider", provider).eq("environment", environment),
      )
      .unique();
    if (!row) return { cleared: false };

    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "revoked",
      credentialCiphertextB64: undefined,
      credentialIvB64: undefined,
      accessExpiresAt: undefined,
      refreshExpiresAt: undefined,
      refreshLeaseId: undefined,
      refreshLeaseExpiresAt: undefined,
      revision: row.revision + 1,
      revocation: {
        upstream,
        attemptedAt: now,
        localClearedAt: now,
        statusCode,
        residualAccessUntil,
      },
      updatedAt: now,
    });
    return { cleared: true };
  },
});

// ── Read outcomes ─────────────────────────────────────────────────────────────────────────

/**
 * Stamp the result of a provider read. A CLASS, never a message: vendor error text can embed
 * account ids and customer names, and this row feeds a client-facing projection (CLAUDE.md §4).
 *
 * A `reauth` failure is the one that changes the connection's state, because it is the one the
 * user can act on. Everything else is a transient the UI should describe without demanding a
 * reconnect the user does not need.
 */
export const recordReadOutcome = internalMutation({
  args: { ...connectionArgs, failureClass: v.optional(failureClassArg) },
  handler: async (ctx, { tenantId, provider, environment, failureClass }) => {
    const row = await ctx.db
      .query("connectorConnections")
      .withIndex("by_tenant_provider_environment", (q) =>
        q.eq("tenantId", tenantId).eq("provider", provider).eq("environment", environment),
      )
      .unique();
    if (!row) return;

    const now = Date.now();
    // A read that completes AFTER a disconnect must not resurrect the connection. The terminal
    // state wins; only a fresh consent (`upsertSealed`) leaves it.
    const revoked = row.status === "revoked";
    if (!failureClass) {
      await ctx.db.patch(row._id, {
        lastReadAt: now,
        lastFailureClass: undefined,
        lastFailureAt: undefined,
        status: revoked ? row.status : "connected",
        updatedAt: now,
      });
      return;
    }
    await ctx.db.patch(row._id, {
      lastFailureClass: failureClass,
      lastFailureAt: now,
      status: revoked ? row.status : failureClass === "reauth" ? "reauth_required" : row.status,
      updatedAt: now,
    });
  },
});

// ── The one client-safe surface ───────────────────────────────────────────────────────────

/**
 * What a connection looks like to a browser. EVERYTHING dangerous is absent by construction rather
 * than by a filter someone could forget: no ciphertext, no IV, no key version, no connection id,
 * no external account hash, no revision, no lease, no provider status code.
 *
 * `revocation` is projected WITHOUT `statusCode` and WITHOUT `attemptedAt` but WITH `upstream` and
 * `residualAccessUntil`, because those two are the ones the user's sentence depends on:
 * "disconnected — your PayPal grant stays live until you remove it in PayPal" versus
 * "disconnected and revoked". Collapsing them into a boolean is the lie this whole shape exists
 * to prevent.
 *
 * 28-09 builds the Connections panel on top of this and adds the provider-gate filtering; this is
 * the credential module's own honest read, not the finished surface.
 */
export type ConnectionStatusView = {
  provider: Doc<"connectorConnections">["provider"];
  environment: ConnectorEnvironment;
  status: Doc<"connectorConnections">["status"];
  connectedAt: number | null;
  accessExpiresAt: number | null;
  lastReadAt: number | null;
  lastFailureClass: Doc<"connectorConnections">["lastFailureClass"] | null;
  lastFailureAt: number | null;
  revocation: {
    upstream: NonNullable<Doc<"connectorConnections">["revocation"]>["upstream"];
    residualAccessUntil: number | null;
  } | null;
};

export const connectorStatuses = tenantQuery({
  args: {},
  handler: async (ctx): Promise<ConnectionStatusView[]> => {
    const rows = await ctx.db
      .query("connectorConnections")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect();
    return rows.map((row) => ({
      provider: row.provider,
      environment: row.environment,
      status: row.status,
      connectedAt: row.connectedAt ?? null,
      accessExpiresAt: row.accessExpiresAt ?? null,
      lastReadAt: row.lastReadAt ?? null,
      lastFailureClass: row.lastFailureClass ?? null,
      lastFailureAt: row.lastFailureAt ?? null,
      revocation: row.revocation
        ? {
            upstream: row.revocation.upstream,
            residualAccessUntil: row.revocation.residualAccessUntil ?? null,
          }
        : null,
    }));
  },
});
