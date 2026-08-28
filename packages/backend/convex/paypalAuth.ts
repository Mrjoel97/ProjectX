// PayPal authorization — the MODEL, the guards, and an honest refusal where the vendor publishes
// nothing.
//
// A THIN ADAPTER (CLAUDE.md §1). The one-time state, the redirect hygiene and the revocation
// honesty rule live in `connectorOAuth.ts`; the encryption and the `revision` fence live in
// `connectorCredentials.ts`. What is genuinely PayPal's and lives HERE: the exact read scopes, the
// exact permission package, the merchant binding, and the gap.
//
// ═══ THE MODELLING ERROR THIS MODULE EXISTS TO MAKE UNREACHABLE ═══
//
// PayPal's Transaction Search API documents ONE OAuth flow: `clientCredentials`, `tokenUrl`
// `/v1/oauth2/token`. There is NO per-merchant authorization-code grant. A client-credentials token
// therefore reads THE APP OWNER'S OWN PayPal account — it authenticates Pikar, not a tenant.
//
// Model it as a per-tenant grant and every test still passes, the smoke run still succeeds, and a
// tenant is shown PIKAR'S OWN transactions as if they were theirs. No gate in this phase catches
// that, because every gate checks the read WORKED, never WHOSE money came back.
//
// So a PayPal credential is merchant-bound BY TYPE (`PayPalCredential.merchantId` is required, not
// optional), `parsePayPalCredential` refuses a blob without one, and `classifyGrantSubject` returns
// `app_owner` — never a delegated grant — for a missing, malformed or partner-owned merchant id.
// `paypalConnector` re-checks it after decryption. Three refusals, none of them the same one twice.
//
// ═══ THE GAP, RECORDED RATHER THAN INVENTED ═══
//
// PayPal's published spec (`reporting_transactions_v1.json`, `info.version` 1.9) says, verbatim:
// "To use the API on behalf of third parties, you must be part of the PayPal partner network. Reach
// out to your partner manager for the next steps." And the spec declares a partner-only tag,
// `partner-transactions`, WHOSE OPERATION IS NOT PUBLISHED.
//
// So the third-party read surface cannot be built from public documentation. This module does not
// guess at it. `beginConnect` refuses and names the gap; there is no token mint here, because the
// only token this repository could mint today is an app-owner token and storing one against a
// tenant is the defect above. 28-25 confronts it with the assigned partner manager.
//
// ═══ REVOCATION IS AN OPEN CONDITION AND THIS MODULE KEEPS IT OPEN ═══
//
// NO revocation endpoint is documented anywhere for PayPal. Seller-side removal of granted
// permissions is an ACCOUNT ACTION, not an API. `disconnect` therefore attempts nothing upstream,
// clears the local ciphertext, and records `revocation.upstream = "unsupported"` —
// `classifyRevokeOutcome` makes `confirmed` unreachable for this provider even if a 200 arrived
// from somewhere. A local clear is a real and useful act. It is not revocation.
//
// ═══ THE ADMISSION IS TESTIMONY ═══
//
// `approved_production`, 2026-08-27, on an OWNER ATTESTATION of PayPal partner acceptance. Nothing
// in this repository checked it and no vendor page can. Sandbox is explicitly NON-PROBATIVE: PayPal
// states sandbox calls work BEFORE approval, so no green run corroborates it.
import type { ConnectorEnvironment } from "@pikar/revenue";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { type ActionCtx, internalAction } from "./_generated/server";
import { classifyRevokeOutcome } from "./connectorOAuth";
import { tenantAction } from "./lib/functions";

// ── What PayPal publishes ─────────────────────────────────────────────────────────────────

/**
 * The token endpoint, per environment. Recorded because it is the ONLY documented authentication
 * call PayPal has — no refresh, no revoke, no per-merchant grant. Nothing in this repository calls
 * it: see the header. It is here so a later reader does not have to re-derive that the flow they
 * are looking for does not exist.
 */
