"use client";

import { api } from "@pikar/backend/api";
import {
  BLUEPRINT_FIELDS,
  type BlueprintField,
  type BusinessBlueprint,
  FIELD_SPEC,
} from "@pikar/core";
import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { BlueprintDiff } from "./BlueprintDiff";
import { card, label, primaryButton } from "./page";

const REPORT_SECTIONS = [
  {
    title: "Identity",
    fields: ["name", "oneLineDescription", "stage", "tier"],
  },
  {
    title: "Business model",
    fields: ["offering", "targetCustomer", "revenueModel", "bindingConstraint"],
  },
  {
    title: "Direction",
    fields: ["primaryGoals", "knownConstraints", "entities"],
  },
] as const satisfies ReadonlyArray<{
  title: string;
  fields: readonly BlueprintField[];
}>;

const secondaryButton = (disabled: boolean): React.CSSProperties => ({
  padding: "0.6rem 1.1rem",
  borderRadius: "999px",
  border: "1px solid var(--rule)",
  background: "var(--card)",
  color: "var(--ink)",
  fontFamily: "inherit",
  fontWeight: 700,
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.5 : 1,
});

const formatConfirmedAt = (timestamp: number): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(timestamp));

export function BlueprintPanel() {
  const blueprintState = useQuery(api.blueprint.blueprintState);
  const buildDraft = useAction(api.blueprint.buildBlueprintDraft);
  const [building, setBuilding] = useState(false);
  const [buildStatus, setBuildStatus] = useState<string | null>(null);

  async function onBuild() {
    setBuilding(true);
    setBuildStatus("Reading your profile and vault documents…");
    try {
      const result = await buildDraft({});
      if (!result.ok) {
        setBuildStatus(
          result.reason === "kill_switch"
            ? "Blueprint building is paused right now. Nothing has changed; try again later."
            : "Today's model-call allowance has been used. Nothing has changed; try again tomorrow.",
        );
        return;
      }
      setBuildStatus(
        `Draft ready with ${result.additions} additions and ${result.contradictions} contradictions from ${result.sourceDocCount} source documents.`,
      );
    } catch {
      setBuildStatus(
        "I couldn't build the blueprint just now. Nothing has changed; please try again.",
      );
    } finally {
      setBuilding(false);
    }
  }

  if (blueprintState === undefined) {
    return (
      <section style={card} aria-busy="true">
        <span style={label}>Business blueprint</span>
        <p style={{ margin: 0, color: "var(--ink-soft)" }}>Loading your blueprint…</p>
      </section>
    );
  }

  const buildButton = (text: string, primary: boolean) => (
    <button
      type="button"
      disabled={building}
      onClick={() => void onBuild()}
      style={primary ? primaryButton(building) : secondaryButton(building)}
    >
      {building ? "Building…" : text}
    </button>
  );

  const liveBlueprint = blueprintState.live;

  return (
    <section style={card}>
      <div style={{ display: "grid", gap: "0.35rem" }}>
        <span style={label}>Business blueprint</span>
        <h2 style={{ margin: 0, color: "var(--ink)", fontSize: "1.2rem" }}>
          The standing context every agent reads
        </h2>
      </div>

      {blueprintState.state === "draft" ? (
        <BlueprintDiff diff={blueprintState.diff} />
      ) : blueprintState.state === "none" || liveBlueprint === null ? (
        <>
          <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
            A blueprint brings your profile and useful facts from your vault documents into one
            confirmed business picture. Building it reads both and costs one model call.
          </p>
          <div>{buildButton("Build blueprint", true)}</div>
        </>
      ) : (
        <>
          {blueprintState.state === "live_stale" && (
            <p
              style={{
                margin: 0,
                padding: "0.75rem 0.9rem",
                borderLeft: "3px solid var(--ink-soft)",
                background: "var(--paper)",
                color: "var(--ink-soft)",
                fontWeight: 600,
                fontSize: "0.9rem",
              }}
            >
              {blueprintState.unincorporatedCount}{" "}
              {blueprintState.unincorporatedCount === 1 ? "document has" : "documents have"} been
              added since this blueprint was confirmed.
            </p>
          )}

          <BlueprintReport blueprint={liveBlueprint} />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.75rem",
              flexWrap: "wrap",
              paddingTop: "0.25rem",
            }}
          >
            <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.85rem" }}>
              {blueprintState.confirmedAt === null ? (
                "Confirmed"
              ) : (
                <>
                  Confirmed{" "}
                  <time dateTime={new Date(blueprintState.confirmedAt).toISOString()}>
                    {formatConfirmedAt(blueprintState.confirmedAt)}
                  </time>
                </>
              )}
            </p>
            {buildButton("Rebuild", blueprintState.state === "live_stale")}
          </div>
        </>
      )}

      {buildStatus && (
        <p
          role="status"
          aria-live="polite"
          style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.88rem" }}
        >
          {buildStatus}
        </p>
      )}
    </section>
  );
}

function BlueprintReport({ blueprint }: { blueprint: BusinessBlueprint }) {
  const populated = new Set(
    BLUEPRINT_FIELDS.filter((blueprintField) => blueprint[blueprintField] !== null),
  );

  if (populated.size === 0) {
    return (
      <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
        This confirmed blueprint does not have any populated fields yet.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {REPORT_SECTIONS.map((section) => {
        const fields = section.fields.filter((blueprintField) => populated.has(blueprintField));
        if (fields.length === 0) return null;
        return (
          <section
            key={section.title}
            style={{
              display: "grid",
              gap: "0.65rem",
              paddingTop: "0.85rem",
              borderTop: "1px solid var(--rule)",
            }}
          >
            <h3 style={{ ...label, margin: 0 }}>{section.title}</h3>
            {fields.map((blueprintField) => {
              const entry = blueprint[blueprintField];
              if (entry === null) return null;
              return (
                <div
                  key={blueprintField}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(8rem, 0.75fr) minmax(0, 1.5fr)",
                    gap: "0.75rem",
                    alignItems: "start",
                  }}
                >
                  <span style={{ color: "var(--ink-soft)", fontSize: "0.85rem", fontWeight: 600 }}>
                    {FIELD_SPEC[blueprintField].label}
                  </span>
                  <div style={{ display: "grid", gap: "0.2rem", minWidth: 0 }}>
                    <span style={{ color: "var(--ink)", fontSize: "0.92rem" }}>
                      {entry.values.join(" · ")}
                    </span>
                    <span style={{ color: "var(--ink-soft)", fontSize: "0.78rem" }}>
                      {entry.origin === "stated"
                        ? "Your own words"
                        : `From ${entry.source ?? "a vault document"}`}
                    </span>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
