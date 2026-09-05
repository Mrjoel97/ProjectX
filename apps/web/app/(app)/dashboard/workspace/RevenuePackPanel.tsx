"use client";

import { api } from "@pikar/backend/api";
import { formatMoneyAmount, type Invoice, type Projection } from "@pikar/revenue";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { useSendCockpitMessage } from "./useSendCockpitMessage";

export type RevenueWorkflowOffer = {
  id: string;
  provider: "hubspot" | "quickbooks" | "stripe" | "paypal";
  providerLabel: string;
  title: string;
  summary: string;
  opener: string;
  skill: { name: string; version: number };
  runtimeSkill: { name: string; version: number };
};

// ── open invoices (28.2, G22) ─────────────────────────────────────────────────
// The reminder tool needs an invoice ID and nothing in the product ever showed one — a solopreneur
// does not know their QuickBooks invoice ids. This is the smallest bridge: the invoice-reminder offer
// can list the tenant's OPEN invoices from the same gated read the tool refetches from, and one
// control per row sends the exact opener eval case 42 drives. Nothing here stages or sends; the
// cockpit turn does, behind the normal Approve gate.

export type OpenInvoiceRow = {
  id: string;
  /** `formatMoneyAmount` plus the currency code — never a localized guess at the exponent. */
  amount: string;
  dueAt: number | null;
  daysPastDue: number | null;
};
export type OpenInvoices =
  | { state: "loading" }
  | { state: "unavailable"; because: string }
  | { state: "ready"; rows: OpenInvoiceRow[]; incomplete: string | null };

/** ponytail: ten rows is a screen; a tenant with more picks the oldest ten and pages next week. */
export const OPEN_INVOICE_LIMIT = 10;
const DAY_MS = 86_400_000;

/** Pure. Open = still owed; oldest due first, unknown due dates last; capped; partial says so. */
export function openInvoiceRows(projection: Projection<Invoice>, now: number): OpenInvoices {
  if (projection.state === "unavailable")
    return { state: "unavailable", because: projection.because };
  const rows = projection.items
    .filter((invoice) => invoice.outstanding.minor > 0)
    .sort((a, b) => (a.dueAt ?? Number.POSITIVE_INFINITY) - (b.dueAt ?? Number.POSITIVE_INFINITY))
    .slice(0, OPEN_INVOICE_LIMIT)
    .map((invoice) => ({
      id: invoice.ref.id,
      amount: `${formatMoneyAmount(invoice.outstanding)} ${invoice.outstanding.currency}`,
      dueAt: invoice.dueAt,
      daysPastDue:
        invoice.dueAt === null ? null : Math.max(0, Math.floor((now - invoice.dueAt) / DAY_MS)),
    }));
  return {
    state: "ready",
    rows,
    incomplete: projection.state === "partial" ? projection.missing : null,
  };
}

/** The opener the reminder eval (case 42) drives; the id is the provider's own, verbatim. */
export const reminderOpener = (providerLabel: string, invoiceId: string): string =>
  `Draft an invoice reminder for ${providerLabel} invoice ${invoiceId}. Do not send it.`;

/** Only the two providers the reminder tool accepts get a list; PayPal's offer stays an opener. */
const listsInvoices = (offer: RevenueWorkflowOffer): boolean =>
  offer.id.startsWith("invoice-reminder-") &&
  (offer.provider === "quickbooks" || offer.provider === "stripe");

