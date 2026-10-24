"use client";

import { api } from "@pikar/backend/api";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { type CSSProperties, useRef, useState } from "react";
import { ServiceKnowledgeConversation } from "./ServiceKnowledgeConversation";
import { ServiceGoalLink, ServiceOutcomesPanel } from "./ServiceOutcomesPanel";
import { ServiceRecurrencePanel } from "./ServiceRecurrencePanel";

type Service = NonNullable<FunctionReturnType<typeof api.managedServices.status>>;
type Options = FunctionReturnType<typeof api.managedServices.setupOptions>;
type Operation = "social.prepare" | "social.report";
const SOCIAL_SERVICE = "social-marketing";
const operations: { id: Operation; label: string; detail: string }[] = [
  {
    id: "social.prepare",
    label: "Prepare social content",
    detail: "Prepare drafts for you to review before scheduling.",
  },
  {
    id: "social.report",
    label: "Review engagement",
    detail: "Use supported Zernio insights to prepare a report.",
  },
];
const surface: CSSProperties = {
  border: "1px solid var(--rule)",
  borderRadius: 16,
  padding: "clamp(1rem, 2vw, 1.5rem)",
  background: "var(--paper)",
  display: "grid",
  gap: 16,
  minWidth: 0,
};
const control: CSSProperties = {
  minHeight: 44,
  padding: "0.5rem 0.85rem",
  border: "1px solid var(--rule)",
  borderRadius: 8,
  background: "var(--paper)",
  color: "var(--ink)",
  font: "inherit",
  cursor: "pointer",
};
const controlStyle = (disabled: boolean): CSSProperties => ({
  ...control,
  ...(disabled ? { opacity: 0.5, cursor: "not-allowed" } : {}),
});
const muted: CSSProperties = { color: "var(--ink-soft)", margin: 0, fontSize: "0.9rem" };
const row: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 };
const unavailable = "This service is not available to run yet. Your setup can be saved.";
const reasons: Record<string, string> = {
  operation_unqualified: unavailable,
  missing_tool_grant: unavailable,
  missing_account: "Choose a connected account for each selected activity.",
  account_unavailable: "A selected account has changed or needs reconnection. Review your setup.",
  missing_skill: unavailable,
  skill_unqualified: unavailable,
  unsupported_service_operation: unavailable,
  budget_limit_unavailable: "Review the maximum spend per run in setup before starting.",
  source_unavailable: "Complete your business profile before running this activity.",
  business_information_required:
    "Pikar needs a few business details. Continue the conversation below.",
  service_paused_or_stopped: "This service is paused or stopped.",
};
const accountKey = (a: { provider: string; accountId: string }) => `${a.provider}:${a.accountId}`;

export function ManagedServicesPanel() {
  const services = useQuery(api.managedServices.list, {});
  const options = useQuery(api.managedServices.setupOptions, {});
  const buffer = useQuery(api.buffer.status, {});
  const zernio = useQuery(api.zernio.status, {});
  const convex = useConvex();
  const [editing, setEditing] = useState<Service | null | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const social = services?.items.find((s) => s.serviceId === SOCIAL_SERVICE);
  const refresh = async () => {
    setRefreshing(true);
    setNotice("");
    try {
      await Promise.all([
        convex.query(api.managedServices.list, {}),
        convex.query(api.managedServices.setupOptions, {}),
      ]);
      setNotice("Service setup and connections checked.");
    } catch {
      setNotice("Could not refresh service setup. Your draft has been kept.");
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <section aria-labelledby="managed-services-heading" style={{ display: "grid", gap: 16 }}>
      <div style={{ ...row, justifyContent: "space-between" }}>
        <div>
          <h2 id="managed-services-heading" style={{ margin: 0, fontSize: "1.25rem" }}>
            Let Pikar handle the work
          </h2>
          <p style={muted}>
            Set your goal and accounts. Follow progress and review the decisions that need you.
          </p>
        </div>
        <button
          type="button"
          style={controlStyle(refreshing)}
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? "Checking…" : "Refresh services"}
        </button>
      </div>
      {notice && (
        <p role="status" style={muted}>
          {notice}
        </p>
      )}
      {services === undefined || options === undefined ? (
        <p role="status">Loading your services…</p>
      ) : (
        <>
          {options.truncated && (
            <p style={muted}>
              Some account choices are not shown. Review your selected accounts in Connections.
            </p>
          )}
          {services.items.map((service) => (
            <ServiceCard
              key={service.serviceId}
              serviceId={service.serviceId}
              onEdit={setEditing}
            />
          ))}
          {services.truncated && <p style={muted}>Only the first 50 services are shown.</p>}
          {(editing !== undefined || !social) && (
            <ServiceSetup
              key={editing?.serviceId ?? "new"}
              existing={editing ?? null}
              options={options}
              bufferConnected={buffer?.connected === true}
              zernioConnected={zernio?.status === "connected"}
              onSaved={() => setEditing(undefined)}
              onCancel={social ? () => setEditing(undefined) : undefined}
            />
          )}
          {!social && <p style={muted}>Saving setup does not start work or approve a post.</p>}
        </>
      )}
    </section>
  );
}

