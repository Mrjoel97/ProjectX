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

// A plain positional line compare (IMPR-03 before/after). ponytail: no diff library and no
// LCS — a line-index compare over the two skill bodies. Ceiling: an inserted/removed line
// mid-body misaligns the tail; upgrade to an LCS diff only if reviewers find it noisy.
function unifiedDiff(from: string, to: string): { sign: " " | "-" | "+"; text: string }[] {
  const a = from.split("\n");
  const b = to.split("\n");
  const out: { sign: " " | "-" | "+"; text: string }[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const l = a[i];
    const r = b[i];
    if (l === r) out.push({ sign: " ", text: l ?? "" });
    else {
      if (l !== undefined) out.push({ sign: "-", text: l });
      if (r !== undefined) out.push({ sign: "+", text: r });
    }
  }
  return out;
}

// IMPR-02/03 optimizer surface on the ops page: the kill switch + the owner's one-click
// candidate activation (before/after diff + evidence), both on a surface the owner already
// uses (08-CONTEXT: no new bespoke screen). Ships DORMANT — the switch is OFF until Phase 9.
function OptimizerPanel() {
  const config = useQuery(api.optimizerConfig.getOptimizerStatus, {});
  const candidates = useQuery(api.skills.candidatesForReview, {});
  const setEnabled = useMutation(api.optimizerConfig.setOptimizerEnabled);
  const activate = useMutation(api.skills.activateCandidate);
  const [busy, setBusy] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const enabled = config?.enabled ?? false;

  async function toggle() {
    if (busy || config === undefined) return;
    setBusy(true);
    try {
      await setEnabled({ enabled: !enabled });
    } finally {
      setBusy(false);
    }
  }

  async function doActivate(name: string, version: number) {
    const key = `${name}@${version}`;
    setActivating(key);
    setErrors((e) => ({ ...e, [key]: "" }));
    try {
      await activate({ name, version });
    } catch (err) {
      // Surface the EVAL_GATE (or any) refusal inline — never swallow it.
      setErrors((e) => ({ ...e, [key]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setActivating(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {/* Kill switch — a toggle bound to optimizerConfig.enabled. Meaning is never colour-only
          (BRAND §6): aria-pressed + an explicit On/Dormant word + the knob position. */}
      <div
        style={{
          background: "var(--card)",
          borderRadius: "1rem",
          boxShadow: cardShadow,
          padding: "1.25rem",
          display: "flex",
          gap: "1rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span className="stat-badge">
          <BoltIcon size={16} />
        </span>
        <div style={{ display: "grid", gap: "0.2rem", flex: "1 1 16rem" }}>
          <p className="caps-label" style={{ margin: 0 }}>
            Self-optimizer
          </p>
          <div style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>
            {config === undefined
              ? "Loading…"
              : enabled
                ? "On — the CI loop may run against feedback breaches."
                : "Dormant — ships OFF until Phase 9 brings real feedback volume."}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Optimizer kill switch"
          disabled={busy || config === undefined}
          onClick={() => void toggle()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.4rem 0.5rem 0.4rem 0.9rem",
            borderRadius: "999px",
            border: `1px solid ${enabled ? "var(--teal-600)" : "var(--rule)"}`,
            background: "var(--card)",
            cursor: busy ? "default" : "pointer",
            fontWeight: 600,
            fontSize: "0.85rem",
            color: "var(--ink)",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {enabled ? "On" : "Dormant"}
          <span
            aria-hidden
            style={{
              width: "2.2rem",
              height: "1.2rem",
              borderRadius: "999px",
              background: enabled ? "var(--teal-600)" : "var(--rule)",
              position: "relative",
              transition: "background 120ms",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: "0.15rem",
                left: enabled ? "1.15rem" : "0.15rem",
                width: "0.9rem",
                height: "0.9rem",
                borderRadius: "50%",
                background: "#fff",
                transition: "left 120ms",
              }}
            />
          </span>
        </button>
      </div>

      {/* Candidate-ready review: before/after diff + evidence + one-click activate. */}
      {candidates === undefined ? (
        <p style={{ margin: 0, color: "var(--ink-soft)" }}>Loading candidates…</p>
      ) : candidates.length === 0 ? (
        <p style={{ margin: 0, color: "var(--ink-soft)" }}>
          No optimized candidates awaiting review.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "1rem" }}>
          {candidates.map((c) => {
            const key = `${c.name}@${c.toVersion}`;
            const err = errors[key];
            return (
              <li
                key={key}
                style={{
                  background: "var(--card)",
                  borderRadius: "1rem",
                  boxShadow: cardShadow,
                  padding: "1.25rem",
                  display: "grid",
                  gap: "0.75rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: "0.6rem",
                    alignItems: "baseline",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontWeight: 700, color: "var(--ink)" }}>{c.name}</span>
                  <span style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
                    v{c.fromVersion ?? "—"} → v{c.toVersion}
                  </span>
                  {/* Gate pre-warning — not colour-only: an explicit word (§6). */}
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      color: c.gatePassed ? "var(--released)" : "#991b1b",
                    }}
                  >
                    {c.gatePassed
                      ? "eval evidence: passing"
                      : "eval evidence: none — gate will refuse"}
                  </span>
                </div>

                <details>
                  <summary
                    style={{ cursor: "pointer", fontSize: "0.82rem", color: "var(--ink-soft)" }}
                  >
                    Before / after (skill body diff)
                  </summary>
                  <pre
                    style={{
                      margin: "0.5rem 0 0",
                      fontSize: "0.72rem",
                      fontFamily: "var(--font-mono), ui-monospace, monospace",
                      background: "var(--canvas)",
                      border: "1px solid var(--rule)",
                      borderRadius: "0.6rem",
                      padding: "0.75rem",
                      overflowX: "auto",
                      maxHeight: "22rem",
                      overflowY: "auto",
                    }}
                  >
                    {unifiedDiff(c.fromBody ?? "", c.toBody).map((line, i) => (
                      <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: positional diff lines have no stable id
                        key={i}
                        style={{
                          color:
                            line.sign === "+"
                              ? "var(--released)"
                              : line.sign === "-"
                                ? "#991b1b"
                                : "var(--ink-soft)",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {line.sign} {line.text}
                      </div>
                    ))}
                  </pre>
                </details>

                <details>
                  <summary
                    style={{ cursor: "pointer", fontSize: "0.82rem", color: "var(--ink-soft)" }}
                  >
                    Triggering evidence
                  </summary>
                  <pre
                    style={{
                      margin: "0.5rem 0 0",
                      fontSize: "0.72rem",
                      fontFamily: "var(--font-mono), ui-monospace, monospace",
                      background: "var(--canvas)",
                      border: "1px solid var(--rule)",
                      borderRadius: "0.6rem",
                      padding: "0.75rem",
                      overflowX: "auto",
                    }}
                  >
                    {c.evidence ?? "No eval evidence recorded yet."}
                  </pre>
                </details>

                <button
                  type="button"
                  disabled={activating === key}
                  onClick={() => void doActivate(c.name, c.toVersion)}
                  style={{
                    justifySelf: "start",
                    padding: "0.55rem 1.2rem",
                    borderRadius: "999px",
                    border: "none",
                    cursor: activating === key ? "default" : "pointer",
                    background: "var(--teal-600)",
                    color: "#fff",
                    fontWeight: 600,
                    fontSize: "0.9rem",
                    fontFamily: "inherit",
                    opacity: activating === key ? 0.6 : 1,
                  }}
                >
                  {activating === key ? "Activating…" : `Activate v${c.toVersion}`}
                </button>

                {err ? (
                  <p role="alert" style={{ margin: 0, color: "#991b1b", fontSize: "0.82rem" }}>
                    {err}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
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
  // GOVN-01. One non-disclosing boolean; the server wrappers on the four optimizer/skill
  // endpoints are the actual trust boundary. `undefined` is the loading state and renders
  // NOTHING optimizer-shaped — fail closed, so a slow query cannot flash the admin surface.
  const viewer = useQuery(api.owner.viewer, {});
  const isOwner = viewer?.isOwner === true;

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

      {/* Optimizer sits between the ambient eval read and the incident dead-letter read:
          the kill switch + candidate activation are operator controls, not incidents.

          OWNER-ONLY (GOVN-01). The WHOLE section is conditional, and that is the security
          property: OptimizerPanel owns all four owner-only hooks, so mounting it is what
          subscribes to global config and candidate prompt BODIES. Hiding it with CSS,
          `hidden`, opacity, or an early return INSIDE the panel would each still run those
          hooks and leak through the subscription, the loading state, or the error boundary.
          Only /ops's optimizer section is gated — Eval signals and Dead letters below stay
          tenant-visible, because this page is deliberately mixed-purpose. */}
      {isOwner && (
        <section style={{ display: "grid", gap: "0.9rem" }}>
          <p className="caps-label" style={{ margin: 0 }}>
            Optimizer
          </p>
          <OptimizerPanel />
        </section>
      )}

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
