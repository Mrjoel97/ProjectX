"use client";

import { api } from "@pikar/backend/api";
import { useAction, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShopSetupReview } from "./ShopSetupReview";
import { formatMerchantMoney } from "./merchantPresentation";
import styles from "./merchant.module.css";

export { formatMerchantMoney } from "./merchantPresentation";

type ProjectId = FunctionArgs<typeof api.webProjects.getProject>["projectId"];
type Provider = "stripe" | "paypal";
const providerName = (provider: Provider) => (provider === "stripe" ? "Stripe" : "PayPal");

/** Only server-returned, provider-owned test onboarding URLs can leave this screen. */
export function safeMerchantConnectionUrl(value: string, provider: Provider): string | null {
  try {
    const url = new URL(value);
    const hosts =
      provider === "stripe"
        ? ["accounts.stripe.com", "connect.stripe.com", "checkout.stripe.com"]
        : ["www.sandbox.paypal.com", "sandbox.paypal.com"];
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      hosts.includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

const explanations: Record<string, string> = {
  configuration_required: "Payment setup needs attention.",
  provider_unavailable: "This payment connection is not available yet.",
  merchant_account_required: "Connect a test merchant account.",
  account_not_ready: "The payment provider is still verifying the test account.",
  policy_required: "Your selling and fulfilment policy needs review.",
  catalogue_required: "Your products need to be prepared and confirmed.",
  stock_required: "Product availability needs to be confirmed.",
  proof_required: "A verified test payment is still needed.",
  live_mode_disabled: "Real charges are unavailable. This shop uses test mode.",
  consent_required:
    "Confirm permission before sharing account information with the payment provider.",
  unsupported_country: "This payment connection does not support the confirmed seller country.",
  unsupported_currency: "This payment connection does not support the confirmed currency.",
};
const explain = (reason?: string) => {
  const code = reason?.includes(":") ? reason.split(":").at(-1) : reason;
  const labels: Record<string, string> = {
    ...explanations,
    provider_configuration_required: "The test payment connection is not available yet.",
    merchant_onboarding_required: "Connect a test merchant account.",
    merchant_policy_required: "Your selling and fulfilment policy needs review.",
    confirmed_product_price_and_mapping_required: "Your products and prices need confirmation.",
    active_classified_product_required: "Your products need to be classified and confirmed.",
    verified_test_payment_required: "A verified test payment is still needed.",
  };
  return (
    (code ? labels[code] : undefined) ??
    "Shop setup needs a review. Pikar can help prepare the next step."
  );
};
const stateLabels: Record<string, string> = {
  not_connected: "Not connected",
  connecting: "Connection in progress",
  ready: "Verified for testing",
  unavailable: "Unavailable",
  revoked: "Connection revoked",
  pending: "Pending",
  paid: "Paid",
  merchant_review: "Needs your review",
  paid_needs_review: "Paid · needs review",
  awaiting_payment: "Awaiting payment",
  refunded: "Refunded",
  partially_refunded: "Partially refunded",
  cancelled: "Cancelled",
  expired: "Expired",
  failed: "Failed",
  succeeded: "Completed",
  delivered: "Delivered",
  shipped: "Shipped",
  prepared: "Prepared",
  unknown: "Awaiting confirmation",
};
const stateLabel = (state: string) => stateLabels[state] ?? "Awaiting confirmation";

/** A shop's operations readback, not a second catalogue editor. Financial readiness always
 * comes from the backend; a browser return or local checkbox cannot promote it. */
export function MerchantWorkspace({ projectId }: { projectId: string }) {
  const id = projectId as ProjectId;
  const status = useQuery(api.merchantCommerce.status, { projectId: id });
  const orderReadback = useQuery(api.merchantCommerce.orders, { projectId: id });
  const orders = orderReadback?.orders;
  const connect = useAction(api.merchantProvider.connect);
  const refresh = useAction(api.merchantProvider.refresh);
  const start = useAction(api.cockpit.startOnlinePresence);
  const router = useRouter();
  const [consents, setConsents] = useState<Partial<Record<Provider, boolean>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connection, setConnection] = useState<{ provider: Provider; url: string } | null>(null);
  const run = async (key: string, operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setNotice(null);
    try {
      await operation();
    } catch {
      setNotice("The result could not be confirmed. Check the current status before trying again.");
    } finally {
      setBusy(null);
    }
  };
  const ask = () =>
    run("agent", async () => {
      const result = await start({
        text: `Help me finish setup and review the operating policy for my existing shop project ${projectId}. Use my confirmed products and business information. Explain what needs my permission or a payment-provider connection. Do not claim a payment, refund, shipment or delivery occurred without its actual receipt.`,
      });
      router.push(
        `/dashboard/workspace?thread=${encodeURIComponent(result.threadId)}&label=Your%20shop`,
      );
    });
  if (status === undefined)
    return (
      <section className={styles.panel} aria-label="Shop operations">
        <h2>Your shop operations</h2>
        <p role="status">Checking payment connections and orders…</p>
      </section>
    );
  if (status === null)
    return (
      <section className={styles.panel} aria-label="Shop operations">
        <h2>Your shop operations</h2>
        <p>Shop status is unavailable for this project.</p>
      </section>
    );
  const needsReview = orders?.filter((order) => order.reviewRequired).length ?? 0;
  return (
    <section className={styles.panel} aria-labelledby="shop-operations">
      <header className={styles.header}>
        <div>
          <p className={styles.mode}>Test shop · real charges are unavailable</p>
          <h2 id="shop-operations">Your shop operations</h2>
          <p>
            {status.publicCheckoutReady
              ? "Test checkout is ready. Payment and fulfilment states below come from recorded results."
              : "Your private shop is being prepared. Checkout stays held until the required checks are complete."}
          </p>
        </div>
        <button
          type="button"
          className={styles.primary}
          disabled={busy !== null}
          onClick={() => void ask()}
        >
          {busy === "agent" ? "Opening your workflow…" : "Ask Pikar to finish setup"}
        </button>
      </header>
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      {!status.publicCheckoutReady && (
        <div className={styles.preparation}>
          <h3>Before checkout opens</h3>
          <p>
            Pikar prepares your products and policies. You confirm missing business facts and
            complete the payment provider's account connection.
          </p>
          {status.blockers.length > 0 && (
            <ul>
              {[...new Set(status.blockers.map((reason) => explain(reason)))].map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ShopSetupReview projectId={projectId} />
      <div className={styles.providers}>
        {status.providers.map((account) => (
          <article key={account.provider} className={styles.provider}>
            <header>
              <h3>{providerName(account.provider)}</h3>
              <span className={account.status === "ready" ? styles.ready : styles.state}>
                {stateLabel(account.status)}
              </span>
            </header>
            <p>
              {account.status === "ready"
                ? "The server has verified this test account. Returning from the provider alone does not verify payments."
                : account.canConnect
                  ? "Complete the provider's secure onboarding. Pikar does not collect your payment password."
                  : "This test connection is not available yet. Pikar can explain the remaining setup."}
            </p>
            {account.canConnect && account.status !== "ready" && (
              <>
                <label className={styles.consent}>
                  <input
                    type="checkbox"
                    checked={consents[account.provider] === true}
                    onChange={(event) =>
                      setConsents((previous) => ({
                        ...previous,
                        [account.provider]: event.target.checked,
                      }))
                    }
                  />
                  I allow my merchant account information to be shared with{" "}
                  {providerName(account.provider)} for this test connection.
                </label>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy !== null || consents[account.provider] !== true}
                  onClick={() =>
                    void run(`connect-${account.provider}`, async () => {
                      setConnection(null);
                      const result = await connect({
                        projectId: id,
                        provider: account.provider,
                        shareDataConsent: true,
                        ...account.connectionContext,
                      });
                      if (!result.ok) {
                        setNotice(explain(result.reason));
                        return;
                      }
                      const url = result.url
                        ? safeMerchantConnectionUrl(result.url, account.provider)
                        : null;
                      if (!url) {
                        setNotice(
                          "A secure connection link could not be confirmed. Refresh the status before trying again.",
                        );
                        return;
                      }
                      setConnection({ provider: account.provider, url });
                    })
                  }
                >
                  {busy === `connect-${account.provider}`
                    ? "Preparing secure connection…"
                    : `Connect ${providerName(account.provider)} test account`}
                </button>
              </>
            )}
            {connection?.provider === account.provider && (
              <a
                className={styles.connection}
                href={connection.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Continue securely to {providerName(account.provider)} ↗
              </a>
            )}
            <button
              type="button"
              className={styles.refresh}
              disabled={busy !== null || !account.configured}
              onClick={() =>
                void run(`refresh-${account.provider}`, async () => {
                  const result = await refresh({ projectId: id, provider: account.provider });
                  setNotice(
                    result.ok
                      ? "Status checked. Verified account readiness is shown above."
                      : explain(result.reason),
                  );
                })
              }
            >
              {busy === `refresh-${account.provider}` ? "Checking…" : "Refresh account status"}
            </button>
          </article>
        ))}
      </div>
      <section className={styles.automation} aria-labelledby="shop-automation">
        <h3 id="shop-automation">Operating policy</h3>
        {status.automation ? (
          <>
            <p>
              {status.automation.autoDigitalDelivery
                ? "Automatic digital delivery is enabled under your saved policy."
                : "Digital delivery waits for the configured review."}
            </p>
            <dl>
              <div>
                <dt>Digital access</dt>
                <dd>{status.automation.digitalValidityDays} days</dd>
              </div>
              <div>
                <dt>Buyer information retention</dt>
                <dd>{status.automation.buyerRetentionDays} days</dd>
              </div>
            </dl>
          </>
        ) : (
          <p>
            Your delivery and customer-information policy needs preparation and review. Pikar can
            guide the next step.
          </p>
        )}
      </section>
      <section className={styles.orders} aria-labelledby="shop-orders">
        <header>
          <h3 id="shop-orders">Orders</h3>
          {orders && (
            <span>
              {orders.length} shown{needsReview > 0 ? ` · ${needsReview} need review` : ""}
            </span>
          )}
        </header>
        {orderReadback?.truncated && (
          <p>Showing the latest 100 orders. Ask Pikar to review a specific older order.</p>
        )}
        {orders === undefined ? (
          <p role="status">Loading orders…</p>
        ) : orders.length === 0 ? (
          <p>
            No orders yet. Orders appear here after checkout is used; payment is confirmed from the
            provider's recorded result.
          </p>
        ) : (
          <ul>
            {orders.map((order) => (
              <li key={order.orderId} className={styles.order}>
                <div>
                  <strong>Order {order.orderId.slice(-8)}</strong>
                  <p>
                    {stateLabel(order.status)} · Payment: {stateLabel(order.paymentStatus)}
                    {order.provider ? ` · ${providerName(order.provider)}` : ""}
                  </p>
                  {order.reviewRequired && (
                    <p className={styles.review}>
                      Needs your review. Ask Pikar to review this order before taking another
                      action.
                    </p>
                  )}
                  {order.fulfilments.length > 0 && (
                    <p>
                      {order.fulfilments
                        .map(
                          (entry) =>
                            `${entry.kind === "digital_entitlement" ? "Digital delivery" : "Fulfilment"}: ${stateLabel(entry.status)}`,
                        )
                        .join(" · ")}
                    </p>
                  )}
                </div>
                <div className={styles.amount}>
                  <strong>{formatMerchantMoney(order.totalMinor, order.currency)}</strong>
                  {order.refundedMinor > 0 && (
                    <p>{formatMerchantMoney(order.refundedMinor, order.currency)} refunded</p>
                  )}
                  <time dateTime={new Date(order.createdAt).toISOString()}>
                    {new Date(order.createdAt).toLocaleDateString("en", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
