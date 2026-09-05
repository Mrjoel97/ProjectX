import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Invoice, Projection } from "@pikar/revenue";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(),
  useAction: vi.fn(),
}));

import {
  OPEN_INVOICE_LIMIT,
  openInvoiceRows,
  RevenuePackPanelView,
  type RevenueWorkflowOffer,
  reminderOpener,
} from "./RevenuePackPanel";

const offer = (over: Partial<RevenueWorkflowOffer> = {}): RevenueWorkflowOffer => ({
  id: "lead-triage",
  provider: "hubspot",
  providerLabel: "HubSpot",
  title: "Lead triage",
  summary: "Rank the people who need attention from current CRM facts.",
  opener: "Review my HubSpot leads and rank who needs attention.",
  skill: { name: "revenue-lead-triage", version: 1 },
  runtimeSkill: { name: "revenue-specialist", version: 1 },
  ...over,
});

describe("RevenuePackPanelView", () => {
  test("keeps loading distinct from an empty passed-provider projection", () => {
    expect(
      renderToStaticMarkup(<RevenuePackPanelView offers={undefined} onStart={() => {}} />),
    ).toContain("Checking revenue workflow availability");
    const settled = renderToStaticMarkup(<RevenuePackPanelView offers={[]} onStart={() => {}} />);
    expect(settled).toContain('data-testid="revenue-pack-settled"');
    expect(settled).not.toContain("Revenue workflows");
  });

  test("renders one independently passed provider while absent providers stay absent", () => {
    const html = renderToStaticMarkup(
      <RevenuePackPanelView offers={[offer()]} onStart={() => {}} />,
    );

    expect(html).toContain("Lead triage");
    expect(html).toContain("HubSpot");
    expect(html).toContain("Start Lead triage");
    expect(html).not.toContain("QuickBooks");
    expect(html).not.toContain("Stripe");
    expect(html).not.toContain("PayPal");
  });

  test("renders only the exact active pins supplied by the server", () => {
    const html = renderToStaticMarkup(
      <RevenuePackPanelView
        offers={[
          offer(),
          offer({
            id: "call-list",
            title: "Call list",
            opener: "Build my HubSpot call list from current follow-ups.",
            skill: { name: "revenue-call-list", version: 1 },
          }),
        ]}
        onStart={() => {}}
      />,
    );
    expect(html).toContain("Lead triage");
    expect(html).toContain("Call list");
    expect(html).not.toContain("Pipeline review");
    expect(html).not.toContain("Cash flow");
    expect(html).not.toContain("Invoice reminder");
  });

  test("uses non-color-only provider and readiness copy", () => {
    const html = renderToStaticMarkup(
      <RevenuePackPanelView offers={[offer()]} onStart={() => {}} />,
    );
    expect(html).toContain("HubSpot read-only");
    expect(html).toContain("Ready from passed live evidence");
  });
});

// ── 28.2 (G22): the invoice-reminder offer can list open invoices ─────────────

const NOW = Date.UTC(2026, 8, 6);
const DAY = 86_400_000;
const inv = (id: string, over: Partial<Invoice> = {}): Invoice => ({
  ref: { provider: "quickbooks", kind: "invoice", id },
  customerRef: `c-${id}`,
  issuedAt: NOW - 40 * DAY,
  dueAt: NOW - 10 * DAY,
  total: { minor: 125_000, currency: "USD" },
  outstanding: { minor: 125_000, currency: "USD" },
  ...over,
});
/** The READY variant, not the union: spreading a union to make a `partial` distributes over every
 *  member and produces an unassignable shape (revenue-connectors.md, reminders.test.ts lesson). */
type ReadyInvoices = Extract<Projection<Invoice>, { state: "ready" }>;
const ready = (items: Invoice[]): ReadyInvoices => ({
  state: "ready",
  meta: {
    provider: "quickbooks",
    authority: "accounting_authority",
    retrievedAt: NOW,
    window: { startMs: NOW - 90 * DAY, endMs: NOW },
    capped: false,
    sources: items.map((i) => i.ref),
  },
  items,
});
const reminderOffer = (over: Partial<RevenueWorkflowOffer> = {}) =>
  offer({
    id: "invoice-reminder-quickbooks",
    provider: "quickbooks",
    providerLabel: "QuickBooks",
    title: "Invoice reminder",
    summary: "Prepare a reminder draft for human approval. Nothing is sent.",
    opener: "Prepare an invoice reminder from QuickBooks. Keep it as a draft for my approval.",
    skill: { name: "revenue-invoice-reminder", version: 1 },
    ...over,
  });

