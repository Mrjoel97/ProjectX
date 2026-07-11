"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import Link from "next/link";

// REVW-01: a LIVE queue of requests awaiting review — a real list, not a
// single-request takeover (CONTEXT). Each row links to its collapsed gate.
export default function ReviewQueue() {
  const requests = useQuery(api.requests.list, { status: "awaiting_review" });

  return (
    <section>
      <h1>Review queue</h1>
      {requests === undefined ? (
        <p>Loading…</p>
      ) : requests.length === 0 ? (
        <p style={{ color: "#666" }}>Nothing awaiting review.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem" }}>
          {requests.map((r) => (
            <li key={r._id}>
              <Link
                href={`/review/${r._id}`}
                style={{
                  display: "block",
                  padding: "0.75rem 1rem",
                  border: "1px solid #e5e5e5",
                  borderRadius: "0.5rem",
                  textDecoration: "none",
                }}
              >
                <div style={{ fontWeight: 600 }}>To: {r.recipient}</div>
                <div style={{ color: "#666", fontSize: "0.9rem" }}>
                  {r.goal.length > 100 ? `${r.goal.slice(0, 100)}…` : r.goal}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
