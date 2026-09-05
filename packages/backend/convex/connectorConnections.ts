/**
 * The tenant-facing connector surface: ONE gate-derived projection, and one dispatcher each for
 * starting and ending a connection.
 *
 * WHY THIS EXISTS RATHER THAN THE UI READING `connectorCredentials.connectorStatuses`.
 * That query returns every row the tenant has, for every provider, whatever its lane. It is the
 * right shape for the lane runner and the wrong shape for a product surface: a provider whose lane
 * was never proven — or was proven and then broke — would keep rendering as a working integration
 * because the tenant happens to hold a row for it. Discovery has to be a function of the GATE, not
 * of what the tenant connected before the gate said no.
 *
 * SO THE SHAPE IS: iterate the gates THIS CALLER may start a consent for, then look up the tenant's
 * row for each. A tenant row with no such gate contributes nothing — it is not "disconnected", it is
 * absent, the same way `workflowPackDiscovery.listPacks` makes a non-active pack invisible by
 * construction rather than by every caller remembering to filter (the Phase 27 prior art
 * `providerGates` was built on).
 *
 * WHY "MAY START A CONSENT FOR" AND NOT "PASSED". For a tenant those are the same set. For the
 * OWNER they are not: `providerGates.connectStartAllowed` deliberately admits an unproven lane for
 * the owner alone, because somebody has to complete a real grant before wave 7 can judge that lane.
 * This surface used to filter on `passed` independently, which made that branch reachable by no
 * caller at all — the gate said yes and no button existed to ask it. Both now read ONE predicate
 * (`connectableProviderGates`), so the surface cannot be stricter than the gate again. An unproven
 * row is marked `unproven` rather than hidden, and says so where it renders.
 *
 * WHAT IT DELIBERATELY DOES NOT RETURN: the evidence ref, the gate revision, the review date, the
 * external account hash, the ciphertext, the connection id. A surface that could see the review
 * date would start rendering "expiring soon" and treat an admission as a status; a surface that
 * could see the connection id could put it in a URL.
 */
import type { ConnectorEnvironment, Provider } from "@pikar/revenue";
import { v } from "convex/values";
import { api } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import { PROVIDER_REVOKE_SUPPORT } from "./connectorOAuth";
import { tenantAction, tenantQuery } from "./lib/functions";
import { connectableProviderGates } from "./providerGates";

const environmentArg = v.union(v.literal("sandbox"), v.literal("production"));
const providerArg = v.union(
  v.literal("hubspot"),
  v.literal("quickbooks"),
  v.literal("stripe"),
  v.literal("paypal"),
);

/**
 * What one connectable provider looks like to a browser.
 *
 * `revokeSupport` is here and it is not decoration: it is what lets the disconnect button tell the
 * truth BEFORE it is pressed. For three of the four lanes, disconnecting deletes Pikar's copy and
 * leaves the grant live at the provider, and a button that says only "Disconnect" promises
 * something the code cannot do.
 */
export type ConnectorView = {
  provider: Provider;
  environment: ConnectorEnvironment;
  /** `false` means "connectable but not connected" — never "not available". */
  connected: boolean;
  status: "connecting" | "connected" | "reauth_required" | "revoked" | "failed" | null;
  connectedAt: number | null;
  lastReadAt: number | null;
  /** A CLOSED class, never provider prose (CLAUDE.md §4). */
  lastFailureClass: string | null;
  /** Whether a revoke here can actually kill the grant upstream. */
  revokeSupport: "confirmed" | "unproven" | "unsupported";
  /** Set only after a disconnect that could not revoke upstream — the sentence the tenant is owed. */
  grantRemainsLiveUpstream: boolean;
  /**
   * This lane has NOT passed its gate and is visible only because the caller is the owner.
   *
   * It is here so the row can say so. An unproven lane looks identical to a proven one at this
   * layer — same provider, same buttons — and rendering it unmarked would present a connector that
   * has never spoken to its vendor as a finished integration.
   */
  unproven: boolean;
};

