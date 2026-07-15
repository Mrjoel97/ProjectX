"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import { type ReactNode, useState } from "react";

// Tracked-caps section label — the signature BRAND.md §3 pattern.
const sectionLabelStyle = {
  fontSize: "0.7rem",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-soft)",
} as const;

/** One tile in the eval-signals stat grid (BRAND.md §5 stat tile, token colors only). */
function StatTile({
  label,
  value,
  caption,
  title,
}: {
  label: string;
  value: ReactNode;
  caption?: string;
  title?: string;
}) {
  return (
    <div
      title={title}
      style={{
        background: "var(--card)",
        border: "1px solid var(--rule)",
        borderRadius: "1rem",
        padding: "1rem",
        display: "grid",
        gap: "0.35rem",
        alignContent: "start",
      }}
    >
      <div style={sectionLabelStyle}>{label}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--ink)" }}>{value}</div>
      {caption ? <div style={{ fontSize: "0.75rem", color: "var(--ink-soft)" }}>{caption}</div> : null}
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

  if (signals === undefined) return <p>Loading…</p>;

  const dc = signals.decisionCounts;
  const dlqRate =
    signals.requestCount > 0 ? Math.round((100 * signals.dlqTotal) / signals.requestCount) : null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))",
        gap: "0.75rem",
      }}
    >
      <StatTile
        label="Review outcomes (30 days)"
        value={
          <span style={{ fontSize: "1rem" }}>
            {REVIEW_OUTCOMES.map((k) => `${k} ${signals.reviewOutcomes[k] ?? 0}`).join(" · ")}
          </span>
        }
        caption="All sends, both lanes — the approve-proxy for cockpit sends."
      />
      <StatTile
        label="Gate decisions (pipeline)"
        value={
          <span style={{ fontSize: "1rem" }}>
            {`approve ${dc.approve ?? 0} · edit ${dc.edit ?? 0} · reject ${dc.reject ?? 0}`}
          </span>
        }
        caption={`Regenerates: ${signals.regenerateTotal}. Legacy pipeline lane only — cockpit rows carry no gate decisions.`}
      />
      <StatTile
        label="Fallbacks"
        value={signals.fallbackCount}
        caption="llm.fallback events in the window (primary model failed, cheap retry ran)."
      />
      <StatTile
        label="DLQ"
        value={`${signals.dlqNew} new / ${signals.dlqTotal} total`}
        caption={
          dlqRate === null
            ? "No telemetry rows in the window."
            : `${dlqRate}% of ${signals.requestCount} requests in the window.`
        }
      />
      <StatTile
        label="Pipeline LLM cost / delivered send"
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
    <section style={{ display: "grid", gap: "1rem", maxWidth: "56rem" }}>
      <h1>Ops</h1>
      {/* Eval signals sit ABOVE dead letters: signals are the ambient read, dead letters the incident read. */}
      <div style={sectionLabelStyle}>Eval signals</div>
      <EvalSignals />
      <div style={sectionLabelStyle}>Dead letters</div>
      {deadLetters === undefined ? (
        <p>Loading…</p>
      ) : deadLetters.length === 0 ? (
        <p style={{ color: "#666" }}>No unresolved dead letters.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.75rem" }}>
          {deadLetters.map((d) => (
            <li
              key={d._id}
              style={{ border: "1px solid #fecaca", borderRadius: "0.5rem", padding: "1rem", background: "#fef2f2" }}
            >
              <div style={{ fontWeight: 700, color: "#991b1b" }}>{d.error}</div>
              <div style={{ fontSize: "0.85rem", color: "#666", marginTop: "0.25rem" }}>
                correlationId: <code>{d.correlationId}</code>
              </div>
              <div style={{ fontSize: "0.85rem", color: "#666" }}>
                {new Date(d.createdAt).toLocaleString()}
              </div>
              <pre
                style={{
                  fontSize: "0.8rem",
                  background: "#fff",
                  border: "1px solid #eee",
                  borderRadius: "0.375rem",
                  padding: "0.5rem",
                  overflowX: "auto",
                  marginTop: "0.5rem",
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
                style={{ marginTop: "0.5rem", padding: "0.5rem 1rem", borderRadius: "0.375rem", cursor: "pointer" }}
              >
                Mark resolved
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
