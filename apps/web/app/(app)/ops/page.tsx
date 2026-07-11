"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

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
      <h1>Ops — dead letters</h1>
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
