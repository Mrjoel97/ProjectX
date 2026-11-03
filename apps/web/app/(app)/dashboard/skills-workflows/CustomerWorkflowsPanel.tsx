"use client";

import { api } from "@pikar/backend/api";
import {
  CUSTOMER_WORKFLOW_BRIEF_LIMIT,
  CUSTOMER_WORKFLOW_STEP_LIMIT,
  validateCustomerWorkflow,
} from "@pikar/core/customerWorkflows";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { type FormEvent, useRef, useState } from "react";
import styles from "./customerLibrary.module.css";

type Workflow = FunctionReturnType<typeof api.customerWorkflows.list>["workflows"][number];
type WorkflowRun = FunctionReturnType<typeof api.customerWorkflows.list>["runs"][number];
type RunRequest = {
  workflowId: Workflow["_id"];
  expectedRevision: number;
  brief: string;
  requestId: string;
};

export function CustomerWorkflowsPanel({
  openThread,
}: {
  openThread: (threadId: string, label: string) => void;
}) {
  const data = useQuery(api.customerWorkflows.list);
  const specialistData = useQuery(api.customerSpecialists.list);
  const saveWorkflow = useMutation(api.customerWorkflows.save);
  const archive = useMutation(api.customerWorkflows.archive);
  const reconcile = useMutation(api.customerWorkflows.reconcile);
  const run = useAction(api.customerWorkflowExecution.run);
  const [editing, setEditing] = useState<Workflow | "new" | null>(null);
  const [running, setRunning] = useState<Workflow | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<RunRequest | null>(null);

  if (!data || !specialistData) return <p role="status">Loading your workflows…</p>;
  if (!data.enabled)
    return (
      <section className={styles.library} aria-label="My workflows">
        <h2>My workflows</h2>
        <p className={styles.hint}>Custom workflows are available to workspaces in the pilot.</p>
      </section>
    );

  const specialists = specialistData.specialists.filter((specialist) => !specialist.archived);
  const selected = editing && editing !== "new" ? editing : undefined;
  const workflows = data.workflows.filter((workflow) => !workflow.archived);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const specialist = specialists.find((item) => item._id === fields.get("specialist"));
    if (!specialist) return;
    let definition: ReturnType<typeof validateCustomerWorkflow>;
    try {
      definition = validateCustomerWorkflow({
        name: String(fields.get("name") ?? ""),
        steps: String(fields.get("steps") ?? "")
          .split("\n")
          .map((step) => step.trim())
          .filter(Boolean),
      });
    } catch {
      setError(
        `Add a name and between one and ${CUSTOMER_WORKFLOW_STEP_LIMIT} report requirements, with up to 1,000 characters per requirement.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await saveWorkflow({
        ...(selected ? { id: selected._id, expectedRevision: selected.revision } : {}),
        name: definition.name,
        specialistId: specialist._id,
        specialistRevision: specialist.revision,
        steps: definition.steps,
      });
      setEditing(null);
      setNotice("Workflow saved. Add a product brief to run it.");
    } catch {
      setError(
        "The workflow could not be saved. Your entries are still here. If a specialist or workflow was edited elsewhere, cancel and reopen the latest version.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !running) return;
    const brief = String(new FormData(event.currentTarget).get("brief") ?? "").trim();
    if (!pending.current)
      pending.current = {
        workflowId: running._id,
        expectedRevision: running.revision,
        brief,
        requestId: crypto.randomUUID(),
      };
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await run(pending.current);
      if (result.threadId) {
        pending.current = null;
        setRunning(null);
        openThread(result.threadId, running.name);
      } else {
        setNotice("The run is recorded. Check its status below before starting another run.");
      }
    } catch {
      setError(
        "The run could not be confirmed. Check or resume this same run to avoid starting it twice.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function archiveWorkflow(workflow: Workflow) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await archive({ id: workflow._id, expectedRevision: workflow.revision });
      setNotice(`${workflow.name} is archived.`);
    } catch {
      setError("The workflow could not be archived. Refresh to check its current version.");
    } finally {
      setBusy(false);
    }
  }

  async function checkRun(item: WorkflowRun) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await reconcile({ runId: item._id });
      if (result.status === "completed" || result.status === "failed") {
        if (pending.current?.workflowId === item.workflowId) {
          pending.current = null;
          setRunning(null);
        }
        setNotice(
          result.status === "completed"
            ? "Your report is ready. Open the run to view it."
            : "This run has closed. You can start a new run when you are ready.",
        );
      } else {
        setNotice(
          result.status === "running"
            ? "This run is still in progress. Check its status again shortly."
            : "This run still needs review. Its earlier work must be resolved before another run can start.",
        );
      }
    } catch {
      setError("The run status could not be checked. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.library} aria-labelledby="my-workflows-title">
      <div className={styles.heading}>
        <div>
          <h2 id="my-workflows-title">My workflows</h2>
          <p className={styles.hint}>
            Give your specialist a repeatable process. This pilot creates one report with PDF
            download in My Workspace.
          </p>
        </div>
        <button
          className={styles.primary}
          type="button"
          disabled={busy || editing !== null || running !== null || specialists.length === 0}
          onClick={() => {
            setEditing("new");
            setNotice(null);
            setError(null);
          }}
        >
          Create workflow
        </button>
      </div>
      {specialists.length === 0 && (
        <p className={styles.hint}>
          Create a specialist in the Skills tab to start your first workflow.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {editing !== null && (
        <form
          key={selected?._id ?? "new"}
          className={styles.form}
          aria-label={selected ? "Edit workflow" : "Create workflow"}
          onSubmit={(event) => void save(event)}
        >
          <h3>{selected ? "Edit workflow" : "Create workflow"}</h3>
          <div className={styles.fields}>
            <label>
              Name
              <input
                name="name"
                required
                maxLength={100}
                defaultValue={selected?.name}
                disabled={busy}
                placeholder="Retail buyer brief"
              />
            </label>
            <label>
              Specialist
              <select
                name="specialist"
                required
                defaultValue={selected?.specialistId ?? ""}
                disabled={busy}
              >
                <option value="" disabled>
                  Choose a specialist
                </option>
                {specialists.map((specialist) => (
                  <option key={specialist._id} value={specialist._id}>
                    {specialist.name} · version {specialist.revision}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Report requirements
            <textarea
              name="steps"
              required
              rows={5}
              maxLength={6500}
              defaultValue={selected?.steps.join("\n")}
              disabled={busy}
              placeholder={
                "Summarize the product and its customer.\nExplain why it suits the target retailer.\nPrepare a buyer brief using the approved facts."
              }
            />
          </label>
          <p className={styles.hint}>
            Write up to {CUSTOMER_WORKFLOW_STEP_LIMIT} requirements, one per line. The specialist
            brings the results together in one PDF report.
          </p>
          <div className={styles.actions}>
            <button className={styles.primary} type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save workflow"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {workflows.map((workflow) => {
        const specialist = specialists.find((item) => item._id === workflow.specialistId);
        const unsettled = data.runs.find(
          (item) =>
            item.workflowId === workflow._id &&
            (item.status === "running" || item.status === "needs_review"),
        );
        const stale = !specialist || specialist.revision !== workflow.specialistRevision;
        return (
          <article className={styles.item} key={workflow._id}>
            <div className={styles.heading}>
              <h3>{workflow.name}</h3>
              <span className={styles.hint}>Version {workflow.revision}</span>
            </div>
            <p className={styles.hint}>
              {specialist?.name ?? "Specialist unavailable"} · specialist version{" "}
              {workflow.specialistRevision}
            </p>
            <ol className={styles.steps}>
              {workflow.steps.map((step, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: immutable versioned instructions may repeat; each position is a distinct step.
                <li key={`${index}:${step}`}>{step}</li>
              ))}
            </ol>
            {stale && (
              <p className={styles.hint}>
                Edit this workflow to choose an available specialist and review its latest version.
              </p>
            )}
            {unsettled && (
              <p role="status">
                {unsettled.status === "running"
                  ? "A run is in progress."
                  : "A previous run needs review before another can start."}
              </p>
            )}
            <div className={styles.actions}>
              <button
                className={styles.primary}
                type="button"
                disabled={
                  busy || editing !== null || running !== null || stale || Boolean(unsettled)
                }
                onClick={() => {
                  pending.current = null;
                  setRunning(workflow);
                  setError(null);
                  setNotice(null);
                }}
              >
                Run {workflow.name}
              </button>
              <button
                type="button"
                disabled={busy || editing !== null || running !== null}
                onClick={() => {
                  setEditing(workflow);
                  setError(null);
                  setNotice(null);
                }}
              >
                Edit {workflow.name}
              </button>
              <button
                type="button"
                disabled={busy || Boolean(unsettled) || running !== null}
                onClick={() => void archiveWorkflow(workflow)}
              >
                Archive {workflow.name}
              </button>
            </div>
            {running?._id === workflow._id && (
              <form
                className={`${styles.form} ${styles.runForm}`}
                aria-label={`Run ${workflow.name}`}
                onSubmit={(event) => void start(event)}
              >
                <label>
                  Product brief for this run
                  <textarea
                    name="brief"
                    required
                    maxLength={CUSTOMER_WORKFLOW_BRIEF_LIMIT}
                    rows={4}
                    disabled={busy || pending.current !== null}
                    placeholder="Describe this product, the facts to use and what you want the finished report to achieve."
                  />
                </label>
                <p className={styles.hint}>
                  This starts a new conversation and uses your workspace’s AI allowance. You can run
                  the saved workflow again with a different product brief.
                </p>
                <div className={styles.actions}>
                  <button className={styles.primary} type="submit" disabled={busy}>
                    {busy ? "Starting…" : pending.current ? "Check or resume run" : "Start run"}
                  </button>
                  <button
                    type="button"
                    disabled={busy || pending.current !== null}
                    onClick={() => setRunning(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </article>
        );
      })}
      {workflows.length === 0 && specialists.length > 0 && editing === null && (
        <p className={styles.hint}>
          Create a workflow to turn your specialist’s expertise into a repeatable report.
        </p>
      )}
      {data.runs.length > 0 && (
        <div className={styles.item}>
          <h3>Recent runs</h3>
          {data.runs.slice(0, 10).map((item) => (
            <div className={styles.heading} key={item._id}>
              <p>
                {data.workflows.find((workflow) => workflow._id === item.workflowId)?.name ??
                  "Workflow"}{" "}
                ·{" "}
                {item.status === "needs_review"
                  ? "Needs review"
                  : item.status === "completed"
                    ? "Completed"
                    : item.status === "failed"
                      ? "Could not finish"
                      : "Running"}
              </p>
              {item.threadId && (
                <button
                  type="button"
                  onClick={() => openThread(item.threadId as string, "Workflow run")}
                >
                  Open run
                </button>
              )}
              {(item.status === "running" || item.status === "needs_review") && (
                <button type="button" disabled={busy} onClick={() => void checkRun(item)}>
                  Check run status
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
