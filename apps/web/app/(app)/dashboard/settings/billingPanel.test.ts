// 28.1-09 — the tenant-facing billing surface, asserted in the DOM-free runner.
//
// `.test.ts`, NOT `.test.tsx` — `apps/web/vitest.config.mts` includes `app/**/*.test.ts` only, and
// a `.tsx` here would be silently skipped AND would need a DOM that this workspace does not have.
// The hook-free `BillingPanelView` is rendered to a STRING with `renderToStaticMarkup`, the same
// idiom `../finance/cashView.test.ts` uses; the connected `BillingPanel` calls `useQuery` and is
// deliberately not reachable from here.
//
// WHY BOTH LAYERS ARE ASSERTED: a pure helper returning the right sentence proves nothing about
// what a browser paints. Every refusal below is pinned twice — once on the helper, once on the
// markup the helper's caller actually produces.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  BillingPanelView,
  checkoutNotice,
  heldAmountCopy,
  heldBalancesFigure,
  invoicesCopy,
  manageSubscription,
  subscriptionCopy,
  taxPostureCopy,
  unappliedFundCopy,
} from "./BillingPanel";

const render = (component: unknown, props: Record<string, unknown>): string =>
  renderToStaticMarkup(createElement(component as ComponentType<Record<string, unknown>>, props));

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const fund = (over: Record<string, unknown> = {}) => ({
  stripeObjectId: "cbtxn_SENTINEL",
  amountMinor: 4900,
  currency: "usd",
  ageDays: 3,
  stage: "held" as const,
  ...over,
});

const invoice = (over: Record<string, unknown> = {}) => ({
  periodKey: "2026-08",
  periodStart: 0,
  periodEnd: 0,
  postedAt: Date.UTC(2026, 7, 1),
  amountMinor: 4900,
  currency: "usd",
  hostedInvoiceUrl: "https://invoice.stripe.com/i/acct_SENTINEL/test_SENTINELINVOICE",
  ...over,
});

const view = (over: Record<string, unknown> = {}) =>
  render(BillingPanelView, {
    status: { state: "subscribed" },
    unapplied: { coverage: "known", coverageStartedAt: 0, funds: [], truncated: false },
    invoices: { coverage: "known", coverageStartedAt: 0, invoices: [], truncated: false },
    checkout: null,
    managing: false,
    portalMessage: "",
    onManage: () => {},
    ...over,
  });

// ── the three subscription states ─────────────────────────────────────────────────────────

describe("subscription state — unknown is not zero and is not a plan", () => {
  test("unknown says we do not know, and never prints a money figure or a plan name", () => {
    const { headline, detail } = subscriptionCopy("unknown");
    const both = `${headline} ${detail}`;

    expect(both).toContain("we do not know");
    // Written-out literals. The two lies this state invites are a zero and a no-cost tier.
    expect(both).not.toContain("$0");
    expect(both).not.toContain("0.00");
    expect(both.toLowerCase()).not.toContain("free");
    expect(both.toLowerCase()).not.toContain("no charge");
  });

  test("the three states are three messages — no two collapse into each other", () => {
    const states = ["unknown", "not_subscribed", "subscribed"] as const;
    const headlines = states.map((s) => subscriptionCopy(s).headline);
    const details = states.map((s) => subscriptionCopy(s).detail);

    expect(new Set(headlines).size).toBe(3);
    expect(new Set(details).size).toBe(3);
    expect(subscriptionCopy("not_subscribed").headline).toBe("You are not subscribed.");
    expect(subscriptionCopy("subscribed").headline).toBe("You are subscribed.");
  });

  test("every helper string is complete — never blank, never a leaked undefined or NaN", () => {
    const strings = [
      subscriptionCopy("unknown").headline,
      subscriptionCopy("unknown").detail,
      subscriptionCopy("not_subscribed").headline,
      subscriptionCopy("not_subscribed").detail,
      subscriptionCopy("subscribed").headline,
      subscriptionCopy("subscribed").detail,
      checkoutNotice("success") ?? "",
      checkoutNotice("cancel") ?? "",
      unappliedFundCopy(0),
      unappliedFundCopy(75),
      unappliedFundCopy(90),
      heldAmountCopy(4900, "usd"),
      heldAmountCopy(4900, "not-a-currency"),
      taxPostureCopy(false),
      taxPostureCopy(true),
      invoicesCopy("unknown", 0) ?? "",
      invoicesCopy("known", 0) ?? "",
      manageSubscription("unknown").reason ?? "",
    ];
    for (const value of strings) {
      expect(value.trim().length).toBeGreaterThan(0);
      expect(value).not.toContain("undefined");
      expect(value).not.toContain("NaN");
    }
  });

  test("the rendered panel shows the unknown state as unknown, with no dollar figure", () => {
    const markup = view({ status: { state: "unknown" } });

    expect(markup).toContain("we do not know");
    expect(markup).not.toContain("$0");
    expect(markup).not.toContain("0.00");
    expect(markup).not.toContain("You are subscribed.");
  });
});

