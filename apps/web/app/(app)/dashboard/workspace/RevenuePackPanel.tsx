"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
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

export function RevenuePackPanelView({
  offers,
  onStart,
  busy = false,
  disabled = false,
}: {
  offers: readonly RevenueWorkflowOffer[] | undefined;
  onStart: (offer: RevenueWorkflowOffer) => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  if (offers === undefined) {
    return (
      <p role="status" style={{ color: "var(--ink-soft)", margin: 0 }}>
        Checking revenue workflow availability…
      </p>
    );
  }
  if (offers.length === 0) return null;

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
  const [starting, setStarting] = useState(false);

  async function start(offer: RevenueWorkflowOffer) {
    if (!threadId || starting) return;
    setStarting(true);
    try {
      await send({ threadId, text: offer.opener });
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
    />
  );
}