async function viewFor(
  ctx: QueryCtx,
  tenantId: string,
  isOwner: boolean,
): Promise<ConnectorView[]> {
  const connectable = await connectableProviderGates(ctx, Date.now(), isOwner);
  if (connectable.length === 0) return [];

  const rows = await ctx.db
    .query("connectorConnections")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();

  return connectable.map(({ provider, environment, unproven }) => {
    const row = rows.find((r) => r.provider === provider && r.environment === environment);
    return {
      provider,
      environment,
      // A row with no ciphertext is a disconnected row that survives to carry the revocation
      // record. It is NOT a connection, and reporting it as one would show a working integration
      // for a grant Pikar no longer holds.
      connected: row !== undefined && row.credentialCiphertextB64 !== undefined,
      status: row?.status ?? null,
      connectedAt: row?.connectedAt ?? null,
      lastReadAt: row?.lastReadAt ?? null,
      lastFailureClass: row?.lastFailureClass ?? null,
      revokeSupport: PROVIDER_REVOKE_SUPPORT[provider],
      grantRemainsLiveUpstream:
        row?.revocation !== undefined && row.revocation.upstream !== "confirmed",
      unproven,
    };
  });
}

/**
 * The ONE read the Connections surface makes.
 *
 * `tenantQuery` for authentication and scoping: the rows come from `by_tenant`, and the gate half
 * is deployment-wide and identical for every tenant.
 */
export const connections = tenantQuery({
  args: {},
  handler: async (ctx): Promise<ConnectorView[]> =>
    viewFor(ctx, ctx.tenantId, (await ctx.db.get(ctx.userId))?.owner === true),
});

/**
 * Start a consent, whichever provider it is.
 *
 * IT ADDS NO AUTHORITY. Every branch below goes through the provider's own `tenantAction`, which
 * mints its state through `connectorOAuth.mintConnectState` — where the connect-start gate lives.
 * This dispatcher exists so the browser has one call instead of a four-way switch that a fifth
 * provider would silently fall out of, not to decide who may connect.
 *
 * PayPal is not a gap here: `paypalAuth.beginConnect` returns a refusal with a reason, and that
 * reason is what the surface shows. A provider that cannot be connected still gets a row and a
 * sentence rather than silently not existing.
 */
export const startConnect = tenantAction({
  args: { provider: providerArg, environment: environmentArg, redirectPath: v.string() },
  handler: async (
    ctx,
    { provider, environment, redirectPath },
  ): Promise<{ url: string } | { url: null; because: string }> => {
    if (provider === "paypal") {
      const refusal = await ctx.runAction(api.paypalAuth.beginConnect, { environment });
      return { url: null, because: refusal.because };
    }
    if (provider === "hubspot") {
      return await ctx.runAction(api.hubspotAuth.hubspotConnectUrl, { environment, redirectPath });
    }
    const begin =
      provider === "quickbooks" ? api.quickbooksAuth.beginConnect : api.stripeAuth.beginConnect;
    return await ctx.runAction(begin, { environment, redirectPath });
  },
});

/**
 * End a connection, whichever provider it is — and report what actually happened upstream.
 *
 * The return is the provider's own honest outcome, not a boolean. `upstream` is the closed
 * `RevocationUpstream` enum, so the surface can say "we deleted our copy; your grant stays live
 * until you remove it" for the three lanes where that is the truth, instead of a "Disconnected"
 * that is only half true.
 */
export const disconnectProvider = tenantAction({
  args: { provider: providerArg, environment: environmentArg },
  handler: async (ctx, { provider, environment }): Promise<{ upstream: string }> => {
    if (provider === "hubspot") {
      const r = await ctx.runAction(api.hubspotAuth.disconnectHubSpot, { environment });
      return { upstream: r.upstream };
    }
    const disconnect =
      provider === "quickbooks"
        ? api.quickbooksAuth.disconnect
        : provider === "stripe"
          ? api.stripeAuth.disconnect
          : api.paypalAuth.disconnect;
    const r = await ctx.runAction(disconnect, { environment });
    return { upstream: r.upstream };
  },
});
