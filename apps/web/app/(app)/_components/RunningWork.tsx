"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import { useState } from "react";

const stages = {
  delivering: "Sending",
  preparing: "Preparing",
  rendering: "Creating media",
  queued: "Waiting to process",
  processing: "Processing document",
};

export function RunningWork() {
  const work = useQuery(api.approvals.runningWork, {});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hiddenPartial, setHiddenPartial] = useState(false);
  if (!work || (!work.items.length && !work.partial)) return null;
  // The shell survives navigation. Hide this selection until a new job arrives; changing a
  // stage must not undo the user's choice. No backend cancellation or completion is implied.
  if (work.items.every((item) => hidden.has(item.id)) && (work.items.length > 0 || hiddenPartial))
    return null;
  return (
    <div
      style={{ display: "flex", background: "var(--card)", borderBottom: "1px solid var(--rule)" }}
    >
      <details
        style={{
          flex: 1,
          minWidth: 0,
          padding: "0.5rem 1rem",
          background: "var(--card)",
          color: "var(--ink)",
        }}
      >
        <summary style={{ cursor: "pointer", minHeight: "2.5rem", alignContent: "center" }}>
          {work.items.length ? `Work in progress · ${work.items.length}` : "Work status"}
          {work.partial ? " · limited view" : ""}
        </summary>
        <p style={{ margin: "0 0 0.5rem", color: "var(--ink-soft)", fontSize: "0.8rem" }}>
          Closing this notice hides it while you browse. Jobs continue running.
        </p>
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
      <button
        type="button"
        className="icon-btn"
        aria-label="Hide work status"
        title="Hide this notice; jobs continue running"
        style={{ minWidth: 44, minHeight: 44, alignSelf: "flex-start", margin: "0.5rem" }}
        onClick={() => {
          setHidden(new Set([...hidden, ...work.items.map((item) => item.id)]));
          setHiddenPartial(work.partial);
        }}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