export const PAYPAL_TOKEN_ENDPOINTS: Record<ConnectorEnvironment, string> = {
  sandbox: "https://api-m.sandbox.paypal.com/v1/oauth2/token",
  production: "https://api-m.paypal.com/v1/oauth2/token",
};

/**
 * The two reporting scopes, exactly as the published spec's `securitySchemes` names them. Both are
 * reads. `GET /v1/reporting/transactions` needs the first; `GET /v1/reporting/balances` the second.
 */
export const PAYPAL_READ_SCOPES = [
  "https://uri.paypal.com/services/reporting/search/read",
  "https://uri.paypal.com/services/reporting/balances/read",
] as const;

/**
 * The Partner Referrals features this lane may EVER be granted — every one read-shaped, taken from
 * `rest_endpoint_features_enum` in `customer_partner_referrals_v2.json`.
 *
 * `ADVANCED_TRANSACTIONS_SEARCH` is the one that makes a transaction read possible at all, and no
 * public page documents a self-serve route to enabling it: the package must be agreed with the
 * partner manager. That is a carried-forward condition on the suitability record, not a TODO.
 */
export const PAYPAL_REQUESTED_FEATURES = [
  "ADVANCED_TRANSACTIONS_SEARCH",
  "ACCESS_MERCHANT_INFORMATION",
  "PAYPAL_BALANCE",
  "READ_SELLER_DISPUTE",
] as const;

/**
 * Features that must NEVER appear on a grant this lane accepts.
 *
 * The first three are PayPal's own DEFAULT set — "By default, PayPal configures your REST app with
 * the following: PAYMENT, REFUND, DELAY_FUNDS_DISBURSEMENT" — so a connection made without an
 * explicitly narrowed package arrives write-capable. Refusing them at the door is what stops the
 * default from becoming this lane's permission set by omission.
 *
 * `INVOICE_READ_WRITE` is refused even though invoices are inside the phase's approved read
 * surface: PayPal's enum has NO read-only invoice member, and the only feature that would reach an
 * invoice also grants invoice dispatch, which 28-CONTEXT defers. So the invoice half of the read
 * surface is DROPPED rather than bought with a write permission.
 */
export const PAYPAL_REFUSED_FEATURES = [
  "PAYMENT",
  "REFUND",
  "DELAY_FUNDS_DISBURSEMENT",
  "PAYOUTS",
  "DIRECT_PAYMENT",
  "FUTURE_PAYMENT",
  "PARTNER_FEE",
  "UPDATE_SELLER_DISPUTE",
  "UPDATE_CUSTOMER_DISPUTES",
  "DISPUTE_READ_BUYER",
  "INVOICE_READ_WRITE",
  "TRACKING_SHIPMENT_READWRITE",
  "SWEEP_FUNDS_EXTERNAL_SINK",
  "VAULT",
  "BILLING_AGREEMENT",
  "WITHDRAWALS",
  "LINKED_FINANCIAL_INSTRUMENTS",
  "EXCHANGE_CURRENCY",
  "TRANSACTION_RISK_DATA",
  "USER_PROFILE",
] as const;

/**
 * WHY THIS LANE CANNOT CONNECT A TENANT TODAY, in one sentence, owned by code.
 *
 * Exported so the connector, `beginConnect` and the smoke script all say the SAME thing — a gap
 * restated in three voices is a gap that gets quietly narrowed in one of them.
 */
export const PAYPAL_PARTNER_SURFACE_GAP =
  "PayPal's partner-transactions resource is named in the published spec with no published " +
  "operation, so the third-party read surface cannot be built from public documentation; the app's " +
  "own client credentials read Pikar's account, never a tenant's merchant.";

// ── The merchant binding ──────────────────────────────────────────────────────────────────

