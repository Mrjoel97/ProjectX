"use client";

import { api } from "@pikar/backend/api";
import {
  type BlueprintSegment,
  type BusinessBlueprint,
  countdown,
  cycleTimeDays,
  FIELD_SPEC,
  type Goal,
  type SegmentPulse,
  SPECIALISTS,
} from "@pikar/core";
import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSendCockpitMessage } from "../workspace/useSendCockpitMessage";
import { joinPhrases, SEGMENT_COPY } from "./segmentCopy";
import { label } from "./styles";

const soft: React.CSSProperties = { margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" };

// Convex id brand derived from the mutation arg (no dataModel import — repo convention,
// `PreFlight.tsx:27`).
type GoalId = FunctionArgs<typeof api.goals.setGoalStatus>["id"];

const goalButton = (disabled: boolean): React.CSSProperties => ({
  fontSize: "0.72rem",
  fontWeight: 700,
  color: "var(--ink)",
  background: "var(--card)",
  border: "1px solid var(--rule)",
  padding: "0.3rem 0.65rem",
  borderRadius: "999px",
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.5 : 1,
  whiteSpace: "nowrap",
});

const goalInput: React.CSSProperties = {
  font: "inherit",
  fontSize: "0.85rem",
  padding: "0.4rem 0.6rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--rule)",
  background: "var(--card)",
  color: "var(--ink)",
};

/** One titled region of the anatomy. Every segment renders the same four, in the same order —
 *  the anatomy is a fixed shape populated by what's real, never a per-segment layout (spec D4). */
function Band({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: "0.45rem" }}>
      <h4
        style={{
          margin: 0,
          fontSize: "0.66rem",
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--ink-soft)",
        }}
      >
        {title}
      </h4>
      {children}
    </div>
  );
}

/** User-facing names for the capability grant's tool ids. Only user-meaningful tools appear;
 *  an id with no entry here (e.g. `declareUnsupported`, an internal refusal channel) renders
 *  nothing rather than leaking an internal name. */
const TOOL_LABELS: Record<string, string> = {
  searchVault: "your vault documents",
  webResearch: "live web research",
  readPage: "reading the pages it cites",
};