// ── returning from Stripe Checkout ────────────────────────────────────────────────────────

describe("?checkout= — a redirect is acknowledged, and it is never evidence", () => {
  test("a known token yields a message and an unknown token yields nothing at all", () => {
    expect(checkoutNotice("success")).toBeTruthy();
    expect(checkoutNotice("cancel")).toBeTruthy();
    expect(checkoutNotice(null)).toBeNull();
    expect(checkoutNotice("")).toBeNull();
    expect(checkoutNotice("garbage")).toBeNull();
    expect(checkoutNotice("SUCCESS")).toBeNull();
    expect(checkoutNotice("success ")).toBeNull();
    expect(checkoutNotice("successful")).toBeNull();
  });

  test("the success acknowledgement never claims a subscription — only billingStatus may", () => {
    const notice = checkoutNotice("success") ?? "";

    // Disjoint literals: the sentence billingStatus owns must not appear in the redirect notice.
    expect(notice).not.toContain(subscriptionCopy("subscribed").headline);
    expect(notice).not.toContain("You are subscribed");
    expect(notice.toLowerCase()).not.toContain("active");
    expect(notice.toLowerCase()).not.toContain("your plan is");
  });

  test("an unrecognised token renders NO banner element — not a blank one", () => {
    expect(view({ checkout: "success" })).toContain('data-checkout-notice="success"');
    expect(view({ checkout: "cancel" })).toContain('data-checkout-notice="cancel"');
    expect(view({ checkout: "garbage" })).not.toContain("data-checkout-notice");
    expect(view({ checkout: null })).not.toContain("data-checkout-notice");
  });

  test("the rendered success banner does not assert a subscription over an unknown state", () => {
    const markup = view({ checkout: "success", status: { state: "unknown" } });

    expect(markup).toContain('data-checkout-notice="success"');
    expect(markup).not.toContain("You are subscribed.");
    expect(markup).toContain("we do not know");
  });
});

// ── the 75 / 90 day clock ─────────────────────────────────────────────────────────────────

