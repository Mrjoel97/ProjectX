"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";

// BETA-04: this list is a reactive useQuery subscription — the Convex platform pushes every
// status change, so a new request appears and its status advances (submitted → routing →
// drafting → awaiting_review → … → sent) with NO refresh and NO polling.

// Color by lifecycle bucket: green = delivered, red = terminal failure/stop, amber = needs
// user action, blue = in flight.
const STATUS_COLOR: Record<string, string> = {
  sent: "#16a34a",
  rejected: "#dc2626",
  expired: "#dc2626",
  failed: "#dc2626",
  awaiting_reauth: "#d97706",
};
const IN_FLIGHT = "#2563eb";

function StatusPill({ status }: { status: string }) {
  return (
    <span
      style={{
        padding: "0.15rem 0.6rem",
        borderRadius: "999px",
        fontSize: "0.75rem",
        fontWeight: 700,
        color: "#fff",
        background: STATUS_COLOR[status] ?? IN_FLIGHT,
        whiteSpace: "nowrap",
      }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default function Requests() {
  const rows = useQuery(api.requests.list, {});

  return (
    <section style={{ maxWidth: "48rem" }}>
      <h1>Requests</h1>

      {rows === undefined && <p style={{ color: "#666" }}>Loading…</p>}

      {rows?.length === 0 && (
        <p style={{ color: "#666" }}>
          No requests yet. <a href="/submit">Submit one</a> to see it appear here live.
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.6rem" }}>
          {rows.map((r) => (
            <li
              key={r._id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1rem",
                padding: "0.8rem 1rem",
                border: "1px solid var(--border, #e5e5e5)",
                borderRadius: "0.6rem",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{r.recipient}</div>
                <div
                  style={{
                    color: "#666",
                    fontSize: "0.9rem",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.goal}
                </div>
              </div>
              <StatusPill status={r.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
