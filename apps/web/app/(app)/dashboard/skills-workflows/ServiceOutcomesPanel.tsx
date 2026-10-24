"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import Link from "next/link";
import { type CSSProperties, useState } from "react";

const muted: CSSProperties = { color: "var(--ink-soft)", fontSize: "0.9rem", margin: 0 };
const row: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" };
const operational: Record<string, string> = {
  claimed: "Waiting to start",
  running: "Work in progress",
  completed: "Work completed",
  failed: "Work did not finish",
  stopped: "Work stopped",
  unknown: "Outcome needs checking",
};
const metricLabels: Record<string, string> = {
  impressions: "Impressions",
  reach: "Reach",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
  clicks: "Clicks",
  views: "Views",
  engagementRate: "Engagement rate (provider value)",
};
const nextActions: Record<string, string> = {
  review_draft: "Review the draft in Marketing before scheduling it.",
  prepare_replacement: "Decide whether you want a replacement for the discarded draft.",
  review_failed_publication: "Review the failed publication before trying a replacement.",
  check_buffer_before_retry: "Check Buffer before replacing this post. Its outcome is uncertain.",
  check_buffer_status: "Check the post’s latest status in Marketing or Buffer.",
  review_publication_record: "Review the publication record before drawing conclusions.",
  refresh_report: "Refresh your engagement report in Marketing.",
  review_reporting_accounts: "Review which connected accounts are included in reporting.",
  verify_native_mapping:
    "The published post and its engagement report have not been verified as the same post.",
  review_full_report: "Check the complete report. This post may be outside the available sample.",
  report_unavailable_metrics: "The provider has not supplied measurements for this post.",
  review_results_and_propose_next_cycle:
    "Review these results before deciding what Pikar should prepare next.",
};
function at(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 8.64e15
    ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "Unavailable";
}
function value(number: number | null) {
  return number === null
    ? "Unavailable"
    : number.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

export function ServiceOutcomesPanel({ runId }: { runId: Id<"managedServiceRuns"> }) {
  const outcome = useQuery(api.serviceOutcomes.runOutcome, { runId });
  const recordUsefulness = useMutation(api.serviceOutcomes.recordUsefulness);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  if (outcome === undefined)
    return (
      <p role="status" style={muted}>
        Loading run results…
      </p>
    );
  if (outcome === null) return <p style={muted}>Results for this run are unavailable.</p>;
  const canReview = ["completed", "failed", "stopped"].includes(outcome.operational) && !busy;
  const review = (usefulness: "accepted" | "rejected") => {
    if (!canReview) return;
    setBusy(true);
    setNotice("");
    void recordUsefulness({ runId, usefulness })
      .then(() => setNotice("Your feedback is saved."))
      .catch(() =>
        setNotice("Your feedback could not be saved. Check this run’s status and try again."),
      )
      .finally(() => setBusy(false));
  };
  const movement = outcome.reporting.movement ?? [];
  const observation = outcome.reporting.observations[0];
  return (
    <section
      aria-label="Run results and evidence"
      style={{
        display: "grid",
        gap: 12,
        borderTop: "1px solid var(--rule)",
        paddingTop: 16,
        minWidth: 0,
      }}
    >
      <h4 style={{ margin: 0, fontSize: "1rem" }}>Results and evidence</h4>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)",
          gap: "8px 16px",
          margin: 0,
        }}
      >
        <dt>Work</dt>
        <dd style={{ margin: 0 }}>{operational[outcome.operational] ?? "Checking outcome"}</dd>
        <dt>Your feedback</dt>
        <dd style={{ margin: 0 }}>
          {outcome.usefulness === "accepted"
            ? "Useful to you"
            : outcome.usefulness === "rejected"
              ? "Needs improvement"
              : "Not reviewed"}
        </dd>
        <dt>Business impact</dt>
        <dd style={{ margin: 0 }}>Not established</dd>
      </dl>
      {outcome.goal && (
        <p style={muted}>
          This run is linked to a saved business goal. Completing the work does not complete that
          goal.
        </p>
      )}
      <div style={row}>
        <span>Was this work useful?</span>
        {(["accepted", "rejected"] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            disabled={!canReview}
            aria-pressed={outcome.usefulness === choice}
            onClick={() => review(choice)}
            style={{
              minHeight: 44,
              padding: "0.5rem 0.75rem",
              border: "1px solid var(--rule)",
              borderRadius: 8,
              background: "var(--paper)",
              color: "var(--ink)",
              font: "inherit",
              cursor: canReview ? "pointer" : "not-allowed",
              opacity: canReview ? 1 : 0.55,
            }}
          >
            {choice === "accepted" ? "Useful" : "Needs improvement"}
          </button>
        ))}
      </div>
      {!canReview && !busy && (
        <p style={muted}>You can leave feedback after this run has finished or stopped.</p>
      )}
      {notice && (
        <p role="status" style={muted}>
          {notice}
        </p>
      )}
      <div>
        <strong>Engagement evidence</strong>
        <p style={muted}>
          {outcome.reporting.state === "unavailable"
            ? "No engagement report is available."
            : outcome.reporting.state === "stale"
              ? "The engagement report needs refreshing. Review it in Marketing before drawing conclusions."
              : outcome.reporting.state === "insufficient_history"
                ? observation
                  ? "A report is available. More history is needed to compare results."
                  : "There is not enough report history to compare results."
                : "Compare each post’s all-time measurements. Business improvement is not established."}
        </p>
        {outcome.reporting.sourceFailure && (
          <p style={muted}>The latest report refresh failed. Previous measurements are retained.</p>
        )}
        {observation && (
          <p style={muted}>
            Report retrieved: {at(observation.retrievedAt)}. Retrieval time does not establish when
            the provider updated its measurements.
          </p>
        )}
      </div>
      {movement.length > 0 && (
        <details>
          <summary style={{ minHeight: 44, cursor: "pointer", alignContent: "center" }}>
            Review post measurements ({movement.length})
          </summary>
          <div style={{ display: "grid", gap: 16 }}>
            {movement.slice(0, 3).map((post, index) => (
              <div
                key={`${post.accountId}:${post.platform}:${post.postId}:${post.source}`}
                style={{ minWidth: 0 }}
              >
                <strong>
                  {post.platform === "instagram"
                    ? "Instagram"
                    : post.platform === "tiktok"
                      ? "TikTok"
                      : "Social"}{" "}
                  post {index + 1}
                </strong>
                <p style={muted}>
                  Retrieved report:{" "}
                  {post.freshness.retrieval === "fresh"
                    ? "Recent"
                    : post.freshness.retrieval === "stale"
                      ? "Stale"
                      : "Time unknown"}
                  . Provider measurements:{" "}
                  {post.freshness.upstream === "fresh"
                    ? "Recent"
                    : post.freshness.upstream === "stale"
                      ? "Stale"
                      : "Update time unknown"}
                  .
                </p>
                <p style={muted}>Provider update: {at(post.freshness.sourceObservedAt)}</p>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.85rem",
                    tableLayout: "fixed",
                  }}
                >
                  <thead>
                    <tr>
                      <th scope="col" style={{ textAlign: "left", width: "44%" }}>
                        Measurement
                      </th>
                      <th scope="col" style={{ textAlign: "right" }}>
                        Latest
                      </th>
                      <th scope="col" style={{ textAlign: "right" }}>
                        Change
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {post.metrics.map((metric) => (
                      <tr key={metric.metric}>
                        <th
                          scope="row"
                          style={{
                            textAlign: "left",
                            fontWeight: 400,
                            overflowWrap: "anywhere",
                            padding: "6px 8px 6px 0",
                          }}
                        >
                          {metricLabels[metric.metric] ?? "Provider measurement"}
                        </th>
                        <td
                          style={{
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {value(metric.current)}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {metric.delta === null
                            ? "Unavailable"
                            : `${metric.delta > 0 ? "+" : ""}${value(metric.delta)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {movement.length > 3 && (
              <p style={muted}>Showing 3 of {movement.length} post comparisons.</p>
            )}
          </div>
        </details>
      )}
      {outcome.social.slice(0, 3).map((social, index) => (
        <div key={social.draftRef} style={{ display: "grid", gap: 4 }}>
          <strong>Social draft {index + 1}</strong>
          <p style={muted}>
            {social.publication.status === "sent"
              ? "Buffer reports this post as sent."
              : social.publication.status === "scheduled"
                ? "Scheduled in Buffer. Delivery is not yet confirmed."
                : social.publication.status === "unknown" ||
                    social.publication.status === "submitting"
                  ? "The publication outcome needs checking before replacement."
                  : social.publication.status === "draft"
                    ? "Draft awaiting your review."
                    : "Review this draft’s publication status in Marketing."}
          </p>
          <p style={muted}>
            {social.publisherAttribution === "unverified"
              ? "Engagement has not been attributed to this Buffer publication."
              : "A native post receipt links this report to the Buffer publication."}
          </p>
          <p style={muted}>
            {nextActions[social.nextAction] ??
              "Review the available evidence before deciding the next step."}
          </p>
        </div>
      ))}
      {(outcome.socialTruncated || outcome.social.length > 3) && (
        <p style={muted}>This view includes a limited selection of linked drafts.</p>
      )}
      {outcome.social.length > 0 && (
        <p style={{ margin: 0 }}>
          <Link href="/dashboard/marketing">Review drafts and reports in Marketing</Link>
        </p>
      )}
      <p style={muted}>
        Missing measurements are unavailable, not zero. Reports do not prove business improvement or
        approve the next run.
      </p>
    </section>
  );
}

/** An optional saved-goal link; this never changes goal status or starts a run. */
export function ServiceGoalLink({
  serviceId,
  revision,
  controlRevision,
  goalId,
  disabled = false,
}: {
  serviceId: Id<"managedServices">;
  revision: number;
  controlRevision: number;
  goalId: Id<"goals"> | null;
  disabled?: boolean;
}) {
  const goals = useQuery(api.goals.listGoals, {});
  const bindGoal = useMutation(api.serviceOutcomes.bindGoal);
  const [selected, setSelected] = useState<string>(goalId ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const choices = goals?.filter((goal) => goal.status === "active" || goal.id === goalId) ?? [];
  const chosen = choices.find((goal) => goal.id === selected);
  const canSave = !disabled && !busy && chosen !== undefined && chosen.id !== goalId;
  return (
    <section aria-label="Service business goal" style={{ display: "grid", gap: 8 }}>
      <label style={{ display: "grid", gap: 8 }}>
        Business goal{" "}
        <span style={muted}>
          Optional. Link an existing goal so you can review the work against it.
        </span>
        <select
          aria-label="Business goal"
          value={selected}
          disabled={disabled || busy || goals === undefined || choices.length === 0}
          onChange={(event) => {
            setSelected(event.target.value);
            setNotice("");
          }}
          style={{
            minHeight: 44,
            maxWidth: "100%",
            width: "100%",
            padding: "0.5rem",
            border: "1px solid var(--rule)",
            borderRadius: 8,
            background: "var(--paper)",
            color: "var(--ink)",
            font: "inherit",
          }}
        >
          <option value="">
            {goals === undefined ? "Loading your goals…" : "Choose a saved goal"}
          </option>
          {choices.map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goal.text}
              {goal.status === "achieved"
                ? " (Achieved)"
                : goal.status === "dropped"
                  ? " (Set aside)"
                  : ""}
            </option>
          ))}
        </select>
      </label>
      {disabled && (
        <p style={muted}>Finish or stop the current work before changing its business goal.</p>
      )}
      {goals !== undefined && choices.length === 0 && (
        <p style={muted}>No active business goals are available to link yet.</p>
      )}
      <div style={row}>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => {
            if (!canSave || !chosen) return;
            setBusy(true);
            setNotice("");
            void bindGoal({
              serviceId,
              goalId: chosen.id as Id<"goals">,
              expectedRevision: revision,
              expectedControlRevision: controlRevision,
            })
              .then(() =>
                setNotice("Business goal linked. Work will start only when you choose to run it."),
              )
              .catch(() =>
                setNotice(
                  "Could not link this goal. Refresh the service to check its latest setup, then try again.",
                ),
              )
              .finally(() => setBusy(false));
          }}
          style={{
            minHeight: 44,
            padding: "0.5rem 0.75rem",
            border: "1px solid var(--rule)",
            borderRadius: 8,
            background: "var(--paper)",
            color: "var(--ink)",
            font: "inherit",
            opacity: canSave ? 1 : 0.55,
            cursor: canSave ? "pointer" : "not-allowed",
          }}
        >
          Link business goal
        </button>
        {goalId !== null && selected === goalId && <span style={muted}>Goal linked</span>}
      </div>
      {notice && (
        <p role="status" style={muted}>
          {notice}
        </p>
      )}
      <p style={muted}>Linking a goal does not mark it achieved or approve any work.</p>
    </section>
  );
}
