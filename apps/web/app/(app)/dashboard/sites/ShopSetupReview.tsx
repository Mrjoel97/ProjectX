"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import Link from "next/link";
import { useState } from "react";
import { formatMerchantMoney } from "./merchantPresentation";
import styles from "./merchant.module.css";

type ProjectId = FunctionArgs<typeof api.webProjects.getProject>["projectId"];
const region = (code: string) => new Intl.DisplayNames("en", { type: "region" }).of(code) ?? code;

/** The proposal is agent-prepared; authority comes only from a native exact-package approval. */
export function ShopSetupReview({ projectId }: { projectId: string }) {
  const proposal = useQuery(api.onlinePresenceShop.setupForProject, {
    projectId: projectId as ProjectId,
  });
  const approve = useMutation(api.onlinePresenceShop.approveSetup);
  const [consentPin, setConsentPin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (proposal === undefined)
    return (
      <section className={styles.setup} aria-label="Shop setup review">
        <h3>Your proposed shop setup</h3>
        <p role="status">Checking the exact setup prepared by Pikar…</p>
      </section>
    );
  if (!proposal)
    return (
      <section className={styles.setup} aria-label="Shop setup review">
        <h3>Your proposed shop setup</h3>
        <p>
          Pikar can prepare your actual products, prices, availability and operating policy for one
          review.
        </p>
      </section>
    );
  const setup = proposal.setup;
  const inventoryReview = (
    "inventoryReview" in proposal && Array.isArray(proposal.inventoryReview)
      ? proposal.inventoryReview
      : []
  ) as {
    catalogueItemId: string;
    action: "preserve" | "set";
    currentOnHand: number | null;
    requestedOnHand: number | null;
  }[];
  const pin = `${projectId}:${proposal.version}:${proposal.contentHash}:${proposal.packageHash}:${proposal.expectedRevision}`;
  const approved = proposal.approval?.current === true;
  const approvePackage = async () => {
    if (busy || !proposal.ready || !proposal.packageHash || consentPin !== pin || approved) return;
    setBusy(true);
    setNotice(null);
    try {
      await approve({
        planId: proposal.planId,
        expectedRevision: proposal.expectedRevision,
        packageHash: proposal.packageHash,
      });
      setNotice("Review saved. The current setup status is confirmed from its recorded result.");
      setConsentPin(null);
    } catch {
      setNotice(
        "This setup could not be confirmed. Review the current proposal before trying again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.setup} aria-labelledby="shop-setup-review">
      <header className={styles.setupHeader}>
        <h3 id="shop-setup-review">Your proposed shop setup</h3>
        {proposal.version && (
          <Link
            href={`/dashboard/sites?project=${encodeURIComponent(projectId)}&version=${proposal.version}`}
          >
            Review website version {proposal.version}
          </Link>
        )}
      </header>
      {approved ? (
        <p className={styles.ready}>
          This exact setup has a recorded approval for version {proposal.approval?.version}.
        </p>
      ) : proposal.approval ? (
        <p className={styles.review}>
          The saved configuration has changed since approval. Review the current configuration with
          Pikar.
        </p>
      ) : (
        <p>
          Pikar prepares the details. You review the actual prices, stock and operating rules
          together.
        </p>
      )}
      {setup && (
        <>
          <dl className={styles.setupFacts}>
            <div>
              <dt>Seller location</dt>
              <dd>{region(setup.sellerCountry)}</dd>
            </div>
            <div>
              <dt>Currency</dt>
              <dd>{setup.currency}</dd>
            </div>
            <div>
              <dt>Buyer countries</dt>
              <dd>{setup.countries.map(region).join(", ")}</dd>
            </div>
          </dl>
          <ul className={styles.setupProducts}>
            {setup.products.map((product) => {
              const stockReview = inventoryReview.find(
                (item) => item.catalogueItemId === product.catalogueItemId,
              );
              return (
                <li key={product.catalogueItemId}>
                  <div>
                    <strong>
                      {proposal.catalogueItems.find((item) => item.id === product.catalogueItemId)
                        ?.name ?? product.catalogueItemId}
                    </strong>
                    <p>
                      {product.goodsKind === "physical" ? "Physical product" : "Digital product"} ·{" "}
                      {product.sku} / {product.variant}
                    </p>
                    {stockReview ? (
                      <>
                        <p>
                          {stockReview.currentOnHand === null
                            ? "No finite stock currently recorded"
                            : `${stockReview.currentOnHand} currently available`}
                        </p>
                        <p>
                          {stockReview.action === "preserve"
                            ? "Preserve current stock; this review does not restock sold items."
                            : stockReview.requestedOnHand === null
                              ? "Set availability to explicitly untracked."
                              : `Set available stock to ${stockReview.requestedOnHand}.`}
                        </p>
                      </>
                    ) : (
                      <p>
                        {product.stock.kind === "finite"
                          ? `Proposed available stock: ${product.stock.onHand}`
                          : "Proposed availability: explicitly untracked"}
                      </p>
                    )}
                    {product.stock.kind === "finite" && (
                      <p>
                        Reservations expire after {product.stock.reservationTtlMs / 60_000} minutes.
                      </p>
                    )}
                    {product.digitalDeliverySourceRef && (
                      <p>Delivery uses the selected private file.</p>
                    )}
                  </div>
                  <strong className={styles.amount}>
                    {formatMerchantMoney(product.priceMinor, setup.currency)}
                  </strong>
                </li>
              );
            })}
          </ul>
          <div className={styles.setupPolicies}>
            {setup.policy.physical && (
              <section>
                <h4>Physical orders</h4>
                <p>
                  Configured delivery charge:{" "}
                  {formatMerchantMoney(setup.policy.physical.shippingMinor, setup.currency)}
                </p>
                <p>Configured tax rate: {setup.policy.physical.taxBasisPoints / 100}%</p>
                <p>Shipping, returns and refunds follow the selected business policy.</p>
              </section>
            )}
            {setup.policy.digital && (
              <section>
                <h4>Digital orders</h4>
                <p>
                  No shipping charge. Configured tax rate:{" "}
                  {setup.policy.digital.taxBasisPoints / 100}%.
                </p>
                <p>Digital access and revocation follow the selected business policy.</p>
              </section>
            )}
            <section>
              <h4>Operating rules</h4>
              <p>
                {setup.automation.autoDigitalDelivery
                  ? "Digital access is issued automatically after a confirmed payment, under the saved policy."
                  : "Digital delivery waits for the configured review."}
              </p>
              <p>
                Digital access: {setup.automation.digitalValidityDays} days. Buyer information
                retention: {setup.automation.buyerRetentionDays} days.
              </p>
            </section>
          </div>
          <details className={styles.evidence}>
            <summary>Business information behind this proposal</summary>
            {[...setup.evidence, ...setup.products.flatMap((product) => product.evidence)].map(
              (entry, index) => (
                <blockquote key={`${entry.sourceRef}:${index}`}>
                  <p>{entry.quote}</p>
                  <cite>Selected business source</cite>
                </blockquote>
              ),
            )}
            <p>
              Policy references:{" "}
              {[setup.policy.sellerOfRecordRef, setup.automation.policyRef].join(" · ")}
            </p>
          </details>
        </>
      )}
      {proposal.missing.length > 0 && (
        <div className={styles.preparation}>
          <h4>Information Pikar still needs</h4>
          <ul>
            {[
              ...new Set(
                proposal.missing.map((item) =>
                  item.question.includes("shopSetup.")
                    ? "Complete the missing product, price or operating-policy information with Pikar."
                    : item.question,
                ),
              ),
            ].map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      )}
      {proposal.ready && setup && !approved && (
        <div className={styles.approval}>
          <label className={styles.consent}>
            <input
              type="checkbox"
              checked={consentPin === pin}
              onChange={(event) => setConsentPin(event.target.checked ? pin : null)}
            />
            I approve these products, prices, availability and operating rules for this exact
            version of my shop.
          </label>
          <p>Payment-provider connection and website publication are reviewed separately.</p>
          <button
            type="button"
            className={styles.primary}
            disabled={busy || consentPin !== pin}
            onClick={() => void approvePackage()}
          >
            {busy ? "Recording your approval…" : "Approve this shop setup"}
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
    </section>
  );
}
