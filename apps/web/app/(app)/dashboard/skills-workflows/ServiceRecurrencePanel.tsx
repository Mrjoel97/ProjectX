"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { type CSSProperties, useState } from "react";

type Service = NonNullable<FunctionReturnType<typeof api.managedServices.status>>;
const field: CSSProperties = { display: "grid", gap: 6, minWidth: 0 };
const control: CSSProperties = {
  minHeight: 44,
  border: "1px solid var(--rule)",
  borderRadius: 8,
  padding: "0.6rem 0.8rem",
  color: "var(--ink)",
  background: "var(--paper)",
  font: "inherit",
};
const explanations: Record<string, string> = {
  authorization_required:
    "A connection needs attention. Reconnect it, review your service setup, then approve a new schedule.",
  paused:
    "Automatic work is paused. Resume your service, then review and approve the schedule again.",
  approval_stale:
    "Your service setup changed. Review the current accounts, activities and spending limit before approving a new schedule.",
  qualification_required: "Automatic work is not available for this service yet.",
  expired: "Your schedule approval expired. Review and approve a new schedule to continue.",
  budget_required:
    "The spending allowance could not cover this run. Review your budget before approving a new schedule.",
  reconciliation_required:
    "A previous run needs checking. Resolve its outcome before approving a new schedule.",
};
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function ServiceRecurrencePanel({
  service,
  disabled = false,
}: {
  service: Service;
  disabled?: boolean;
}) {
  const status = useQuery(api.managedServiceRecurrence.status, { serviceId: service.serviceId });
  const configure = useMutation(api.managedServiceRecurrence.configure);
  const suspend = useMutation(api.managedServiceRecurrence.suspend);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const approval = status?.approval;
  const ready =
    status?.qualified && service.readiness.ready && service.controlState === "active" && !disabled;
  return (
    <section
      aria-label="Automatic social work"
      style={{ borderTop: "1px solid var(--rule)", paddingTop: 20, display: "grid", gap: 12 }}
    >
      <h4 style={{ margin: 0 }}>Let Pikar keep this moving</h4>
      <p style={{ margin: 0 }}>
        Choose when Pikar prepares work and reviews supported insights. You still approve every post
        before it is scheduled in Buffer.
      </p>
      {status === undefined ? (
        <p role="status">Checking automatic work…</p>
      ) : (
        <>
          {!status.qualified && (
            <p>
              Automatic work is not available for this service yet. You can start a single run
              above.
            </p>
          )}
          {approval?.enabled ? (
            <div>
              <strong>Automatic work is on</strong>
              <p>
                {approval.schedule.cadence === "weekly"
                  ? `Every ${weekdays[approval.schedule.weekday ?? 0]}`
                  : "Every day"}{" "}
                at {String(approval.schedule.hour).padStart(2, "0")}:
                {String(approval.schedule.minute).padStart(2, "0")} ·{" "}
                {approval.schedule.timeZone.replaceAll("_", " ")}
              </p>
              <p>
                {approval.nextDueAtMs
                  ? `Next run: ${new Date(approval.nextDueAtMs).toLocaleString()}.`
                  : "No more runs fall within this approval."}{" "}
                Approval ends {new Date(approval.expiresAtMs).toLocaleString()}.
              </p>
            </div>
          ) : (
            <p>
              {approval?.suspensionReason
                ? (explanations[approval.suspensionReason] ??
                  "Automatic work needs a fresh review before it can continue.")
                : "Automatic work is off until you approve a schedule."}
            </p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              style={control}
              disabled={!ready || busy}
              onClick={() => {
                setEditing(true);
                setNotice("");
              }}
            >
              {approval ? "Review schedule" : "Set a schedule"}
            </button>
            {approval?.enabled && (
              <button
                type="button"
                style={control}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setNotice("");
                  try {
                    await suspend({
                      serviceId: service.serviceId,
                      expectedRevision: service.revision,
                      expectedControlRevision: service.controlRevision,
                    });
                    setEditing(false);
                    setNotice(
                      "Automatic work paused. A run already in progress may finish its current step.",
                    );
                  } catch {
                    setNotice("Could not pause the schedule. Refresh to check its current state.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Pause automatic work
              </button>
            )}
          </div>
          {editing && (
            <ScheduleReview
              key={`${service.revision}:${service.controlRevision}:${approval?.revision ?? 0}`}
              service={service}
              previous={approval?.schedule}
              busy={busy || !ready}
              onCancel={() => setEditing(false)}
              onSave={async (schedule, days) => {
                setBusy(true);
                setNotice("");
                try {
                  await configure({
                    serviceId: service.serviceId,
                    expectedRevision: service.revision,
                    expectedControlRevision: service.controlRevision,
                    expectedApprovalRevision: approval?.revision ?? 0,
                    schedule,
                    expiresAtMs: Date.now() + days * 86400000,
                  });
                  setEditing(false);
                  setNotice(
                    "Schedule approved. Pikar can prepare work within these limits; publishing still needs your approval.",
                  );
                } catch {
                  setNotice(
                    "The schedule was not approved. Review the latest service setup, connections and time, then try again. Your schedule draft is kept.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

type Schedule = {
  cadence: "daily" | "weekly";
  weekday: number | null;
  hour: number;
  minute: number;
  timeZone: string;
};
function ScheduleReview({
  service,
  previous,
  busy,
  onCancel,
  onSave,
}: {
  service: Service;
  previous?: Schedule;
  busy: boolean;
  onCancel: () => void;
  onSave: (schedule: Schedule, days: number) => Promise<void>;
}) {
  const [cadence, setCadence] = useState<Schedule["cadence"]>(previous?.cadence ?? "daily");
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const zones = [
    ...new Set([
      previous?.timeZone ?? localZone,
      localZone,
      "UTC",
      ...Intl.supportedValuesOf("timeZone"),
    ]),
  ];
  return (
    <form
      aria-label="Review automatic work schedule"
      style={{ display: "grid", gap: 14 }}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const data = new FormData(event.currentTarget);
        const [hour, minute] = String(data.get("time")).split(":").map(Number);
        if (hour === undefined || minute === undefined) return;
        void onSave(
          {
            cadence,
            weekday: cadence === "weekly" ? Number(data.get("weekday")) : null,
            hour,
            minute,
            timeZone: String(data.get("timeZone")),
          },
          Number(data.get("days")),
        );
      }}
    >
      <label style={field}>
        How often
        <select
          style={control}
          value={cadence}
          onChange={(event) => setCadence(event.target.value as Schedule["cadence"])}
        >
          <option value="daily">Every day</option>
          <option value="weekly">Every week</option>
        </select>
      </label>
      {cadence === "weekly" && (
        <label style={field}>
          Day
          <select style={control} name="weekday" defaultValue={previous?.weekday ?? 1}>
            {weekdays.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
        </label>
      )}
      <label style={field}>
        Time
        <input
          style={control}
          type="time"
          name="time"
          defaultValue={`${String(previous?.hour ?? 9).padStart(2, "0")}:${String(previous?.minute ?? 0).padStart(2, "0")}`}
          required
        />
      </label>
      <label style={field}>
        Timezone
        <select
          style={{ ...control, width: "100%", maxWidth: "100%" }}
          name="timeZone"
          defaultValue={previous?.timeZone ?? localZone}
        >
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label style={field}>
        Approve this schedule for
        <select style={control} name="days" defaultValue="7">
          <option value="7">7 days</option>
          <option value="14">14 days</option>
          <option value="30">30 days</option>
        </select>
      </label>
      <p style={{ margin: 0 }}>
        Up to ${(service.budgetLimitCents / 100).toFixed(2)} per run, within your existing daily
        spending allowance. Missed runs are skipped, and overlapping work is not started. A changed
        connection or setup requires a fresh approval.
      </p>
      <label style={{ display: "flex", alignItems: "start", gap: 8 }}>
        <input type="checkbox" name="consent" required style={{ marginTop: 4 }} />
        <span>
          I allow Pikar to prepare drafts and read reports on this schedule within these limits.
          Publishing always needs my approval.
        </span>
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button style={control} disabled={busy} type="submit">
          {busy ? "Saving…" : "Approve automatic preparation"}
        </button>
        <button style={control} disabled={busy} type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