describe("unapplied funds — the amount is useless without its age", () => {
  // Boundaries asserted against WRITTEN-OUT literals. Importing UNRECONCILED_RETURN_DAYS would
  // move the oracle with the subject and pin nothing.
  test("below 75 days the money is merely waiting", () => {
    for (const age of [0, 1, 40, 74]) {
      const copy = unappliedFundCopy(age);
      expect(copy).toContain("Waiting to be matched");
      expect(copy.toLowerCase()).not.toContain("return");
      expect(copy.toLowerCase()).not.toContain("swept");
    }
  });

  test("at 75 days Stripe is returning it, and it says so", () => {
    for (const age of [75, 76, 89]) {
      expect(unappliedFundCopy(age)).toContain("Stripe is returning this to the sending bank");
    }
  });

  test("at 90 days it has been swept, and it says so", () => {
    for (const age of [90, 91, 400]) {
      expect(unappliedFundCopy(age)).toContain("Stripe has swept this out of your cash balance");
    }
  });

  test("the age is spoken in days, singular at one", () => {
    expect(unappliedFundCopy(1)).toContain("1 day");
    expect(unappliedFundCopy(1)).not.toContain("1 days");
    expect(unappliedFundCopy(2)).toContain("2 days");
  });

  test("the amount keeps its cents and its currency, and refuses an unrecognised one", () => {
    expect(heldAmountCopy(4900, "usd")).toBe("49.00 USD");
    expect(heldAmountCopy(1234, "usd")).toBe("12.34 USD");
    expect(heldAmountCopy(1234, "not-a-currency")).toBe(
      "1234 minor units — unrecognised currency, not converted.",
    );
  });

  test("no coverage is UNKNOWN, not a zero — and a real zero is a real zero", () => {
    const noCoverage = heldBalancesFigure("unknown", 0);
    expect(noCoverage.state).toBe("unknown");
    if (noCoverage.state === "unknown") expect(noCoverage.needs).not.toContain("0");

    const measuredZero = heldBalancesFigure("known", 0);
    expect(measuredZero.state).toBe("known");
    if (measuredZero.state === "known") {
      expect(measuredZero.value).toBe(0);
      expect(measuredZero.unit).toBe("count");
    }

    const three = heldBalancesFigure("known", 3);
    if (three.state === "known") expect(three.value).toBe(3);
  });

  test("the rendered panel shows a held balance with its amount, its age and its stage", () => {
    const markup = view({
      unapplied: {
        coverage: "known",
        coverageStartedAt: 0,
        funds: [fund({ ageDays: 90, amountMinor: 1234 })],
        truncated: false,
      },
    });

    expect(markup).toContain("12.34 USD");
    expect(markup).toContain("90 days");
    expect(markup).toContain("Stripe has swept this out of your cash balance");
  });

  test("an empty list under unknown coverage renders the em-dash, never a zero", () => {
    const markup = view({
      unapplied: { coverage: "unknown", coverageStartedAt: null, funds: [], truncated: false },
    });

    expect(markup).toContain('data-figure-state="unknown"');
    expect(markup).not.toContain("$0");
    expect(markup).not.toContain("0.00");
  });
});

// ── the tax posture ───────────────────────────────────────────────────────────────────────

describe("tax posture — words, never a bare 0.00", () => {
  test("unregistered renders the sentence renderTaxPosture owns, with no amount in it", () => {
    expect(taxPostureCopy(false)).toBe(
      "Tax not owed — we hold no tax registration in this jurisdiction.",
    );
  });

  test("once registration exists this page stops claiming to know, rather than guessing", () => {
    const copy = taxPostureCopy(true);
    expect(copy).toContain("Tax posture unknown");
    expect(copy).toContain("not reported as zero");
  });

  test("no arm of the posture emits an amount", () => {
    for (const copy of [taxPostureCopy(false), taxPostureCopy(true)]) {
      expect(copy).not.toContain("0.00");
      expect(copy).not.toContain("$0");
      expect(copy).not.toMatch(/\d/);
    }
  });

  test("the rendered panel carries the posture sentence", () => {
    expect(view()).toContain("Tax not owed — we hold no tax registration in this jurisdiction.");
  });
});

// ── the portal, and the customer that may not exist ───────────────────────────────────────

describe("manage subscription — never provoke a Stripe customer into existence", () => {
  test("an unknown state gives no portal control, and says why", () => {
    const refusal = manageSubscription("unknown");
    expect(refusal.enabled).toBe(false);
    expect(refusal.reason).toBeTruthy();
  });

  test("the two states that prove a billing record exists get the control", () => {
    expect(manageSubscription("not_subscribed").enabled).toBe(true);
    expect(manageSubscription("subscribed").enabled).toBe(true);
  });

  test("the rendered control is disabled on unknown and carries the reason", () => {
    const markup = view({ status: { state: "unknown" } });
    expect(markup).toMatch(/<button[^>]*disabled/);
    expect(markup).toContain(manageSubscription("unknown").reason);
  });

  test("the portal call is guarded in code, not only by the disabled attribute", () => {
    // `disabled` is a presentation fact a devtools user can strip, and `portalLink` must never be
    // called for a tenant we cannot prove has a Stripe customer — the refusal exists so nothing
    // provokes one into existence.
    //
    // ponytail: a SOURCE assertion, and its ceiling is honest — `BillingPanel` calls `useQuery`
    // and cannot be rendered in this DOM-free runner, so this fails when the guard is deleted but
    // proves nothing about the call at runtime. Upgrade path: a Playwright assertion on
    // `/dashboard/settings` for a tenant with no `billingCustomers` row.
    const source = read("./BillingPanel.tsx");
    expect(source).toMatch(/if \(!manageSubscription\([^)]*\)\.enabled\) return;/);
  });

  test("the rendered control is live once a billing record exists", () => {
    const markup = view({ status: { state: "subscribed" } });
    expect(markup).not.toMatch(/<button[^>]*disabled/);
  });

  test("while the queries are still loading nothing is asserted and no control is offered", () => {
    const markup = view({ status: undefined, unapplied: undefined, invoices: undefined });
    expect(markup).not.toContain("You are subscribed.");
    expect(markup).not.toContain("You are not subscribed.");
    expect(markup).not.toContain("$0");
  });
});