/** "3 minutes" / "40 seconds" — durations are typical-run scale, so two units suffice. */
const fmtDuration = (ms: number): string =>
  ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.max(1, Math.round(ms / 1000))} sec`;

const fmtWhen = (at: number): string =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(at));

function ToolRow({ name, state, detail }: { name: string; state: string; detail?: string }) {
  // Name and state share one non-wrapping line; the detail sits below at full width. A single
  // wrapping flex row pushed the state label under a wide detail (seen live on the Leads social
  // row), where it read as a stray heading rather than the row's status.
  return (
    <div style={{ display: "grid", gap: "0.1rem" }}>
      <span
        style={{
          display: "flex",
          gap: "0.75rem",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: "0.88rem", color: "var(--ink)", fontWeight: 600 }}>{name}</span>
        <span
          style={{
            fontSize: "0.68rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--ink-soft)",
            whiteSpace: "nowrap",
          }}
        >
          {state}
        </span>
      </span>
      {detail !== undefined && (
        <span style={{ fontSize: "0.78rem", color: "var(--ink-soft)" }}>{detail}</span>
      )}
    </div>
  );
}

function ToolsBand({ segment }: { segment: BlueprintSegment }) {
  // `undefined` = still loading. "Checking…" — never "Not connected" — while undefined: the
  // false-negative would invite reconnecting an already-connected account (ConnectionsPanel's
  // flash-of-wrong-state discipline).
  const gmail = useQuery(api.gmailAuth.gmailStatus);

  if (segment.specialist === null) {
    return <ToolRow name="Your profile & vault documents" state="Built in" />;
  }

  const grant = SPECIALISTS[segment.specialist];
  return (
    <div style={{ display: "grid", gap: "0.4rem" }}>
      {grant.tools.map((t) => {
        const name = TOOL_LABELS[t];
        return name === undefined ? null : <ToolRow key={t} name={name} state="Built in" />;
      })}
      <ToolRow
        name="Google — Gmail, Calendar & Drive"
        state={gmail === undefined ? "Checking…" : gmail.connected ? "Connected" : "Not connected"}
        detail="How approved work leaves the building."
      />
    </div>
  );
}

function ProcessBand({ segment, pulse }: { segment: BlueprintSegment; pulse?: SegmentPulse }) {
  if (segment.specialist === null) {
    return (
      <p style={soft}>
        No agent owns this section — it's yours. Facts here come from your profile and your
        documents.
      </p>
    );
  }
  const grant = SPECIALISTS[segment.specialist];
  const tools = grant.tools.map((t) => TOOL_LABELS[t]).filter((t): t is string => t !== undefined);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.9rem",
        flexWrap: "wrap",
      }}
    >
      <span style={{ minWidth: 0, flex: 1 }}>
        <strong style={{ display: "block", fontSize: "0.9rem", color: "var(--ink)" }}>
          {segment.specialist}
        </strong>
        <span style={{ ...soft, fontSize: "0.83rem" }}>
          {tools.length > 0
            ? `Works from ${joinPhrases(tools)}; anything it sends stops at your approval.`
            : "Anything it sends stops at your approval."}
        </span>
        {pulse !== undefined && (pulse.inFlight > 0 || pulse.lastActivityAt !== null) && (
          <span style={{ ...soft, fontSize: "0.78rem", display: "block" }}>
            {pulse.inFlight > 0
              ? "Running right now."
              : `Last ran ${fmtWhen(pulse.lastActivityAt as number)}.`}
          </span>
        )}
      </span>
      <AskSpecialist segment={segment} />
    </div>
  );
}

/** The muted line under a goal's text: what it's waiting on, or what it cost. Achieved and dropped
 *  goals never show a countdown against their (now moot) target date — the status word replaces
 *  it rather than sitting beside a stale "3d over". */
function goalMeta(goal: Goal): string {
  if (goal.status === "achieved") {
    const days = cycleTimeDays(goal);
    return days === null ? "Achieved" : `Achieved in ${days} day${days === 1 ? "" : "s"}`;
  }
  if (goal.status === "dropped") return "Dropped";
  return goal.targetDate === undefined ? "no deadline" : countdown(goal.targetDate, Date.now());
}

/**
 * One goal, with its own busy/failure state — mirrors `AskSpecialist`'s pattern so a failed
 * Achieved/Drop leaves the row exactly as it was (no optimistic flip, spec §7) rather than
 * flashing a status the mutation never actually committed.
 */
function GoalRow({ goal }: { goal: Goal }) {
  const setGoalStatus = useMutation(api.goals.setGoalStatus);
  const [busy, setBusy] = useState<"achieved" | "dropped" | null>(null);
  const [failed, setFailed] = useState(false);

  const act = async (status: "achieved" | "dropped") => {
    if (busy !== null) return;
    setBusy(status);
    setFailed(false);
    try {
      await setGoalStatus({ id: goal.id as GoalId, status });
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gap: "0.2rem",
        // One level only (enforced at write time) — a `parentId` always means "one step under".
        paddingLeft: goal.parentId === undefined ? 0 : "1.25rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: "block", fontSize: "0.88rem", color: "var(--ink)" }}>
            {goal.text}
          </span>
          <span style={{ ...soft, fontSize: "0.76rem" }}>{goalMeta(goal)}</span>
        </span>
        {goal.status === "active" && (
          <span style={{ display: "flex", gap: "0.4rem", flex: "none" }}>
            <button
              type="button"
              onClick={() => void act("achieved")}
              disabled={busy !== null}
              style={goalButton(busy !== null)}
            >
              {busy === "achieved" ? "Saving…" : "Achieved"}
            </button>
            <button
              type="button"
              onClick={() => void act("dropped")}
              disabled={busy !== null}
              style={goalButton(busy !== null)}
            >
              {busy === "dropped" ? "Saving…" : "Drop"}
            </button>
          </span>
        )}
      </div>
      {failed && (
        <span role="alert" style={{ fontSize: "0.72rem", color: "var(--ink-soft)" }}>
          Couldn't save that. Try again.
        </span>
      )}
    </div>
  );
}

/** One text input, one optional date, one button — reuses `AskSpecialist`'s busy/failure pattern.
 *  Inputs clear on success and stay filled on failure, so a failed submit never costs the typing. */
function AddGoalForm({ segmentId }: { segmentId: string }) {
  const addGoal = useMutation(api.goals.addGoal);
  const [text, setText] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async () => {
    const trimmed = text.trim();
    if (busy || trimmed.length === 0) return;
    setBusy(true);
    setFailed(false);
    try {
      await addGoal({
        segmentId,
        text: trimmed,
        // UTC midnight, matching the spine's UTC `isoDay` rendering (`goals.ts`) — a
        // local-midnight parse would shift the displayed due date by a day for anyone west of UTC.
        targetDate: targetDate === "" ? undefined : Date.parse(`${targetDate}T00:00:00Z`),
      });
      setText("");
      setTargetDate("");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: "0.35rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input
          type="text"
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          placeholder="Set a goal…"
          disabled={busy}
          style={{ ...goalInput, flex: "1 1 12rem" }}
        />
        <input
          type="date"
          aria-label="Target date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          disabled={busy}
          style={goalInput}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || text.trim().length === 0}
          style={goalButton(busy || text.trim().length === 0)}
        >
          {busy ? "Adding…" : "Add goal"}
        </button>
      </div>
      {failed && (
        <span role="alert" style={{ fontSize: "0.72rem", color: "var(--ink-soft)" }}>
          Couldn't save that. Try again.
        </span>
      )}
    </div>
  );
}

/** Reorders `goals` so each child renders immediately after its own parent — `listGoals` groups
 *  by status then creation time, which never places a child next to its parent, so the indented
 *  row (`GoalRow`'s `padding-left`) could land under an unrelated goal. Walks parentless goals in
 *  their existing order, appending each one's children (also in existing order) right after it;
 *  orphans — a child whose parent isn't in this segment's list — append at the end so nothing
 *  disappears. No new sort key: only regroups, never reorders within a group. */
function withChildrenGrouped(goals: readonly Goal[]): Goal[] {
  const ids = new Set(goals.map((g) => g.id));
  const childrenOf = new Map<string, Goal[]>();
  const orphans: Goal[] = [];
  for (const g of goals) {
    if (g.parentId === undefined) continue;
    if (!ids.has(g.parentId)) {
      orphans.push(g);
      continue;
    }
    const siblings = childrenOf.get(g.parentId) ?? [];
    siblings.push(g);
    childrenOf.set(g.parentId, siblings);
  }
  const ordered: Goal[] = [];
  for (const g of goals) {
    if (g.parentId !== undefined) continue; // placed after its parent below, or as an orphan
    ordered.push(g, ...(childrenOf.get(g.id) ?? []));
  }
  return [...ordered, ...orphans];
}

function DirectionBand({ segment, goals }: { segment: BlueprintSegment; goals?: readonly Goal[] }) {
  // `undefined` = still loading. "Checking…" — never a false "no goals" — while undefined (the
  // Tools/Outcomes precedent above).
  if (goals === undefined) {
    return <p style={{ ...soft, fontSize: "0.83rem" }}>Checking…</p>;
  }
  return (
    <div style={{ display: "grid", gap: "0.7rem" }}>
      {goals.length === 0 ? (
        <p style={{ ...soft, fontSize: "0.83rem" }}>No goals set for this section yet.</p>
      ) : (
        <div style={{ display: "grid", gap: "0.6rem" }}>
          {withChildrenGrouped(goals).map((g) => (
            <GoalRow key={g.id} goal={g} />
          ))}
        </div>
      )}
      <AddGoalForm segmentId={segment.id} />
    </div>
  );
}

export function SegmentAnatomy({
  segment,
  blueprint,
  pulse,
  goals,
}: {
  segment: BlueprintSegment;
  blueprint: BusinessBlueprint;
  pulse?: SegmentPulse;
  /** undefined while `listGoals` is loading — distinct from an empty (loaded) list. */
  goals?: readonly Goal[];
}) {
  const populated = segment.fields.filter((f) => blueprint[f] !== null);

  return (
    <section
      id={`segment-detail-${segment.id}`}
      style={{
        display: "grid",
        gap: "0.9rem",
        paddingTop: "0.85rem",
        borderTop: "1px solid var(--rule)",
      }}
    >
      <h3 style={{ ...label, margin: 0 }}>{segment.label}</h3>

      <Band title="Knowledge">
        {segment.fields.length === 0 ? (
          <p style={soft}>
            Not tracked yet. This part of the business isn't wired into the blueprint, so rebuilding
            won't change what's shown here.
          </p>
        ) : (
          populated.length === 0 && (
            <p style={soft}>
              Nothing here yet. Add documents to your vault and rebuild, and anything they say about
              this part of the business will land here.
            </p>
          )
        )}
        {populated.map((blueprintField) => {
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
      </Band>

      <Band title="Process">
        <ProcessBand segment={segment} pulse={pulse} />
      </Band>

      <Band title="Tools">
        <ToolsBand segment={segment} />
      </Band>

      <Band title="Outcomes">
        {segment.specialist === null ? (
          <p style={{ ...soft, fontSize: "0.83rem" }}>
            Nothing runs here on its own — this section moves when you update your profile or your
            documents.
          </p>
        ) : pulse === undefined ? (
          <p style={{ ...soft, fontSize: "0.83rem" }}>Checking…</p>
        ) : pulse.runs30d === 0 ? (
          <p style={{ ...soft, fontSize: "0.83rem" }}>
            No completed {segment.specialist} runs in the last 30 days.
          </p>
        ) : (
          <p style={{ ...soft, fontSize: "0.83rem" }}>
            {pulse.runs30d} run{pulse.runs30d === 1 ? "" : "s"} in the last 30 days
            {pulse.lastActivityAt !== null ? ` · last ${fmtWhen(pulse.lastActivityAt)}` : ""}
            {pulse.medianRunMs !== null ? ` · typical run ${fmtDuration(pulse.medianRunMs)}` : ""}.
          </p>
        )}
      </Band>

      <Band title="Direction">
        <DirectionBand segment={segment} goals={goals} />
      </Band>
    </section>
  );
}

/**
 * The segment → specialist handoff. Opens a cockpit thread seeded with the user's own question and
 * routes there — the same two-step `AbnormalBriefBanner` uses for its plan handoff, so this adds no
 * new concept. On failure it stays put and says so rather than navigating to nothing.
 */
export function AskSpecialist({ segment }: { segment: BlueprintSegment }) {
  const sendCockpitMessage = useSendCockpitMessage(); // trusted clock on every turn (§2-D)
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const ask = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { threadId } = await sendCockpitMessage({
        text:
          SEGMENT_COPY[segment.id]?.seed ?? `Help me work out my ${segment.label.toLowerCase()}.`,
      });
      router.push(`/dashboard/workspace?thread=${encodeURIComponent(threadId)}`);
    } catch {
      setBusy(false);
      setFailed(true);
    }
  };

  return (
    <span style={{ flex: "none", display: "grid", gap: "0.2rem", justifyItems: "end" }}>
      <button
        type="button"
        onClick={() => void ask()}
        disabled={busy}
        style={{
          fontSize: "0.76rem",
          fontWeight: 700,
          color: "#fff",
          background: "var(--teal-600)",
          border: "none",
          padding: "0.42rem 0.85rem",
          borderRadius: "999px",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {busy ? "Opening…" : `Ask ${segment.specialist} →`}
      </button>
      {failed && (
        <span role="alert" style={{ fontSize: "0.72rem", color: "var(--ink-soft)" }}>
          Couldn't open that. Try again.
        </span>
      )}
    </span>
  );
}
