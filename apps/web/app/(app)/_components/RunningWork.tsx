"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";

const stages = {
  delivering: "Sending",
  preparing: "Preparing",
  rendering: "Creating media",
  queued: "Waiting to process",
  processing: "Processing document",
};

export function RunningWork() {
  const work = useQuery(api.approvals.runningWork, {});
  if (!work || (!work.items.length && !work.partial)) return null;
  return (
    <details
      style={{
        padding: "0.5rem 1rem",
        borderBottom: "1px solid var(--rule)",
        background: "var(--card)",
        color: "var(--ink)",
      }}
    >
      <summary style={{ cursor: "pointer", minHeight: "2.5rem", alignContent: "center" }}>
        {work.items.length ? `Work in progress · ${work.items.length}` : "Work status"}
        {work.partial ? " · limited view" : ""}
      </summary>
      <ul
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.5rem",
          listStyle: "none",
          padding: 0,
          maxHeight: "10rem",
          overflowY: "auto",
        }}
      >
        {work.items.map((item) => (
          <li key={item.id}>
            {/* Full navigation also reopens a different thread when already in the workspace. */}
            <a
              href={
                item.threadId
                  ? `/dashboard/workspace?thread=${encodeURIComponent(item.threadId)}&label=Work`
                  : "/dashboard/vault"
              }
              style={{
                display: "block",
                padding: "0.65rem",
                border: "1px solid var(--rule)",
                borderRadius: "0.5rem",
                color: "var(--ink)",
              }}
            >
              {stages[item.stage]} ·{" "}
              {new Date(item.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </a>
          </li>
        ))}
      </ul>
      {work.partial && (
        <p style={{ color: "var(--ink-soft)" }}>
          Showing a limited selection. Open Approvals or the Vault to see more.
        </p>
      )}
    </details>
  );
}