function ServiceSetup({
  existing,
  options,
  bufferConnected,
  zernioConnected,
  onSaved,
  onCancel,
}: {
  existing: Service | null;
  options: Options;
  bufferConnected: boolean;
  zernioConnected: boolean;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const setup = useMutation(api.managedServices.setup);
  const convex = useConvex();
  const [baseline, setBaseline] = useState(existing);
  const [goal, setGoal] = useState(existing?.goal ?? "");
  const [selectedOps, setOps] = useState<Operation[]>(
    existing
      ? existing.operationIds.filter(
          (id): id is Operation => id === "social.prepare" || id === "social.report",
        )
      : ["social.prepare", "social.report"],
  );
  const [accounts, setAccounts] = useState(existing?.accounts.map(accountKey) ?? []);
  const [budget, setBudget] = useState(
    String((existing?.budgetLimitCents ?? options.budgetLimitCents) / 100),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const selected = options.accounts.filter((a) => accounts.includes(accountKey(a)));
  const usable = selected.filter(
    (a) => a.available && (a.provider === "buffer" ? bufferConnected : zernioConnected),
  );
  const missing = selectedOps.some(
    (op) => !usable.some((a) => a.provider === (op === "social.prepare" ? "buffer" : "zernio")),
  );
  const cents = Math.round(Number(budget) * 100);
  const valid =
    goal.trim().length > 0 &&
    selectedOps.length > 0 &&
    usable.length === selected.length &&
    selected.length <= 8 &&
    options.skills.length > 0 &&
    /^\d+(?:\.\d{1,2})?$/.test(budget) &&
    Number.isSafeInteger(cents) &&
    cents > 0;
  const loadLatest = async () => {
    setBusy(true);
    try {
      const latest = await convex.query(api.managedServices.status, {
        serviceId: baseline?.serviceId ?? SOCIAL_SERVICE,
      });
      if (!latest) throw new Error("missing");
      setBaseline(latest);
      setGoal(latest.goal);
      setAccounts(latest.accounts.map(accountKey));
      setOps(
        latest.operationIds.filter(
          (id): id is Operation => id === "social.prepare" || id === "social.report",
        ),
      );
      setBudget(String(latest.budgetLimitCents / 100));
      setStale(false);
      setError("");
    } catch {
      setError("Could not load the latest setup. Your draft has been kept.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      style={surface}
      aria-label="Social marketing setup"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || busy || stale) return;
        setBusy(true);
        setError("");
        void setup({
          serviceId: baseline?.serviceId ?? SOCIAL_SERVICE,
          expectedRevision: baseline?.revision ?? 0,
          goal: goal.trim(),
          operationIds: selectedOps,
          accounts: selected.map(({ provider, connectionId, accountId, connectionRevision }) => ({
            provider,
            connectionId,
            accountId,
            connectionRevision,
          })),
          skills: options.skills,
          budgetLimitCents: cents,
        })
          .then(onSaved)
          .catch((err: unknown) => {
            const conflict = err instanceof Error && /SERVICE_STALE_REVISION/.test(err.message);
            setStale(conflict);
            setError(
              conflict
                ? "This setup changed elsewhere. Your draft is kept. Load the latest setup before saving again."
                : "Could not save this setup. Review your connections and try again. Your draft is kept.",
            );
          })
          .finally(() => setBusy(false));
      }}
    >
      <div>
        <h3 style={{ margin: 0 }}>Social marketing</h3>
        <p style={muted}>Pikar prepares the work. You review posts before anything is scheduled.</p>
      </div>
      <label style={{ display: "grid", gap: 8 }}>
        What should Pikar help you achieve?
        <textarea
          aria-label="Service goal"
          value={goal}
          maxLength={2000}
          rows={3}
          disabled={busy}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="For example, bring more local customers to my shop."
          style={{ ...control, resize: "vertical", width: "100%", cursor: "text" }}
        />
      </label>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>What Pikar should do</legend>
        {operations.map((op) => (
          <label
            key={op.id}
            style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 52 }}
          >
            <input
              type="checkbox"
              checked={selectedOps.includes(op.id)}
              onChange={(e) =>
                setOps(
                  e.target.checked
                    ? [...selectedOps, op.id]
                    : selectedOps.filter((id) => id !== op.id),
                )
              }
            />
            <span>
              {op.label}
              <span style={{ ...muted, display: "block" }}>{op.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>Accounts Pikar may use</legend>
        {options.accounts.map((a) => {
          const connected = a.provider === "buffer" ? bufferConnected : zernioConnected;
          return (
            <label key={accountKey(a)} style={{ ...row, minHeight: 44 }}>
              <input
                type="checkbox"
                checked={accounts.includes(accountKey(a))}
                disabled={!a.available || !connected}
                onChange={(e) =>
                  setAccounts(
                    e.target.checked
                      ? [...accounts, accountKey(a)]
                      : accounts.filter((key) => key !== accountKey(a)),
                  )
                }
              />
              <span>
                {a.label} · {a.provider === "buffer" ? "Buffer" : "Zernio"}
                {(!a.available || !connected) && " · Reconnect to use"}
              </span>
            </label>
          );
        })}
        {options.accounts.length === 0 && (
          <p style={muted}>No selected social accounts are available yet.</p>
        )}
        {accounts.length > 8 && <p style={muted}>Choose up to eight accounts for this service.</p>}
        <Link href="/dashboard/profile?tab=connections">Manage connections</Link>
      </fieldset>
      {missing && (
        <p style={muted}>
          You can save this setup and answer business questions now. Before work starts, choose a
          Buffer account for content preparation and a Zernio account for engagement reports, or
          turn off the activity you do not need.
        </p>
      )}
      {options.skills.length === 0 && (
        <p style={muted}>
          This service is not available to set up yet. Review your connected accounts.
        </p>
      )}
      <label style={{ display: "grid", gap: 8 }}>
        Maximum spend per run (USD)
        <input
          aria-label="Maximum spend per run (USD)"
          type="number"
          min="0.01"
          step="0.01"
          value={budget}
          disabled={busy}
          onChange={(e) => setBudget(e.target.value)}
          style={{ ...control, maxWidth: 180 }}
        />
      </label>
      <div style={row}>
        <label style={row}>
          <input type="checkbox" disabled />
          Run on a schedule
        </label>
        <span style={muted}>Recurring services are not available yet.</span>
      </div>
      {error && (
        <p role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <div style={row}>
        <button
          style={{
            ...controlStyle(!valid || busy || stale),
            background: "var(--teal-900)",
            color: "var(--card)",
          }}
          type="submit"
          disabled={!valid || busy || stale}
        >
          {busy ? "Saving…" : "Save service setup"}
        </button>
        {stale && (
          <button
            type="button"
            style={controlStyle(busy)}
            disabled={busy}
            onClick={() => void loadLatest()}
          >
            Load latest setup
          </button>
        )}
        {onCancel && (
          <button type="button" style={controlStyle(busy)} disabled={busy} onClick={onCancel}>
            Cancel edit
          </button>
        )}
      </div>
    </form>
  );
}

function ServiceCard({
  serviceId,
  onEdit,
}: {
  serviceId: string;
  onEdit: (service: Service) => void;
}) {
  const service = useQuery(api.managedServices.status, { serviceId });
  const runs = useQuery(api.managedServiceRuns.list, { serviceId });
  const start = useAction(api.managedServiceRuns.start);
  const reconcile = useMutation(api.managedServiceRuns.reconcile);
  const setControl = useMutation(api.managedServices.setControl);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const request = useRef<{ binding: string; key: string; runId?: string } | null>(null);
  if (!service) return <p role="status">Loading saved service…</p>;
  const latest = runs?.items[0];
  const binding = `${service.revision}:${service.controlRevision}`;
  const supportsEditor =
    serviceId === SOCIAL_SERVICE &&
    service.operationIds.every((id) => id === "social.prepare" || id === "social.report");
  const blockedByRun = runs?.items.some((run) =>
    ["claimed", "running", "unknown"].includes(run.state),
  );
  const pending = runs?.items.find((run) => ["claimed", "running", "unknown"].includes(run.state));
  const canStart =
    service.readiness.ready &&
    service.controlState === "active" &&
    !busy &&
    runs !== undefined &&
    !blockedByRun;
  const changeControl = (action: "pause" | "stop" | "resume") => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    void setControl({
      serviceId,
      expectedRevision: service.revision,
      expectedControlRevision: service.controlRevision,
      action,
    })
      .then(() =>
        setNotice(
          action === "pause"
            ? "Service paused. No new work will start. Work already in progress may finish."
            : action === "resume"
              ? "Service resumed. Check readiness, then choose Start one run when you are ready."
              : "Service stopped. Posts already scheduled in Buffer stay in Buffer; manage them there.",
        ),
      )
      .catch(() =>
        setNotice(
          "Could not change this service. Refresh to check its latest state before trying again.",
        ),
      )
      .finally(() => setBusy(false));
  };
  return (
    <article style={surface} aria-label="Saved social marketing service">
      <div style={{ ...row, justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>
          {serviceId === SOCIAL_SERVICE ? "Social marketing" : "Saved service"}
        </h3>
        <span>
          {service.controlState === "active"
            ? latest?.state === "running"
              ? "Working"
              : latest?.state === "claimed"
                ? "Starting"
                : latest?.state === "unknown"
                  ? "Needs attention"
                  : service.readiness.ready
                    ? "Ready"
                    : "Setup saved · not ready to run"
            : service.controlState === "paused"
              ? "Paused"
              : "Stopped"}
        </span>
      </div>
      <p style={{ margin: 0, overflowWrap: "anywhere" }}>{service.goal}</p>
      <ServiceGoalLink
        serviceId={service.id}
        revision={service.revision}
        controlRevision={service.controlRevision}
        goalId={service.goalId}
        disabled={Boolean(pending) || busy}
      />
      <p style={muted}>
        {service.operationIds
          .map((id) => operations.find((op) => op.id === id)?.label ?? "Other service activity")
          .join(" · ")}{" "}
        · Up to ${(service.budgetLimitCents / 100).toFixed(2)} per run
      </p>
      {service.readiness.reasons.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {[
            ...new Set(service.readiness.reasons.map((reason) => reasons[reason] ?? unavailable)),
          ].map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      <div>
        <strong>Latest activity</strong>
        <p style={muted}>
          {latest
            ? latest.state === "running" && service.controlState !== "active"
              ? service.controlState === "paused"
                ? "Finishing the current step before pausing."
                : "Finishing the current step before stopping."
              : ({
                  claimed: "Start requested.",
                  running: "Pikar is working.",
                  completed: "Run completed. Review the work and any required decisions.",
                  failed:
                    "This run could not finish. Review its conversation before starting again.",
                  stopped: "Run stopped.",
                  unknown:
                    "The outcome is uncertain. Review this run; another run cannot start yet.",
                }[latest.state] ?? "Checking the run outcome…")
            : runs === undefined
              ? "Checking activity…"
              : "No runs yet."}
        </p>
        {latest?.threadId && (
          <Link href={`/dashboard/workspace?thread=${encodeURIComponent(latest.threadId)}`}>
            Review work in My Workspace
          </Link>
        )}
      </div>
      {supportsEditor && (
        <ServiceKnowledgeConversation
          serviceId={serviceId}
          disabled={Boolean(pending) || busy || service.controlState !== "active"}
          budgetLimitCents={service.budgetLimitCents}
          runReadiness={{
            revision: service.revision,
            controlRevision: service.controlRevision,
            reasons: service.readiness.reasons,
          }}
        />
      )}
      {supportsEditor && (
        <ServiceRecurrencePanel service={service} disabled={Boolean(pending) || busy} />
      )}
      {latest && <ServiceOutcomesPanel key={latest.runId} runId={latest.runId} />}
      {blockedByRun && (
        <p style={muted}>
          A run is still active or has an uncertain outcome. Another run cannot start until it is
          resolved.
        </p>
      )}
      {pending && (
        <button
          type="button"
          style={controlStyle(busy)}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setNotice("");
            void reconcile({
              runId: pending.runId,
              expectedRevision: service.revision,
              expectedControlRevision: service.controlRevision,
            })
              .then((result) =>
                setNotice(
                  result.resolved
                    ? "Interrupted work closed. Review any saved drafts before starting a new run."
                    : result.reason === "still_running"
                      ? "Pikar is still working. No additional run was started."
                      : result.reason === "unsettled_cost"
                        ? "The final cost is not confirmed yet. The service stays on hold."
                        : "Could not confirm the job status. The service stays on hold.",
                ),
              )
              .catch(() =>
                setNotice("Could not check this run. Refresh to check its latest state."),
              )
              .finally(() => setBusy(false));
          }}
        >
          Check interrupted work
        </button>
      )}
      <div style={row}>
        <button
          type="button"
          style={controlStyle(!canStart)}
          disabled={!canStart}
          onClick={() => {
            if (!canStart) return;
            const finishedRequest =
              request.current?.runId !== undefined &&
              runs?.items.some(
                (run) =>
                  run.runId === request.current?.runId &&
                  ["completed", "failed", "stopped"].includes(run.state),
              );
            if (request.current?.binding !== binding || finishedRequest)
              request.current = { binding, key: crypto.randomUUID() };
            setBusy(true);
            setNotice("");
            void start({
              serviceId,
              expectedRevision: service.revision,
              expectedControlRevision: service.controlRevision,
              requestKey: request.current.key,
            })
              .then((result) => {
                if (request.current) request.current.runId = result.runId;
                setNotice("Start request checked. Follow the latest activity for its result.");
              })
              .catch(() =>
                setNotice(
                  "Could not confirm the start. Refresh and check activity. Retrying this request uses the same reference.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Working…" : "Start one run"}
        </button>
        <button
          type="button"
          style={controlStyle(busy || service.controlState === "stopped" || !supportsEditor)}
          disabled={busy || service.controlState === "stopped" || !supportsEditor}
          onClick={() => onEdit(service)}
        >
          Edit setup
        </button>
        <button
          type="button"
          style={controlStyle(busy || service.controlState !== "active")}
          disabled={busy || service.controlState !== "active"}
          onClick={() => changeControl("pause")}
        >
          Pause service
        </button>
        <button
          type="button"
          style={controlStyle(busy || service.controlState === "stopped")}
          disabled={busy || service.controlState === "stopped"}
          onClick={() => changeControl("stop")}
        >
          Stop service
        </button>
        {service.controlState !== "active" && (
          <button
            type="button"
            style={controlStyle(busy)}
            disabled={busy}
            onClick={() => changeControl("resume")}
          >
            Resume service
          </button>
        )}
      </div>
      <p style={muted}>
        Stopping prevents new Pikar work. It does not cancel posts already scheduled in Buffer.
      </p>
      {notice && (
        <p role="status" style={{ margin: 0 }}>
          {notice}
        </p>
      )}
    </article>
  );
}