/**
 * A PayPal merchant id (`merchant_id_in_paypal` / payer id), validated rather than trusted.
 *
 * Upper-case alphanumeric. The exact LENGTH is deliberately not pinned to 13: this repository could
 * not verify that it is fixed, and refusing a real merchant id on an unverified shape is the worse
 * failure — the same call `stripeAuth` makes about the Stripe client id.
 */
const MERCHANT_ID_SHAPE = /^[A-Z0-9]{8,24}$/;

export const isPayPalMerchantId = (value: unknown): value is string =>
  typeof value === "string" && MERCHANT_ID_SHAPE.test(value);

/** Whose money a grant reaches. There is no third member: a grant is one or the other. */
export type PayPalSubject =
  | { kind: "delegated_merchant"; merchantId: string }
  | { kind: "app_owner" };

/**
 * THE FUNCTION THIS MODULE EXISTS FOR.
 *
 * FAILS TO `app_owner`, always. A missing id, a malformed id and the partner's OWN id all collapse
 * to the same answer, because every one of them describes a token that reaches Pikar's account. The
 * only way out is a well-formed id that is demonstrably somebody else's.
 *
 * Note the direction of the default. If an unrecognised shape degraded to `delegated_merchant`, a
 * single typo in a merchant id would turn Pikar's own ledger into a tenant's revenue figures — and
 * the read would succeed, so nothing downstream could tell.
 */
export function classifyGrantSubject(input: {
  partnerMerchantId: string;
  grantedMerchantId: unknown;
}): PayPalSubject {
  const granted = input.grantedMerchantId;
  if (!isPayPalMerchantId(granted)) return { kind: "app_owner" };
  if (granted === input.partnerMerchantId) return { kind: "app_owner" };
  return { kind: "delegated_merchant", merchantId: granted };
}

// ── The permission package ────────────────────────────────────────────────────────────────

export type FeatureVerdict =
  | { ok: true; features: readonly string[] }
  | { ok: false; because: "write_capable" | "insufficient" | "malformed" };

const REFUSED = new Set<string>(PAYPAL_REFUSED_FEATURES);

/**
 * Is this granted feature list one this lane may read with?
 *
 * Accepts an array or PayPal's comma-separated form. An EMPTY list is `malformed`, not "fine but
 * empty": a grant that conveys no features is a grant we cannot characterise, and treating it as
 * harmless is how an unnarrowed default package gets through.
 */
export function checkGrantedFeatures(raw: unknown): FeatureVerdict {
  const list =
    typeof raw === "string"
      ? raw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== "")
      : Array.isArray(raw)
        ? raw.filter((s): s is string => typeof s === "string")
        : null;
  if (list === null || list.length === 0) return { ok: false, because: "malformed" };
  if (list.some((f) => REFUSED.has(f))) return { ok: false, because: "write_capable" };
  if (!list.includes("ADVANCED_TRANSACTIONS_SEARCH")) return { ok: false, because: "insufficient" };
  return { ok: true, features: list };
}

// ── The sealed blob ───────────────────────────────────────────────────────────────────────

/**
 * What one PayPal connection's ciphertext holds.
 *
 * `merchantId` is REQUIRED — not `string | null`, not optional. A credential that does not name
 * whose account it reaches is not representable, which is the type-level half of the guard above.
 *
 * There is no refresh token: PayPal's client-credentials flow issues none, and a token is re-minted
 * rather than rolled. Nothing in this repository mints one today (see the header).
 */
