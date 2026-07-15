"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import { type ReactNode, useState } from "react";
import { BellIcon, BoltIcon, MailIcon, ShieldIcon, WalletIcon } from "../../(auth)/icons";

// Visual chrome shared with the Command Center (globals.css .stat-tile): white card,
// 1rem radius, soft diffuse shadow — anchored on the canvas, not a floating outline.
const cardShadow = "0 14px 40px -30px rgb(14 20 25 / 40%)";

/** One tile in the eval-signals stat grid — the dashboard's .stat-tile pattern
 *  (icon badge + caps label + value, BRAND.md §5), reused via the shared classes. */
function StatTile({
  label,
  value,
  caption,
  icon,
  title,
  big,
}: {
  label: string;
  value: ReactNode;
  caption?: string;
  icon: ReactNode;
  title?: string;
  big?: boolean;
}) {
  return (
    <div className="stat-tile" title={title}>
      <div className="stat-head">
        <span className="stat-badge">{icon}</span>
        <p className="caps-label">{label}</p>
      </div>
      <div className={`stat-value${big ? "" : " is-text"}`}>{value}</div>
      {caption ? (
        <div style={{ fontSize: "0.78rem", color: "var(--ink-soft)", lineHeight: 1.45 }}>
          {caption}
        </div>
      ) : null}
    </div>
  );
}

// The reviewOutcome vocabulary (pipeline.ts terminal outcomes) — rendered in a fixed
// order so an outcome with zero rows still shows an honest 0 (BRAND.md §5 empty states).
const REVIEW_OUTCOMES = ["sent", "rejected", "expired", "failed", "blocked"] as const;

// EVAL-02: production eval signals computed from EXISTING telemetry/audit/deadLetters
// rows (opsSignals.evalSignals — read-only, tenant-scoped, 30-day window). Labels are
// honest about what rows contain: cockpit sends carry costUsd 0 and empty decisionCounts,
// so gate decisions are pipeline-only and the reviewOutcome distribution is the
// approve-proxy for cockpit sends (RESEARCH Pitfall 6).
function EvalSignals() {
  const signals = useQuery(api.opsSignals.evalSignals, {});

  if (signals === undefined) return <p style={{ margin: 0, color: "var(--ink-soft)" }}>Loading…</p>;

  const dc = signals.decisionCounts;
  const dlqRate =
    signals.requestCount > 0 ? Math.round((100 * signals.dlqTotal) / signals.requestCount) : null;

  return (
    <div className="stat-grid">
      <StatTile
        label="Review outcomes (30 days)"
        icon={<MailIcon size={16} />}
        value={
          <span style={{ fontSize: "1rem" }}>
            {REVIEW_OUTCOMES.map((k) => `${k} ${signals.reviewOutcomes[k] ?? 0}`).join(" · ")}
          </span>
        }
        caption="All sends, both lanes — the approve-proxy for cockpit sends."
      />
      <StatTile
        label="Gate decisions (pipeline)"
        icon={<ShieldIcon size={16} />}
        value={
          <span style={{ fontSize: "1rem" }}>
            {`approve ${dc.approve ?? 0} · edit ${dc.edit ?? 0} · reject ${dc.reject ?? 0}`}
          </span>
        }
        caption={`Regenerates: ${signals.regenerateTotal}. Legacy pipeline lane only — cockpit rows carry no gate decisions.`}
      />
      <StatTile
        label="Fallbacks"
        icon={<BoltIcon size={16} />}
        big
        value={signals.fallbackCount}
        caption="llm.fallback events in the window (primary model failed, cheap retry ran)."
      />
      <StatTile
        label="DLQ"
        icon={<BellIcon size={16} />}
        value={`${signals.dlqNew} new / ${signals.dlqTotal} total`}
        caption={
          dlqRate === null
            ? "No telemetry rows in the window."
            : `${dlqRate}% of ${signals.requestCount} requests in the window.`
        }
      />
      <StatTile
        label="Pipeline LLM cost / delivered send"
        icon={<WalletIcon size={16} />}
        value={`$${signals.costPerDeliveredUsd.toFixed(4)}`}
        title="Pipeline lane only: cockpit reasoning spend goes to the rate limiter, not telemetry — cockpit send rows carry costUsd 0."
        caption={`$${signals.totalCostUsd.toFixed(4)} total over ${signals.deliveredCount} delivered.`}
      />
    </div>
  );
}

