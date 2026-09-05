"use client";

// 28.1-09 — THE tenant-facing billing surface, and the only one.
//
// Three things this phase built had no caller in `apps/web` before this file existed: the
// `unappliedFunds` 75/90-day clock (28.1-06), `renderTaxPosture` (28.1-03), and the hosted invoice
// links (28.1-07). `?checkout=` — the `success_url` / `cancel_url` 28.1-04 sends Stripe — landed on
// a page about data export and was ignored. A capability nobody can reach is not shipped.
//
// THE HONESTY RULES THIS FILE ENFORCES, in the order they are easiest to break:
//
//  1. UNKNOWN IS NOT ZERO. `billingStatus` answers `unknown` for three different reasons (no
//     mapping, a checkout whose subscription event has not arrived, a status Stripe added later).
//     None of them is "$0" and none of them is a no-cost tier. `subscriptionCopy` says so in words.
//  2. A REDIRECT IS NOT EVIDENCE. `?checkout=success` means Stripe sent the browser back. It does
//     NOT mean the webhook landed. `checkoutNotice` acknowledges the return and is forbidden from
//     claiming a subscription — only `billingStatus` may say that, and the test asserts the two
//     sentences are disjoint literals.
//  3. AN UNRECOGNISED TOKEN RENDERS NOTHING. Not a blank banner, not a half-built one.
//  4. NO PORTAL WITHOUT A PROVEN BILLING RECORD. `portalLink` refuses when there is no Stripe
//     customer and must NEVER be nudged into provisioning one, so the control is disabled unless
//     `billingStatus` is one of the two states that can only come from a stored status string.
//     The guard is in `manage()` as well as on the button: `disabled` is presentation, not a gate.
//  5. THE AGE IS THE ACTIONABLE HALF of an unapplied balance. Stripe returns unreconciled money to
//     the sending bank at 75 days and sweeps it at 90; a screen showing the amount without the age
//     reports a standing balance that is quietly about to leave.
//
// BRAND.md is binding (CLAUDE.md §10). Amber belongs to the approval gate and to nothing else
// (BRAND §2 — "spend it in exactly one place"), which is why unapplied funds — which *feel* like a
// warning — are emphasised with `--ink-soft` and weight instead. `billingPanel.test.ts` scans this
// file's source to keep it that way. Teal is a button fill with white text, never small body text
// (BRAND §6, ~2.9:1). Section titles are the tracked-caps pattern (BRAND §3).
import { api } from "@pikar/backend/api";
import { CONFIG_CONFIRMED } from "@pikar/billing/config";
import { unappliedStage } from "@pikar/billing/reconcile";
import { renderTaxPosture, type TaxPosture } from "@pikar/billing/tax";
import type { CashFigure } from "@pikar/core";
import { formatMoneyAmount, moneyFromMinor } from "@pikar/revenue/money";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { type CSSProperties, useEffect, useState } from "react";
import { FigureTile } from "../finance/CashView";

// Shapes taken FROM the backend's own return validators rather than restated here — a second copy
// of a money surface's shape is a drift waiting to happen.
type BillingState = FunctionReturnType<typeof api.billing.billingStatus>["state"];
type UnappliedAnswer = FunctionReturnType<typeof api.billing.unappliedFunds>;
type InvoiceAnswer = FunctionReturnType<typeof api.billing.invoices>;

// ── styles ────────────────────────────────────────────────────────────────────────────────
// ponytail: three style objects copied from `DataControls.tsx` next door rather than extracted
// into a shared module. Two sibling surfaces sharing a card look is how this app is already
// built (`CashView.tsx` carries its own copy too); the upgrade path is a real component library,
// which BRAND §8.3 says not to add without asking.

const card: CSSProperties = {
  display: "grid",
  gap: "1rem",
  padding: "clamp(1rem, 2vw, 1.5rem)",
  border: "1px solid var(--rule)",
  borderRadius: "1rem",
  background: "var(--card)",
  boxShadow: "0 10px 30px color-mix(in srgb, var(--ink) 8%, transparent)",
};

