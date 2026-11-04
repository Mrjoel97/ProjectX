"use client";

import { api } from "@pikar/backend/api";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState } from "react";
import styles from "./merchant.module.css";
import { formatMerchantMoney } from "./merchantPresentation";

type Pilot = NonNullable<
  NonNullable<FunctionReturnType<typeof api.merchantCommerce.status>>["privateFlutterwavePilot"]
>;
type ProjectId = FunctionArgs<typeof api.merchantCommerce.status>["projectId"];
type Quote = FunctionReturnType<typeof api.merchantPilot.prepareOrder>;

export function FlutterwaveTestOrder({ projectId, pilot }: { projectId: ProjectId; pilot: Pilot }) {
  const prepare = useMutation(api.merchantPilot.prepareOrder);
  const checkout = useAction(api.merchantProvider.checkout);
  const [itemId, setItemId] = useState("");
  const [orderId, setOrderId] = useState<Quote["orderId"] | null>(null);
  const savedOrderKey = `pikar:flw-order:${projectId}`;
  useEffect(() => {
    const saved = sessionStorage.getItem(savedOrderKey);
    if (saved && /^[a-z0-9]{20,64}$/.test(saved)) setOrderId(saved as Quote["orderId"]);
  }, [savedOrderKey]);
  const order = useQuery(api.tenantOrders.getOrder, orderId ? { orderId } : "skip");
  const quote =
    order?.projectId === projectId &&
    order.snapshot.currency === "TZS" &&
    order.snapshot.country === "TZ" &&
    order.status === "pending"
      ? {
          orderId: order._id,
          totalMinor: order.snapshot.totalMinor,
          currency: order.snapshot.currency,
        }
      : null;
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState("");
  const submitting = useRef(false);
  const item = pilot.items.find((row) => row.presentationItemId === itemId);
  const submit = async () => {
    if (submitting.current || (!quote && !item)) return;
    submitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (quote) {
        const result = await checkout({
          orderId: quote.orderId,
          provider: "flutterwave",
          buyerEmail: email.trim(),
        });
        if (!result.ok || !("url" in result) || !result.url) throw Error("CHECK_ORDER");
        const url = new URL(result.url);
        if (
          url.origin !== "https://checkout.flutterwave.com" ||
          url.username ||
          url.password ||
          !url.pathname.startsWith("/v3/hosted/pay/")
        )
          throw Error("CHECK_ORDER");
        setCheckoutUrl(url.href);
      } else if (item) {
        const storageKey = `pikar:flw-test:${projectId}:${item.productId}:${item.productRevision}:${item.presentationItemId}`;
        const requestId = sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
        sessionStorage.setItem(storageKey, requestId);
        const prepared = await prepare({
          projectId,
          presentationItemId: item.presentationItemId,
          productId: item.productId,
          productRevision: item.productRevision,
          unitMinor: item.unitMinor,
          requestId,
        });
        if (prepared.status === "expired" || prepared.status === "cancelled") {
          sessionStorage.removeItem(storageKey);
          setMessage(
            "Your previous test order has closed. Review the item again to start another.",
          );
        } else {
          sessionStorage.setItem(savedOrderKey, prepared.orderId);
          setOrderId(prepared.orderId);
        }
      }
    } catch {
      setMessage(
        quote
          ? "Check the order status below before retrying payment."
          : "The shop could not reserve this item. Check its price and stock.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <section className={styles.preparation} aria-label="Private Flutterwave test">
      <h3>Test checkout in Tanzanian shillings</h3>
      {pilot.verifiedTestPayment ? (
        <p>Flutterwave confirmed a test payment for this shop.</p>
      ) : !pilot.canStartTest && !quote ? (
        <p>
          Connect the test wallet and approve your catalogue, prices and selling policy to prepare
          an order.
        </p>
      ) : (
        <form
          className={styles.testOrder}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {!quote && (
            <label>
              Test item
              <select
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                disabled={!!quote || busy}
                required
              >
                <option value="">Choose one item</option>
                {pilot.items.map((row) => (
                  <option key={row.presentationItemId} value={row.presentationItemId}>
                    {row.sku} · {formatMerchantMoney(row.unitMinor, "TZS")}
                  </option>
                ))}
              </select>
            </label>
          )}
          {quote && (
            <>
              <p>
                {order?.snapshot.lines[0]?.sku} · Total including applicable shipping and tax:{" "}
                <strong>{formatMerchantMoney(quote.totalMinor, quote.currency)}</strong>
              </p>
              <label>
                Test buyer email
                <input
                  type="email"
                  required
                  maxLength={254}
                  value={email}
                  disabled={busy || !!checkoutUrl}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <p>Flutterwave receives this email when you request checkout.</p>
            </>
          )}
          {checkoutUrl ? (
            <a
              className={styles.connection}
              href={checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Flutterwave test checkout ↗
            </a>
          ) : (
            <button className={styles.secondary} type="submit" disabled={busy || (!quote && !item)}>
              {busy ? "Preparing…" : quote ? "Request test checkout" : "Review test order"}
            </button>
          )}
          {message && <p role="status">{message}</p>}
        </form>
      )}
    </section>
  );
}
