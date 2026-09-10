"use client";

import { api } from "@pikar/backend/api";
import type { VerticalId, VerticalReason, VerticalRecommendation } from "@pikar/core/verticalPacks";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { card, primaryButton } from "./styles";
import { VerticalWorkloadConfirmation } from "./VerticalWorkloadConfirmation";

const TITLES: Record<VerticalId, string> = {
  legal: "Review contract issues",
  hr: "Prepare onboarding materials",
  product: "Develop a product brief",
  design: "Review a design artifact",
  engineering: "Review a technical runbook",
  data: "Understand a dataset",
};
const OPENERS: Record<VerticalId, string> = {
  legal:
    "Help me identify contract issues against my confirmed playbook. Ask for the contract and missing context before reviewing it.",
  hr: "Help me prepare onboarding materials from my existing policies. Ask for the role and missing context first.",
  product:
    "Help me develop a product brief from my supplied evidence. Ask which product and decision it should support.",
  design:
    "Help me review a design artifact. Ask for the actual artifact and intended audience before making findings.",
  engineering:
    "Help me review a technical runbook using recorded evidence. Ask for the runbook and its context first.",
  data: "Help me understand a CSV or XLSX dataset using deterministic validation. Ask me to select the file and identify its headers first.",
};
const REASONS: Record<VerticalReason, string> = {
  "unconfirmed-profile": "Confirm your business profile first.",
  "no-confirmed-need": "Confirm that this workflow is useful for your business.",
  "insufficient-repeat-use": "More evidence of repeat use is needed.",
  "not-released": "This workflow is not available yet.",
  disabled: "You have turned this workflow off. Your saved documents remain available.",
  "missing-source": "Add the source documents needed for this review to your Vault.",
  "review-required": "Confirm who will review the result before starting.",
  "playbook-required": "Select a confirmed legal playbook before starting.",
  "validator-unavailable": "Dataset validation is not ready for this workflow yet.",
  "connector-not-approved": "The requested connected source is not available.",
  "confirmed-repeat-workflow": "Suggested from your confirmed needs and repeated use.",
};
const REVIEW: Record<VerticalId, string> = {
  legal: "Issue spotting for qualified counsel review; no legal clearance.",
  hr: "Draft materials for qualified HR review; no employment decisions.",
  product: "Review the evidence, assumptions and open questions before use.",
  design: "Review observable findings; accessibility checks still require testing.",
  engineering: "Review hypotheses and proposed checks; no tests or deployments run.",
  data: "Review sampling limits and source references before relying on statistics.",
};

export function VerticalRecommendationCards({
  recommendations,
  starting,
  notice,
  onStart,
  onDisable,
}: {
  recommendations: readonly VerticalRecommendation[] | undefined;
  starting: VerticalId | null;
  notice: string | null;
  onStart: (id: VerticalId) => void;
  onDisable: (id: VerticalId) => void;
}) {
  if (recommendations === undefined) return null;
  // Display only the server selection. This defensive cap never scores or grants authority.
  const shown = recommendations.filter((item) => item.state !== "hidden").slice(0, 2);
  if (shown.length === 0 && notice === null) return null;
  return (
    <section aria-labelledby="vertical-recommendations-title" style={card}>
      <h2
        id="vertical-recommendations-title"
        style={{ margin: 0, fontSize: "1.1rem", color: "var(--ink)" }}
      >
        Workflows for your work
      </h2>
      {notice && (
        <p role="status" style={{ margin: 0, color: "var(--ink-soft)" }}>
          {notice}
        </p>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "1rem" }}>
        {shown.map((item) => (
          <li key={item.id} style={{ display: "grid", gap: "0.55rem", minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: "1rem", color: "var(--ink)" }}>{TITLES[item.id]}</h3>
            <p style={{ margin: 0, color: "var(--ink-soft)" }}>{REASONS[item.reason]}</p>
            <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.85rem" }}>
              {REVIEW[item.id]}
            </p>
            <div
              style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}
            >
              {item.state === "available" && (
                <button
                  type="button"
                  disabled={starting !== null}
                  style={primaryButton(starting !== null)}
                  onClick={() => onStart(item.id)}
                >
                  {starting === item.id ? "Starting…" : "Start workflow"}
                </button>
              )}
              {item.reason === "missing-source" && (
                <a href="/dashboard/vault" style={{ color: "var(--teal-600)" }}>
                  Open Vault
                </a>
              )}
              {item.state !== "disabled" && (
                <button
                  type="button"
                  disabled={starting !== null}
                  onClick={() => onDisable(item.id)}
                  style={{
                    background: "none",
                    border: "1px solid var(--rule)",
                    borderRadius: "999px",
                    padding: "0.65rem 1rem",
                    color: "var(--ink)",
                    font: "inherit",
                    cursor: "pointer",
                  }}
                >
                  Turn off this suggestion
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function VerticalPackRecommendations() {
  const result = useQuery(api.verticalPacks.discover, {});
  const start = useAction(api.cockpit.startVerticalPack);
  const setDisabled = useMutation(api.verticalPacks.setDisabled);
  const [starting, setStarting] = useState<VerticalId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const onStart = async (verticalId: VerticalId) => {
    if (
      starting !== null ||
      !result?.recommendations.some((item) => item.id === verticalId && item.state === "available")
    )
      return;
    setStarting(verticalId);
    setNotice(null);
    try {
      const reply = await start({ verticalId, text: OPENERS[verticalId] });
      if (!reply.ok || typeof reply.threadId !== "string") {
        setNotice(
          "This workflow is no longer ready to start. Check its requirements and try again.",
        );
        return;
      }
      window.location.assign(
        `/dashboard/workspace?thread=${encodeURIComponent(reply.threadId)}&label=${encodeURIComponent(TITLES[verticalId])}`,
      );
    } catch {
      // An action error can arrive after work begins; do not promise that nothing ran.
      setNotice("The workflow could not be confirmed. Check your workspace before trying again.");
    } finally {
      setStarting(null);
    }
  };
  const onDisable = async (verticalId: VerticalId, disabled = true) => {
    if (starting !== null) return;
    setStarting(verticalId);
    setNotice(null);
    try {
      await setDisabled({ verticalId, disabled });
      setNotice(
        disabled
          ? "Suggestion turned off. Your saved documents remain in the Vault."
          : "Preference restored. Suggestions will appear when their requirements are met.",
      );
    } catch {
      setNotice("The preference could not be saved. Try again.");
    } finally {
      setStarting(null);
    }
  };
  const disabled = result?.controls.filter((item) => item.disabled) ?? [];
  return (
    <section
      aria-label="Workflow preferences"
      aria-busy={result === undefined}
      style={{ display: "grid", gap: "1rem" }}
    >
      <VerticalRecommendationCards
        recommendations={result?.recommendations}
        starting={starting}
        notice={notice}
        onStart={(id) => void onStart(id)}
        onDisable={(id) => void onDisable(id)}
      />
      <VerticalWorkloadConfirmation titles={TITLES} />
      {disabled.length > 0 && (
        <details style={card}>
          <summary style={{ cursor: "pointer", color: "var(--ink)" }}>
            Suggestions you turned off
          </summary>
          <ul style={{ paddingLeft: "1.25rem", margin: 0, display: "grid", gap: "0.75rem" }}>
            {disabled.map((item) => (
              <li key={item.id}>
                <span>{TITLES[item.id]} </span>
                <button
                  type="button"
                  disabled={starting !== null}
                  onClick={() => void onDisable(item.id, false)}
                  style={{
                    font: "inherit",
                    color: "var(--teal-600)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "0.65rem",
                  }}
                >
                  Restore suggestion
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