const sectionLabel: CSSProperties = {
  color: "var(--ink-soft)",
  fontSize: "0.75rem",
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

const body: CSSProperties = { margin: 0, color: "var(--ink-soft)", lineHeight: 1.6 };

const primaryButton: CSSProperties = {
  appearance: "none",
  border: "none",
  borderRadius: "0.75rem",
  padding: "0.72rem 1rem",
  minHeight: "2.75rem",
  background: "var(--teal-600)",
  color: "white",
  font: "inherit",
  fontWeight: 700,
};

// ── the derivations, pure and exported so they can be asserted without a DOM ───────────────

/**
 * The message for a return from Stripe Checkout, or `null` for anything we do not recognise.
 *
 * EXACT tokens only. `"SUCCESS"`, `"success "` and `"successful"` are all unrecognised, because a
 * near-miss is a query string somebody else built and this surface has no business guessing what
 * they meant. An unrecognised token renders nothing at all — never an empty banner.
 *
 * The success arm is deliberately free of any claim about the subscription. Stripe redirecting the
 * browser back proves the browser came back; the `customer.subscription.*` webhook is what proves
 * a subscription, and it may not have arrived yet.
 */
export function checkoutNotice(token: string | null | undefined): string | null {
  if (token === "success") {
    return "You finished checkout at Stripe. Stripe confirms it to us separately, so the subscription state below — not this message — is the one that counts. It can take a moment to catch up.";
  }
  if (token === "cancel") {
    return "You left checkout without paying. Nothing was charged and nothing about your account changed.";
  }
  return null;
}

/**
 * The three states, as three sentences. Collapsing any two of them is the failure this exists to
 * prevent, and `unknown` is the one that invites a lie: it is not zero, not a no-cost tier, and
 * not "not subscribed" — it is the absence of an answer, and it says what would resolve it.
 */
export function subscriptionCopy(state: BillingState): { headline: string; detail: string } {
  if (state === "subscribed") {
    return {
      headline: "You are subscribed.",
      detail:
        "Change the plan, update the payment method or cancel in Stripe's billing portal. Pikar keeps no payment details of its own.",
    };
  }
  if (state === "not_subscribed") {
    return {
      headline: "You are not subscribed.",
      detail:
        "Stripe holds a billing record for you and it shows no live subscription — it may have ended, or it may never have started.",
    };
  }
  return {
    headline: "Your subscription state is not something we can tell you yet.",
    detail:
      "No billing signal has reached us for your account, so we do not know. If you have just finished checkout, this resolves when Stripe confirms it to us. We are not saying you owe nothing — we are saying we cannot see.",
  };
}

/**
 * Whether the Customer Portal control may be offered, and why not when it may not.
 *
 * `billingStatus` answers `not_subscribed` or `subscribed` ONLY when a `billingCustomers` row
 * carries a recognised status string, which means a Stripe customer exists. `unknown` covers the
 * case where no row exists at all — and `portalLink` refuses that with `no_stripe_customer`,
 * because provisioning a customer to make a portal call succeed mints a merchant-side object this
 * database maps back to nothing. So `unknown` gets no control, not a control that fails.
 */
export function manageSubscription(
  state: BillingState,
): { enabled: true; reason: null } | { enabled: false; reason: string } {
  return state === "unknown"
    ? {
        enabled: false,
        reason:
          "There is no billing record for you yet, so there is no portal to open. Start a subscription first.",
      }
    : { enabled: true, reason: null };
}

const days = (n: number): string => `${n} ${n === 1 ? "day" : "days"}`;

/**
 * What is happening to one unapplied balance, in words, keyed on its AGE.
 *
 * The stage comes from `unappliedStage` in `@pikar/billing/reconcile` — the ONE definition of the
 * 75/90 boundaries, whose own JSDoc names this call site ("later by the tenant-facing surface that
 * renders a stored observation whose age has since grown"). The server sends a `stage` field
 * computed from the same function and the same `ageDays`; deriving it here from `ageDays` keeps
 * one boundary definition rather than two readers that can disagree by the off-by-one that matters.
 */
export function unappliedFundCopy(ageDays: number): string {
  const stage = unappliedStage(ageDays);
  if (stage === "swept") {
    return `Held for ${days(ageDays)} — Stripe has swept this out of your cash balance.`;
  }
  if (stage === "return-attempted") {
    return `Held for ${days(ageDays)} — Stripe is returning this to the sending bank account.`;
  }
  return `Waiting to be matched to an invoice — held for ${days(ageDays)}.`;
}

/**
 * An exact minor-unit amount with its currency. Cents are NEVER dropped: `CashView`'s
 * `formatUsdAmount` rounds to whole dollars, which is right for a business metric and wrong for
 * money we are holding. An unrecognised currency is said out loud rather than guessed at.
 */
export function heldAmountCopy(amountMinor: number, currency: string): string {
  const money = moneyFromMinor(amountMinor, currency);
  return money.ok
    ? `${formatMoneyAmount(money.value)} ${money.value.currency}`
    : `${amountMinor} minor units — unrecognised currency, not converted.`;
}

/**
 * How many balances we are holding — as a `CashFigure`, so `FigureTile` renders the four-branch
 * discipline this needs rather than a second figure renderer.
 *
 * NO COVERAGE IS UNKNOWN, NOT ZERO. An empty list under `coverage: "unknown"` means we have never
 * watched this tenant's billing; an empty list under `known` means there is genuinely nothing held.
 * Rendering both as a zero is the exact mistake `@pikar/core`'s `cash.ts` exists to prevent, so the
 * unknown arm carries no digit at all.
 */
export function heldBalancesFigure(
  coverage: UnappliedAnswer["coverage"],
  fundCount: number,
): CashFigure {
  return coverage === "unknown"
    ? {
        state: "unknown",
        needs:
          "We have never watched your billing, so we cannot say whether anything of yours is held.",
      }
    : { state: "known", origin: "observed", value: fundCount, unit: "count" };
}

/**
 * The honest tax posture for THIS surface, rendered through `renderTaxPosture` so no arm can emit
 * a bare amount.
 *
 * The input is `CONFIG_CONFIRMED` and nothing else. While it is false the business holds no tax
 * registration anywhere (`HEAD_OFFICE_COUNTRY` is null and registration has not happened), so
 * "not owed, we hold no registration" is a code-owned fact, not a guess. It is NOT derived by
 * feeding `taxPosture` a `"not_collecting"` reason: Stripe never said that here, and inventing a
 * provider signal to reach a conclusion is fabrication even when the conclusion is right.
 *
 * The day registration lands, this page still does not read the tax lines on your invoices — so it
 * says unknown rather than carrying the old sentence forward.
 */
export function taxPostureCopy(configConfirmed: boolean): string {
  const posture: TaxPosture = configConfirmed
    ? { state: "unknown", reason: "this page does not read the tax lines on your invoices" }
    : { state: "not-owed", because: "unregistered" };
  // The currency is unused by every arm this function can produce — no arm here emits an amount.
  return renderTaxPosture(posture, "usd");
}

/** The line that replaces an invoice list, or `null` when there are invoices to list instead. */
export function invoicesCopy(
  coverage: InvoiceAnswer["coverage"],
  invoiceCount: number,
): string | null {
  if (coverage === "unknown") {
    return "We have never watched your billing, so we cannot list your invoices.";
  }
  return invoiceCount === 0 ? "No invoice has been issued to you yet." : null;
}

const utcDay = (epochMs: number): string =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(epochMs),
  );

