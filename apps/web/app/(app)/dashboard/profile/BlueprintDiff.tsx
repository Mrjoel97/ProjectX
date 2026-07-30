"use client";

import { api } from "@pikar/backend/api";
import { type BlueprintDiffRow, type BlueprintField, FIELD_SPEC } from "@pikar/core";
import { useMutation } from "convex/react";
import { useState } from "react";
import { label, primaryButton } from "./page";

type AdditionRow = Extract<BlueprintDiffRow, { kind: "addition" }>;
type ContradictionRow = Extract<BlueprintDiffRow, { kind: "contradiction" }>;

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

/**
 * D5's review split is semantic, not decorative: additions cannot remove typed content, while a
 * contradiction can replace a typed value in the Blueprint and therefore requires its own tick.
 */
export function BlueprintDiff({ diff }: { diff: readonly BlueprintDiffRow[] }) {
  const confirmBlueprint = useMutation(api.blueprint.confirmBlueprint);
  const discardDraft = useMutation(api.blueprint.discardDraft);
  const additions = diff.filter((row): row is AdditionRow => row.kind === "addition");
  const contradictions = diff.filter(
    (row): row is ContradictionRow => row.kind === "contradiction",
  );
  const [acceptAdditions, setAcceptAdditions] = useState(true);
  const [acceptedContradictions, setAcceptedContradictions] = useState<Set<BlueprintField>>(
    new Set(),
  );
  const [pending, setPending] = useState<"confirm" | "discard" | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const busy = pending !== null;
  const additionsDeclined = additions.length > 0 && !acceptAdditions;

  function toggleContradiction(field: BlueprintField) {
    setAcceptedContradictions((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  async function onConfirm() {
    setPending("confirm");
    setStatus("Confirming your blueprint…");
    try {
      const result = await confirmBlueprint({
        acceptedContradictions: [...acceptedContradictions],
      });
      setStatus(
        result.ok
          ? "Blueprint confirmed. Every agent now has this standing context."
          : "This draft is no longer available. Refresh or rebuild before confirming.",
      );
    } catch {
      setStatus(
        "I couldn't confirm the blueprint just now. Nothing has changed; please try again.",
      );
    } finally {
      setPending(null);
    }
  }

  async function onDiscard() {
    setPending("discard");
    setStatus("Discarding this draft…");
    try {
      const result = await discardDraft({});
      setStatus(
        result.ok
          ? "Draft discarded. Your previously confirmed blueprint, if any, is unchanged."
          : "This draft is no longer available.",
      );
    } catch {
      setStatus("I couldn't discard the draft just now. Nothing has changed; please try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section style={{ display: "grid", gap: "1.25rem" }}>
      <div style={{ display: "grid", gap: "0.35rem" }}>
        <span style={label}>Draft review</span>
        <h3 style={{ margin: 0, color: "var(--ink)", fontSize: "1.05rem" }}>
          Review what the documents add
        </h3>
      </div>

      <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
        Confirming changes the Blueprint that agents read. It does not rewrite the profile text
        above; edit that card directly when your own words should change.
      </p>

      {additions.length > 0 && (
        <section
          style={{
            display: "grid",
            gap: "0.75rem",
            paddingTop: "0.85rem",
            borderTop: "1px solid var(--rule)",
          }}
        >
          <label
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "0.65rem",
              alignItems: "start",
              color: "var(--ink)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              name="accept-additions"
              checked={acceptAdditions}
              onChange={(event) => setAcceptAdditions(event.target.checked)}
            />
            <span>
              <strong>Accept all additions</strong>
              <span
                style={{
                  display: "block",
                  color: "var(--ink-soft)",
                  fontSize: "0.82rem",
                  fontWeight: 400,
                }}
              >
                These fill blank fields and cannot remove anything you typed. Leave this on to
                confirm them in one click.
              </span>
            </span>
          </label>

          <div style={{ display: "grid", gap: "0.75rem" }}>
            {additions.map((row) => (
              <article
                key={row.field}
                style={{
                  display: "grid",
                  gap: "0.35rem",
                  padding: "0.8rem 0",
                  borderTop: "1px solid var(--rule)",
                }}
              >
                <span style={label}>Addition</span>
                <strong style={{ color: "var(--ink)", fontSize: "0.92rem" }}>
                  {FIELD_SPEC[row.field].label}
                </strong>
                <span style={{ color: "var(--ink)", fontSize: "0.9rem" }}>
                  {row.derived.values.join(" · ")}
                </span>
                <span style={{ color: "var(--ink-soft)", fontSize: "0.78rem" }}>
                  From {row.derived.source ?? "a vault document"}
                </span>
              </article>
            ))}
          </div>
        </section>
      )}

      {contradictions.length > 0 && (
        <fieldset
          style={{
            display: "grid",
            gap: "0.85rem",
            margin: 0,
            padding: "0.85rem 0 0",
            border: "none",
            borderTop: "1px solid var(--rule)",
          }}
        >
          <legend style={{ ...label, padding: "0 0.4rem 0 0" }}>
            Contradictions — choose individually
          </legend>
          <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.85rem" }}>
            Each box starts off. Tick only a document-derived value you deliberately want the
            Blueprint to use instead of your typed value.
          </p>

          {contradictions.map((row) => (
            <label
              key={row.field}
              style={{
                display: "grid",
                gridTemplateColumns: "auto minmax(0, 1fr)",
                gap: "0.7rem",
                alignItems: "start",
                padding: "0.85rem 0",
                borderTop: "1px solid var(--rule)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                name={`contradiction-${row.field}`}
                data-blueprint-control="contradiction"
                checked={acceptedContradictions.has(row.field)}
                onChange={() => toggleContradiction(row.field)}
              />
              <span style={{ display: "grid", gap: "0.55rem", minWidth: 0 }}>
                <span style={label}>Contradiction</span>
                <strong style={{ color: "var(--ink)", fontSize: "0.92rem" }}>
                  {FIELD_SPEC[row.field].label}
                </strong>
                <span
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: "0.8rem",
                  }}
                >
                  <span style={{ display: "grid", gap: "0.2rem", minWidth: 0 }}>
                    <span style={{ ...label, fontSize: "0.66rem" }}>Your typed value</span>
                    <span style={{ color: "var(--ink)", fontSize: "0.88rem" }}>
                      {row.stated.values.join(" · ")}
                    </span>
                  </span>
                  <span style={{ display: "grid", gap: "0.2rem", minWidth: 0 }}>
                    <span style={{ ...label, fontSize: "0.66rem" }}>Document-derived value</span>
                    <span style={{ color: "var(--ink)", fontSize: "0.88rem" }}>
                      {row.derived.values.join(" · ")}
                    </span>
                    <span style={{ color: "var(--ink-soft)", fontSize: "0.75rem" }}>
                      From {row.derived.source ?? "a vault document"}
                    </span>
                  </span>
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {diff.length === 0 && (
        <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
          This rebuild found no changes. You can confirm it as-is or discard the draft.
        </p>
      )}

      {additionsDeclined && (
        <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.82rem", fontWeight: 600 }}>
          Turn “Accept all additions” back on to confirm, or discard this draft.
        </p>
      )}

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          disabled={busy || additionsDeclined}
          onClick={() => void onConfirm()}
          style={primaryButton(busy || additionsDeclined)}
        >
          {pending === "confirm" ? "Confirming…" : "Accept and confirm"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onDiscard()}
          style={secondaryButton(busy)}
        >
          {pending === "discard" ? "Discarding…" : "Discard draft"}
        </button>
      </div>

      {status && (
        <p
          role="status"
          aria-live="polite"
          style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.85rem" }}
        >
          {status}
        </p>
      )}
    </section>
  );
}