// OPSG-07: the operator dead-letter surface — a failure nobody sees is a failure nobody
// fixes. Tenant-scoped (not owner-gated — CONTEXT). Rows are redaction-safe: refs, hashes,
// ids, counts ONLY — never raw user content or PII (CLAUDE.md §4). Ships resolve only;
// replay is deferred.
export default function OpsPage() {
  const deadLetters = useQuery(api.deadLetters.listNew);
  const markResolved = useMutation(api.deadLetters.markResolved);
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <div style={{ display: "grid", gap: "1.5rem", alignContent: "start" }}>
      <h1
        style={{
          margin: 0,
          fontFamily: "var(--font-display), system-ui, sans-serif",
          fontWeight: 800,
          fontSize: "clamp(1.9rem, 1.4rem + 1.8vw, 2.75rem)",
          letterSpacing: "-0.03em",
          color: "var(--ink)",
        }}
      >
        Ops
      </h1>

      {/* Eval signals sit ABOVE dead letters: signals are the ambient read, dead letters the incident read. */}
      <section style={{ display: "grid", gap: "0.9rem" }}>
        <p className="caps-label" style={{ margin: 0 }}>
          Eval signals
        </p>
        <EvalSignals />
      </section>

      <section style={{ display: "grid", gap: "0.9rem" }}>
        <p className="caps-label" style={{ margin: 0 }}>
          Dead letters
        </p>
        {deadLetters === undefined ? (
          <p style={{ margin: 0, color: "var(--ink-soft)" }}>Loading…</p>
        ) : deadLetters.length === 0 ? (
          <p style={{ margin: 0, color: "var(--ink-soft)" }}>No unresolved dead letters.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "1rem" }}>
            {deadLetters.map((d) => (
              <li
                key={d._id}
                style={{
                  background: "var(--card)",
                  borderRadius: "1rem",
                  // The one deliberate red on the page: incident accent. No token covers
                  // danger-red; #dc2626 matches the rail's DLQ badge (globals.css .rail-badge).
                  borderLeft: "3px solid #dc2626",
                  boxShadow: cardShadow,
                  padding: "1.25rem",
                  display: "grid",
                  gap: "0.5rem",
                }}
              >
                <div style={{ fontWeight: 700, color: "#991b1b" }}>{d.error}</div>
                <div
                  style={{
                    fontSize: "0.8rem",
                    color: "var(--ink-soft)",
                    fontFamily: "var(--font-mono), ui-monospace, monospace",
                  }}
                >
                  correlationId: <code>{d.correlationId}</code>
                  {" · "}
                  {new Date(d.createdAt).toLocaleString()}
                </div>
                <pre
                  style={{
                    margin: 0,
                    fontSize: "0.75rem",
                    fontFamily: "var(--font-mono), ui-monospace, monospace",
                    background: "var(--canvas)",
                    border: "1px solid var(--rule)",
                    borderRadius: "0.6rem",
                    padding: "0.75rem",
                    overflowX: "auto",
                  }}
                >
                  {JSON.stringify(d.payload, null, 2)}
                </pre>
                <button
                  type="button"
                  disabled={busy === d._id}
                  onClick={async () => {
                    setBusy(d._id);
                    try {
                      await markResolved({ id: d._id });
                    } finally {
                      setBusy(null);
                    }
                  }}
                  style={{
                    justifySelf: "start",
                    marginTop: "0.25rem",
                    padding: "0.55rem 1.2rem",
                    borderRadius: "999px",
                    border: "none",
                    cursor: busy === d._id ? "default" : "pointer",
                    background: "var(--teal-600)",
                    color: "#fff",
                    fontWeight: 600,
                    fontSize: "0.9rem",
                    fontFamily: "inherit",
                    opacity: busy === d._id ? 0.6 : 1,
                  }}
                >
                  Mark resolved
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