const dueCopy = (row: OpenInvoiceRow): string => {
  if (row.dueAt === null) return "no due date";
  if (row.daysPastDue === null || row.daysPastDue === 0)
    return `due ${new Date(row.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  return `${row.daysPastDue} ${row.daysPastDue === 1 ? "day" : "days"} late`;
};

const smallMuted = { color: "var(--ink-soft)", fontSize: "0.8rem", margin: 0 } as const;
const ghostButton = {
  border: "1px solid var(--rule)",
  borderRadius: "0.4rem",
  padding: "0.3rem 0.6rem",
  background: "transparent",
  color: "var(--ink)",
  fontWeight: 600,
  fontSize: "0.8rem",
  cursor: "pointer",
} as const;

function OpenInvoiceList({
  invoices,
  busy,
  onShow,
  onRemind,
}: {
  invoices: OpenInvoices | undefined;
  busy: boolean;
  onShow: () => void;
  onRemind: (invoiceId: string) => void;
}) {
  if (invoices === undefined)
    return (
      <button type="button" style={ghostButton} disabled={busy} onClick={onShow}>
        Show open invoices
      </button>
    );
  if (invoices.state === "loading")
    return (
      <p role="status" style={smallMuted}>
        Reading open invoices…
      </p>
    );
  if (invoices.state === "unavailable")
    return (
      <p role="status" style={smallMuted}>
        Pikar could not read invoices: {invoices.because}.
      </p>
    );
  return (
    <div style={{ display: "grid", gap: "0.35rem" }} data-testid="open-invoices">
      {invoices.rows.length === 0 ? (
        <p style={smallMuted}>No open invoices in the last 90 days.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.35rem" }}>
          {invoices.rows.map((row) => (
            <li
              key={row.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.5rem",
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: "var(--ink)", fontSize: "0.84rem" }}>
                Invoice {row.id} · {row.amount} · {dueCopy(row)}
              </span>
              <button
                type="button"
                style={ghostButton}
                disabled={busy}
                aria-label={`Draft a reminder for invoice ${row.id}`}
                onClick={() => onRemind(row.id)}
              >
                Draft a reminder
              </button>
            </li>
          ))}
        </ul>
      )}
      {invoices.incomplete ? (
        <p style={smallMuted}>This list is incomplete: {invoices.incomplete}.</p>
      ) : null}
    </div>
  );
}

export function RevenuePackPanelView({
  offers,
  onStart,
  busy = false,
  disabled = false,
  invoices,
  onShowInvoices,
  onRemind,
}: {
  offers: readonly RevenueWorkflowOffer[] | undefined;
  onStart: (offer: RevenueWorkflowOffer) => void;
  busy?: boolean;
  disabled?: boolean;
  /** Per offer id. Absent = not asked for yet (the list loads on request, never on render). */
  invoices?: Readonly<Record<string, OpenInvoices>>;
  onShowInvoices?: (offer: RevenueWorkflowOffer) => void;
  onRemind?: (offer: RevenueWorkflowOffer, invoiceId: string) => void;
}) {
  if (offers === undefined) {
    return (
      <p role="status" style={{ color: "var(--ink-soft)", margin: 0 }}>
        Checking revenue workflow availability…
      </p>
    );
  }
  // A positive settle marker makes authenticated absence checks non-vacuous without rendering an
  // empty feature promise. Playwright waits for this before asserting every parked lane is absent.
  if (offers.length === 0) return <span hidden data-testid="revenue-pack-settled" />;

  return (
    <section aria-labelledby="revenue-pack-label" style={{ display: "grid", gap: "0.65rem" }}>
      <div>
        <h2
          id="revenue-pack-label"
          style={{
            margin: 0,
            color: "var(--teal-900)",
            fontSize: "0.7rem",
            fontWeight: 800,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Revenue workflows
        </h2>
        <p style={{ color: "var(--ink-soft)", fontSize: "0.82rem", margin: "0.25rem 0 0" }}>
          Only workflows with current provider evidence and active skill pins appear here.
        </p>
      </div>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: "0.6rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 15rem), 1fr))",
        }}
      >
        {offers.map((offer) => (
          <li key={`${offer.provider}:${offer.id}`}>
            <article
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                gap: "0.4rem",
                padding: "0.8rem",
                background: "var(--card)",
                border: "1px solid var(--rule)",
                borderRadius: "0.65rem",
              }}
            >
              <div style={{ color: "var(--ink-soft)", fontSize: "0.75rem", fontWeight: 700 }}>
                {offer.providerLabel} read-only
              </div>
              <h3 style={{ color: "var(--ink)", fontSize: "0.95rem", margin: 0 }}>{offer.title}</h3>
              <p style={{ color: "var(--ink-soft)", fontSize: "0.84rem", margin: 0 }}>
                {offer.summary}
              </p>
              <p style={{ color: "var(--ink-soft)", fontSize: "0.76rem", margin: 0 }}>
                Ready from passed live evidence
              </p>
              {listsInvoices(offer) && onShowInvoices && onRemind ? (
                <OpenInvoiceList
                  invoices={invoices?.[offer.id]}
                  busy={busy || disabled}
                  onShow={() => onShowInvoices(offer)}
                  onRemind={(invoiceId) => onRemind(offer, invoiceId)}
                />
              ) : null}
              <button
                type="button"
                aria-label={`Start ${offer.title}`}
                disabled={busy || disabled}
                onClick={() => onStart(offer)}
                style={{
                  marginTop: "auto",
                  alignSelf: "flex-start",
                  border: 0,
                  borderRadius: "0.4rem",
                  padding: "0.4rem 0.7rem",
                  background: "var(--teal-600)",
                  color: "var(--card)",
                  fontWeight: 700,
                  cursor: busy || disabled ? "default" : "pointer",
                }}
              >
                {busy ? "Starting…" : `Start ${offer.title}`}
              </button>
            </article>
          </li>
        ))}
      </ul>
      {disabled && (
        <p role="status" style={{ color: "var(--ink-soft)", fontSize: "0.8rem", margin: 0 }}>
          Start a conversation to use a revenue workflow.
        </p>
      )}
    </section>
  );
}

export function RevenuePackPanel({ threadId }: { threadId?: string }) {
  const offers = useQuery(api.providerGates.revenueDiscovery, {});
  const send = useSendCockpitMessage();
  const readQuickBooks = useAction(api.quickbooks.readEntity);
  const readStripe = useAction(api.stripeConnector.readEntity);
  const [starting, setStarting] = useState(false);
  const [invoices, setInvoices] = useState<Record<string, OpenInvoices>>({});

  async function start(offer: RevenueWorkflowOffer) {
    if (!threadId || starting) return;
    setStarting(true);
    try {
      await send({ threadId, text: offer.opener });
    } finally {
      setStarting(false);
    }
  }

  // The offers are production-only (`revenueDiscovery`), so the read is too. Same gated read the
  // reminder tool refetches from — a parked lane answers `unavailable`, never a list.
  async function showInvoices(offer: RevenueWorkflowOffer) {
    setInvoices((m) => ({ ...m, [offer.id]: { state: "loading" } }));
    try {
      const projection =
        offer.provider === "stripe"
          ? await readStripe({ environment: "production", entity: "invoices", windowDays: 90 })
          : await readQuickBooks({ environment: "production", entity: "Invoice", windowDays: 90 });
      // The entity literal fixes the item shape server-side; the action's return type is the
      // union over every entity it can read.
      setInvoices((m) => ({
        ...m,
        [offer.id]: openInvoiceRows(projection as Projection<Invoice>, Date.now()),
      }));
    } catch {
      setInvoices((m) => ({
        ...m,
        [offer.id]: { state: "unavailable", because: "the read did not complete" },
      }));
    }
  }

  async function remind(offer: RevenueWorkflowOffer, invoiceId: string) {
    if (!threadId || starting) return;
    setStarting(true);
    try {
      await send({ threadId, text: reminderOpener(offer.providerLabel, invoiceId) });
    } finally {
      setStarting(false);
    }
  }

  return (
    <RevenuePackPanelView
      offers={offers}
      onStart={(offer) => void start(offer)}
      busy={starting}
      disabled={!threadId}
      invoices={invoices}
      onShowInvoices={(offer) => void showInvoices(offer)}
      onRemind={(offer, invoiceId) => void remind(offer, invoiceId)}
    />
  );
}