// ── invoices: one link each, no invoice document ──────────────────────────────────────────

describe("invoices — Stripe's hosted link and nothing else", () => {
  test("no coverage is unknown, and an empty list under coverage is stated as empty", () => {
    expect(invoicesCopy("unknown", 0)).toContain("cannot");
    expect(invoicesCopy("known", 0)).toBe("No invoice has been issued to you yet.");
    expect(invoicesCopy("known", 0)).not.toContain("$0");
    expect(invoicesCopy("known", 2)).toBeNull();
  });

  test("the rendered panel serves the hosted url verbatim, as a link", () => {
    const markup = view({
      invoices: {
        coverage: "known",
        coverageStartedAt: 0,
        invoices: [invoice()],
        truncated: false,
      },
    });

    expect(markup).toContain(
      'href="https://invoice.stripe.com/i/acct_SENTINEL/test_SENTINELINVOICE"',
    );
    expect(markup).toContain("49.00 USD");
    expect(markup).toContain("2026-08");
  });
});

// ── BRAND.md §2: amber belongs to the approval gate, and to nothing else ──────────────────

describe("no amber is spent on this surface", () => {
  const AMBER = /--held|#f0a22e/i;
  const sources = {
    "BillingPanel.tsx": read("./BillingPanel.tsx"),
    "page.tsx": read("./page.tsx"),
    "DataControls.tsx": read("./DataControls.tsx"),
  };

  // NON-VACUITY. 28.1-07 found a source scan in `convex/billing.test.ts` reducing a 468-line file
  // to 13 lines, which made every negative assertion over it pass for the wrong reason. A guard
  // that only checks "the file list is non-empty" is exactly the guard that missed it, so this
  // checks the CONTENT of each file AND that the pattern fires on a positive control.
  test("the scan is reading real files and its pattern actually matches amber", () => {
    expect(sources["BillingPanel.tsx"].length).toBeGreaterThan(2000);
    expect(sources["BillingPanel.tsx"]).toContain("BillingPanelView");
    expect(sources["page.tsx"]).toContain("BillingPanel");
    expect(sources["DataControls.tsx"]).toContain("DELETE MY DATA");

    expect(AMBER.test("color: var(--held-text)")).toBe(true);
    expect(AMBER.test("background: var(--held)")).toBe(true);
    expect(AMBER.test("background: #F0A22E")).toBe(true);
    expect(AMBER.test("color: var(--ink-soft)")).toBe(false);
  });

  test("the billing surface spends no amber — BRAND §2 keeps it for the approval gate", () => {
    // DataControls.tsx is deliberately NOT in this assertion: it already spends `--held-text` on
    // an export error and predates this rule. The new billing surface must not add a second site.
    const offenders = (["BillingPanel.tsx", "page.tsx"] as const).filter((name) =>
      AMBER.test(sources[name]),
    );
    expect(offenders).toEqual([]);
  });
});

// ── the surface is REACHED, not merely written ────────────────────────────────────────────

describe("the panel is mounted on a routed page", () => {
  test("the settings page renders it beside the data controls", () => {
    const page = read("./page.tsx");
    expect(page).toMatch(/<BillingPanel\s*\/>/);
    expect(page).toMatch(/<DataControls\s*\/>/);
    expect(read("../../layout.tsx")).toContain('href="/dashboard/settings"');
  });

  test("it reads all four billing functions the phase built", () => {
    const source = read("./BillingPanel.tsx");
    expect(source).toContain("api.billing.billingStatus");
    expect(source).toContain("api.billing.unappliedFunds");
    expect(source).toContain("api.billing.invoices");
    expect(source).toContain("api.billing.portalLink");
  });
});
