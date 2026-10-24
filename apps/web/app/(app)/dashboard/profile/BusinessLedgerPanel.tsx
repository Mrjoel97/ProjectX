"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import { VaultDocButton } from "../workspace/cards";

const sourceLabels = {
  current: "Source available",
  changed: "Source changed — review needed",
  withdrawn: "Source removed",
  unverified: "Source not verified",
} as const;

function stamp(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0 || value > 8.64e15)
    return "Not recorded";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    value,
  );
}

/** Provenance stays beside the current value; reviewing a proposal does not verify its claims. */
export function BusinessLedgerPanel() {
  const ledger = useQuery(api.blueprint.businessLedger, {});
  return (
    <section aria-label="Business ledger" style={{ display: "grid", gap: "0.8rem", minWidth: 0 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: "1rem", color: "var(--ink)" }}>Business ledger</h3>
        <p
          style={{
            margin: "0.35rem 0 0",
            color: "var(--ink-soft)",
            fontSize: "0.9rem",
            lineHeight: 1.5,
          }}
        >
          See where each value came from. Reviewing a proposal does not verify every business claim.
        </p>
      </div>
      {ledger === undefined ? (
        <p role="status" style={{ margin: 0, color: "var(--ink-soft)" }}>
          Loading your business sources…
        </p>
      ) : ledger.fields.length === 0 ? (
        <p style={{ margin: 0, color: "var(--ink-soft)" }}>
          Review a business blueprint to see its values and sources here.
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", minWidth: 0 }}>
          {ledger.fields.map((field) => (
            <li
              key={field.field}
              style={{
                borderTop: "1px solid var(--rule)",
                padding: "0.9rem 0",
                minWidth: 0,
                overflowWrap: "anywhere",
              }}
            >
              <h4 style={{ margin: 0, fontSize: "0.95rem", color: "var(--ink)" }}>{field.label}</h4>
              {field.values.length ? (
                <ul
                  style={{
                    margin: "0.35rem 0",
                    paddingLeft: "1.2rem",
                    lineHeight: 1.6,
                    color: "var(--ink)",
                    minWidth: 0,
                  }}
                >
                  {field.values.map((value) => (
                    <li key={value}>{value}</li>
                  ))}
                </ul>
              ) : (
                <p style={{ margin: "0.35rem 0", color: "var(--ink-soft)" }}>Not recorded</p>
              )}
              <p
                style={{
                  margin: 0,
                  color: "var(--ink-soft)",
                  fontSize: "0.85rem",
                  lineHeight: 1.6,
                }}
              >
                {field.origin === "derived" ? "Agent inference" : "Document states"} ·{" "}
                {sourceLabels[field.sourceState]}
              </p>
              {field.sourceDocId &&
                (field.sourceState === "current" || field.sourceState === "changed") && (
                  <VaultDocButton
                    docId={field.sourceDocId}
                    style={{
                      minHeight: 44,
                      padding: "0.5rem 0",
                      fontWeight: 600,
                      color: "var(--teal-900)",
                    }}
                  >
                    Open source for {field.label}
                  </VaultDocButton>
                )}
              <details
                style={{
                  marginTop: "0.3rem",
                  color: "var(--ink-soft)",
                  fontSize: "0.85rem",
                  minWidth: 0,
                }}
              >
                <summary style={{ cursor: "pointer", padding: "0.4rem 0", minHeight: 44 }}>
                  Source details for {field.label}
                </summary>
                <dl
                  style={{
                    margin: 0,
                    display: "grid",
                    gap: "0.4rem",
                    minWidth: 0,
                    lineHeight: 1.5,
                  }}
                >
                  <div>
                    <dt>Document created</dt>
                    <dd style={{ margin: 0 }}>{stamp(field.sourceCreatedAt)}</dd>
                  </div>
                  <div>
                    <dt>First recorded</dt>
                    <dd style={{ margin: 0 }}>{stamp(field.firstRecordedAt)}</dd>
                  </div>
                  <div>
                    <dt>Proposal reviewed</dt>
                    <dd style={{ margin: 0 }}>{stamp(field.reviewedAt)}</dd>
                  </div>
                  <div>
                    <dt>Observation time</dt>
                    <dd style={{ margin: 0 }}>{stamp(field.originalObservedAt)}</dd>
                  </div>
                  <div>
                    <dt>Source fingerprint</dt>
                    <dd style={{ margin: 0, overflowWrap: "anywhere" }}>
                      <code>{field.sourceHash ?? "Not recorded"}</code>
                    </dd>
                  </div>
                  {field.reviewAuditId && (
                    <div>
                      <dt>Review reference</dt>
                      <dd style={{ margin: 0, overflowWrap: "anywhere" }}>
                        <code>{field.reviewAuditId}</code>
                      </dd>
                    </div>
                  )}
                </dl>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