// ── the view, hook-free so it can be rendered to a string in the test ──────────────────────

/**
 * Every piece of data arrives as a prop and `undefined` means "still loading" — the same
 * convention `useQuery` uses. Hook-free on purpose: `apps/web` has no jsdom, so the only way to
 * assert what a browser paints is `renderToStaticMarkup`, and that needs a component with no hooks.
 */
export function BillingPanelView({
  status,
  unapplied,
  invoices,
  checkout,
  managing,
  portalMessage,
  onManage,
}: {
  status: { state: BillingState } | undefined;
  unapplied: UnappliedAnswer | undefined;
  invoices: InvoiceAnswer | undefined;
  checkout: string | null;
  managing: boolean;
  portalMessage: string;
  onManage: () => void;
}) {
  const notice = checkoutNotice(checkout);
  const subscription = status ? subscriptionCopy(status.state) : null;
  const portal = manageSubscription(status?.state ?? "unknown");
  const invoiceLine = invoices ? invoicesCopy(invoices.coverage, invoices.invoices.length) : null;

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      {/* An unrecognised `?checkout=` produces no element at all — never an empty banner. */}
      {notice && checkout ? (
        <div
          data-checkout-notice={checkout}
          role="status"
          style={{
            ...card,
            gap: "0.4rem",
            borderColor: "var(--teal-400)",
          }}
        >
          <span style={sectionLabel}>Back from Stripe</span>
          <p style={{ ...body, color: "var(--ink)" }}>{notice}</p>
        </div>
      ) : null}

      <section aria-labelledby="billing-subscription-heading" style={card}>
        <div style={{ display: "grid", gap: "0.4rem" }}>
          <span style={sectionLabel}>Subscription</span>
          <h2 id="billing-subscription-heading" style={{ margin: 0, color: "var(--ink)" }}>
            {subscription ? subscription.headline : "Reading your subscription state…"}
          </h2>
          {subscription ? <p style={body}>{subscription.detail}</p> : null}
        </div>

        {status ? (
          <div style={{ display: "grid", gap: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.8rem" }}>
              <button
                type="button"
                disabled={!portal.enabled || managing}
                onClick={onManage}
                style={{
                  ...primaryButton,
                  cursor: managing ? "wait" : portal.enabled ? "pointer" : "not-allowed",
                  opacity: portal.enabled && !managing ? 1 : 0.5,
                }}
              >
                {managing ? "Opening Stripe…" : "Manage subscription in Stripe"}
              </button>
              <span role="status" aria-live="polite" style={{ color: "var(--ink-soft)" }}>
                {portalMessage}
              </span>
            </div>
            {portal.reason ? (
              <p style={{ ...body, fontSize: "0.85rem", fontWeight: 600 }}>{portal.reason}</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="billing-held-heading" style={card}>
        <div style={{ display: "grid", gap: "0.4rem" }}>
          <span style={sectionLabel}>Money held and unmatched</span>
          <h2 id="billing-held-heading" style={{ margin: 0, color: "var(--ink)" }}>
            Bank transfers we could not match
          </h2>
          <p style={body}>
            Money that reached your Stripe cash balance without matching an invoice. Stripe returns
            unmatched funds to the sending bank at 75 days and sweeps whatever it cannot return at
            90, so the age matters more than the amount.
          </p>
        </div>

        {unapplied ? (
          <>
            <div className="stat-grid">
              <FigureTile
                label="Balances held"
                figure={heldBalancesFigure(unapplied.coverage, unapplied.funds.length)}
              />
            </div>
            {unapplied.truncated ? (
              <p style={{ ...body, fontWeight: 600, color: "var(--ink)" }}>
                More balances exist than this read returns. This list is a floor, not the whole of
                what is held.
              </p>
            ) : null}
            {unapplied.funds.length > 0 ? (
              <ul
                style={{
                  ...body,
                  margin: 0,
                  paddingLeft: "1.1rem",
                  display: "grid",
                  gap: "0.5rem",
                }}
              >
                {unapplied.funds.map((entry) => (
                  <li key={entry.stripeObjectId}>
                    <strong style={{ color: "var(--ink)" }}>
                      {heldAmountCopy(entry.amountMinor, entry.currency)}
                    </strong>{" "}
                    — {unappliedFundCopy(entry.ageDays)}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p style={body}>Reading your held balances…</p>
        )}
      </section>

      <section aria-labelledby="billing-invoices-heading" style={card}>
        <div style={{ display: "grid", gap: "0.4rem" }}>
          <span style={sectionLabel}>Invoices</span>
          <h2 id="billing-invoices-heading" style={{ margin: 0, color: "var(--ink)" }}>
            Your invoices, on Stripe
          </h2>
          <p style={body}>
            Each invoice opens on Stripe's own hosted page, which is where it is paid and, where the
            country supports it, where the bank transfer instructions appear. Pikar renders no
            invoice and holds no payment details.
          </p>
        </div>

        {invoices ? (
          invoiceLine ? (
            <p style={body}>{invoiceLine}</p>
          ) : (
            <ul
              style={{ ...body, margin: 0, paddingLeft: "1.1rem", display: "grid", gap: "0.5rem" }}
            >
              {invoices.invoices.map((entry) => (
                <li key={entry.periodKey}>
                  <a
                    href={entry.hostedInvoiceUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                    style={{ color: "var(--teal-900)", fontWeight: 600 }}
                  >
                    {entry.periodKey}
                  </a>{" "}
                  — {heldAmountCopy(entry.amountMinor, entry.currency)}, posted{" "}
                  {utcDay(entry.postedAt)}
                </li>
              ))}
            </ul>
          )
        ) : (
          <p style={body}>Reading your invoices…</p>
        )}
      </section>

      <section aria-labelledby="billing-tax-heading" style={card}>
        <div style={{ display: "grid", gap: "0.4rem" }}>
          <span style={sectionLabel}>Tax</span>
          <h2 id="billing-tax-heading" style={{ margin: 0, color: "var(--ink)" }}>
            What you are charged in tax
          </h2>
          <p style={{ ...body, color: "var(--ink)", fontWeight: 600 }}>
            {taxPostureCopy(CONFIG_CONFIRMED)}
          </p>
          <p style={body}>
            Said in words rather than as an amount on purpose: a zero on a tax line has several
            different meanings, and the reason travels with the number or there is no number.
          </p>
        </div>
      </section>
    </div>
  );
}

// ── the connected panel ────────────────────────────────────────────────────────────────────

/**
 * WHY `window.location.search` AND NOT `useSearchParams`: the established idiom in this repo
 * (`dashboard/voice/page.tsx` and `dashboard/workspace/page.tsx` both carry the same note). It
 * avoids the Suspense boundary the App Router otherwise requires, where a missing one either
 * errors at prerender or silently deopts the page to client-side rendering. Safe here because
 * `?checkout=` is only needed for a banner, many frames after mount.
 */
export function BillingPanel() {
  const status = useQuery(api.billing.billingStatus, {});
  const unapplied = useQuery(api.billing.unappliedFunds, {});
  const invoices = useQuery(api.billing.invoices, {});
  const openPortal = useAction(api.billing.portalLink);

  const [checkout, setCheckout] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [portalMessage, setPortalMessage] = useState("");

  useEffect(() => {
    setCheckout(new URLSearchParams(window.location.search).get("checkout"));
  }, []);

  async function manage() {
    // The SECOND half of rule 4. `disabled` is a presentation fact a devtools user can strip; this
    // is the one that decides whether `portalLink` is called at all.
    if (!manageSubscription(status?.state ?? "unknown").enabled) return;
    setManaging(true);
    setPortalMessage("");
    try {
      const door = await openPortal({});
      if (door.ok) {
        window.location.assign(door.url);
        return;
      }
      setPortalMessage(
        door.reason === "no_stripe_customer"
          ? (manageSubscription("unknown").reason ?? "")
          : "Stripe would not open the billing portal. Nothing about your account changed.",
      );
    } catch {
      setPortalMessage(
        "Stripe would not open the billing portal. Nothing about your account changed.",
      );
    } finally {
      setManaging(false);
    }
  }

  return (
    <BillingPanelView
      status={status}
      unapplied={unapplied}
      invoices={invoices}
      checkout={checkout}
      managing={managing}
      portalMessage={portalMessage}
      onManage={() => void manage()}
    />
  );
}

export default BillingPanel;