describe("openInvoiceRows — open means still owed, oldest due first, capped, honest about partial", () => {
  test("drops paid invoices, sorts by due date with unknown dates last, formats the exact amount", () => {
    const view = openInvoiceRows(
      ready([
        inv("later", { dueAt: NOW - 2 * DAY }),
        inv("paid", { outstanding: { minor: 0, currency: "USD" } }),
        inv("nodue", { dueAt: null }),
        inv("oldest", { dueAt: NOW - 30 * DAY, outstanding: { minor: 9_950, currency: "USD" } }),
      ]),
      NOW,
    );
    if (view.state !== "ready") throw new Error(view.state);
    expect(view.rows.map((r) => r.id)).toEqual(["oldest", "later", "nodue"]);
    expect(view.rows[0]).toEqual({
      id: "oldest",
      amount: "99.50 USD",
      dueAt: NOW - 30 * DAY,
      daysPastDue: 30,
    });
    expect(view.rows[2]?.daysPastDue).toBeNull();
    expect(view.incomplete).toBeNull();
  });

  test("caps at the limit and carries a partial read's missing sentence", () => {
    const many = Array.from({ length: OPEN_INVOICE_LIMIT + 3 }, (_, i) =>
      inv(`i${i}`, { dueAt: NOW - i * DAY }),
    );
    const partial: Projection<Invoice> = { ...ready(many), state: "partial", missing: "next page" };
    const view = openInvoiceRows(partial, NOW);
    if (view.state !== "ready") throw new Error(view.state);
    expect(view.rows).toHaveLength(OPEN_INVOICE_LIMIT);
    expect(view.incomplete).toBe("next page");
  });

  test("an unavailable read stays unavailable with its reason", () => {
    expect(
      openInvoiceRows(
        { state: "unavailable", provider: "quickbooks", because: "the QuickBooks lane is parked" },
        NOW,
      ),
    ).toEqual({ state: "unavailable", because: "the QuickBooks lane is parked" });
  });
});

describe("the reminder opener is the sentence the eval case drives", () => {
  test("case 42's first turn is exactly reminderOpener(QuickBooks, qb-invoice-42)", () => {
    const fixture = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            "../../../../../../packages/backend/scripts/eval-cases/42-revenue-invoice-reminder.json",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    ) as { turns: string[] };
    expect(fixture.turns[0]).toBe(reminderOpener("QuickBooks", "qb-invoice-42"));
  });
});

describe("the invoice-reminder offer lists open invoices on request and offers one control per row", () => {
  const noop = () => {};

  test("nothing loads on render: the list is a request, and only the two reminder providers get it", () => {
    const html = renderToStaticMarkup(
      <RevenuePackPanelView
        offers={[
          reminderOffer(),
          reminderOffer({
            id: "invoice-reminder-paypal",
            provider: "paypal",
            providerLabel: "PayPal",
          }),
          offer(),
        ]}
        onStart={noop}
        onShowInvoices={noop}
        onRemind={noop}
      />,
    );
    expect(html.split("Show open invoices").length - 1).toBe(1);
    expect(html).not.toContain("Reading open invoices");
  });

  test("ready rows render id, amount, lateness and a Draft a reminder control; nothing says send", () => {
    const view = openInvoiceRows(ready([inv("1042"), inv("1043", { dueAt: NOW })]), NOW);
    const html = renderToStaticMarkup(
      <RevenuePackPanelView
        offers={[reminderOffer()]}
        onStart={noop}
        invoices={{ "invoice-reminder-quickbooks": view }}
        onShowInvoices={noop}
        onRemind={noop}
      />,
    );
    expect(html).toContain("Invoice 1042 · 1250.00 USD · 10 days late");
    expect(html).toContain("Invoice 1043 · 1250.00 USD · due ");
    expect(html).toContain('aria-label="Draft a reminder for invoice 1042"');
    expect(html.split("Draft a reminder").length - 1).toBe(4); // 2 labels + 2 button texts
    // The offer copy says "Nothing is sent"; the claim is about CONTROLS: no button sends or approves.
    expect(html.match(/<button[^>]*>[^<]*(send|approve)[^<]*<\/button>/i)).toBeNull();
  });

  test("loading, unavailable, empty and incomplete each say so in words", () => {
    const render = (state: Parameters<typeof openInvoiceRows>[0] | { state: "loading" }) =>
      renderToStaticMarkup(
        <RevenuePackPanelView
          offers={[reminderOffer()]}
          onStart={noop}
          invoices={{
            "invoice-reminder-quickbooks":
              "items" in state || state.state === "unavailable"
                ? openInvoiceRows(state as Projection<Invoice>, NOW)
                : { state: "loading" },
          }}
          onShowInvoices={noop}
          onRemind={noop}
        />,
      );
    expect(render({ state: "loading" })).toContain("Reading open invoices");
    expect(
      render({
        state: "unavailable",
        provider: "quickbooks",
        because: "the QuickBooks lane is parked",
      }),
    ).toContain("Pikar could not read invoices: the QuickBooks lane is parked.");
    expect(render(ready([]))).toContain("No open invoices in the last 90 days.");
    expect(render({ ...ready([inv("1")]), state: "partial", missing: "next page" })).toContain(
      "This list is incomplete: next page.",
    );
  });
});