export type PayPalCredential = {
  accessToken: string;
  merchantId: string;
  scope: string;
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export function parsePayPalCredential(plaintext: string): PayPalCredential | null {
  let raw: unknown;
  try {
    raw = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const blob = raw as Record<string, unknown>;
  if (!isNonEmptyString(blob.accessToken)) return null;
  if (!isPayPalMerchantId(blob.merchantId)) return null;
  return {
    accessToken: blob.accessToken,
    merchantId: blob.merchantId,
    scope: typeof blob.scope === "string" ? blob.scope : "",
  };
}

// ── Deployment configuration ──────────────────────────────────────────────────────────────

/**
 * The partner's OWN merchant id — the account a bare client-credentials token reads.
 *
 * It is configuration rather than a constant because it is deployment-specific, and it is REQUIRED
 * rather than optional because `classifyGrantSubject` cannot recognise the app owner without it:
 * unset, a delegated grant and Pikar's own account would be indistinguishable. Fails closed and
 * names only the variable, never a value.
 */
export function requirePartnerMerchantId(): string {
  const merchantId = process.env.PAYPAL_PARTNER_MERCHANT_ID;
  if (!merchantId) throw new Error("PayPal is not configured: PAYPAL_PARTNER_MERCHANT_ID");
  if (!isPayPalMerchantId(merchantId)) {
    throw new Error("PAYPAL_PARTNER_MERCHANT_ID must be a PayPal merchant id.");
  }
  return merchantId;
}

const environmentArg = v.union(v.literal("sandbox"), v.literal("production"));

// ── Connect: refused, with the reason ─────────────────────────────────────────────────────

/**
 * There is no PayPal consent to start.
 *
 * This returns a refusal rather than not existing, so the connections surface has a sentence to
 * show instead of a provider that silently is not there — and so the refusal is a TESTED branch
 * rather than an absence somebody could fill in with an app token later.
 *
 * It mints NO state, performs NO external call and writes NOTHING. A state row implies a callback
 * that is coming; none is.
 */
export const beginConnect = tenantAction({
  args: { environment: environmentArg },
  handler: async (): Promise<{ available: false; because: string }> => ({
    available: false,
    because: PAYPAL_PARTNER_SURFACE_GAP,
  }),
});

// ── Disconnect: local only, and it says so ────────────────────────────────────────────────

export type DisconnectOutcome = { cleared: boolean; upstream: string; statusCode: number | null };

/**
 * Clear the local ciphertext and record what actually happened upstream: NOTHING.
 *
 * NO revocation endpoint is documented anywhere for PayPal — `POST /v1/oauth2/token` is the only
 * documented authentication call, and seller-side removal of granted permissions is an account
 * action. So `attempted` is `false`: there is no request to make, and pointing one at some other
 * endpoint would let a 200 from elsewhere be recorded as a confirmed revocation of a grant that is
 * still live.
 *
 * What the tenant must be told, and what `connectorCredentials.connectorStatuses` carries to the
 * UI: Pikar has stopped using and deleted its copy; anything PayPal granted stays granted until the
 * seller removes it from their own PayPal account. 28-25 owes the answer on whether the partner
 * manager can offer better. Nothing here closes that condition.
 */
async function clearLocally(
  ctx: ActionCtx,
  { tenantId, environment }: { tenantId: string; environment: ConnectorEnvironment },
): Promise<DisconnectOutcome> {
  const outcome = classifyRevokeOutcome({ provider: "paypal", attempted: false });
  const cleared = await ctx.runMutation(internal.connectorCredentials.recordRevocation, {
    tenantId,
    provider: "paypal",
    environment,
    upstream: outcome.upstream,
  });
  return { cleared: cleared.cleared, upstream: outcome.upstream, statusCode: null };
}

export const disconnect = tenantAction({
  args: { environment: environmentArg },
  handler: (ctx, { environment }): Promise<DisconnectOutcome> =>
    clearLocally(ctx, { tenantId: ctx.tenantId, environment }),
});

/**
 * The lane runner's disconnect (`scripts/smoke-paypal-read.mjs --revoke`, consumed by 28-25).
 * Internal, so no browser reaches it. ONE body shared with the tenant action, so the two cannot
 * drift into telling the user different things about the same act.
 */
export const disconnectForTenant = internalAction({
  args: { tenantId: v.string(), environment: environmentArg, confirm: v.literal("revoke") },
  handler: (ctx, { tenantId, environment }): Promise<DisconnectOutcome> =>
    clearLocally(ctx, { tenantId, environment }),
});
