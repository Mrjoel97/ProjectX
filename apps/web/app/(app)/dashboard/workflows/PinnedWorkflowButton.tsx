"use client";

import { api } from "@pikar/backend/api";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useRouter } from "next/navigation";
import { type CSSProperties, useId, useRef, useState } from "react";
import { WorkflowPackPreflight } from "../workspace/WorkflowPackPreflight";

// ROUT-02: pin an approved workflow, and run it again BY HAND.
//
// NOTHING HERE SCHEDULES ANYTHING, and the copy must never suggest otherwise. There is no "every",
// no "daily", no "automatically", no "runs on" — a pin is a shortcut to a run a person starts, and
// `PinnedWorkflowButton.test.ts` scans this file for those words. The server has no cadence,
// timezone, next-run or enabled field for a UI to have been reading in the first place.
//
// THREE TRUE THINGS THIS SURFACE SAYS THAT ARE UNCOMFORTABLE, and each one is a state the server
// resolves rather than a sentence this file decided:
//
//   1. `customization_not_applied` — a pinned run takes the APPROVED GLOBAL TEMPLATE. A tenant's
//      saved settings are a `tenantSkills` candidate, `PACK_GATE` refuses to activate one, and
//      `cockpit.ts` passes no `tenantSkillIds`. Rendering "runs your customization" would be a lie
//      with a green test over it.
//   2. `template_republished` — the pin names version N and version M is approved now. The run
//      re-resolves to M; the pin is stale and says so, naming both numbers.
//   3. `sources_unavailable` — the run happens without those planes. The pack's own preflight is
//      rendered underneath, so the gap comes with the thing that would lift it.
//
// AND THE ONE IT REFUSES TO SAY: there is no activation, approval or rollback control here, and
// none is possible — `activateTenantCandidate` and `rollbackTenantSkill` are `ownerMutation`s. A
// disabled "Approve" button implying "not yet" would be the same lie in a different shape.
//
// TWO COMPONENTS, ONE FILE. `PinnedWorkflowsView` holds every sentence and takes its whole state as
// props; `PinnedWorkflowButton` holds the hooks and the handlers. The test drives the CONTAINER in
// a real DOM (jsdom, `createRoot`, real click events) because four mutations that made the sibling
// route inert once left an SSR-only suite fully green.
//
// BRAND: tokens only (`--card`, `--rule`, `--ink`, `--ink-soft`, `--released`), the tracked-caps
// section label (§3), cards on canvas (§4), status in WORDS not colour (§6). Amber (`--held`)
// belongs to the approval gate and appears nowhere here.

type PackListing = FunctionReturnType<typeof api.workflowPackDiscovery.listPacks>[number];
type Pin = FunctionReturnType<typeof api.pinnedWorkflows.listPins>[number];
type RunResult = FunctionReturnType<typeof api.pinnedWorkflows.runAgain>;
type PinResult = FunctionReturnType<typeof api.pinnedWorkflows.pinWorkflow>;

/** What the last press did, for ONE pack. One value instead of four booleans that can contradict
 *  each other — "starting" and "refused" must not be able to render at the same time. */
export type PinAction =
  | { readonly kind: "idle" }
  | { readonly kind: "pinning" }
  | { readonly kind: "unpinning" }
  | { readonly kind: "running" }
  | { readonly kind: "pinRefused"; readonly result: Extract<PinResult, { ok: false }> }
  | { readonly kind: "unpinMissing" }
  | { readonly kind: "runRefused"; readonly result: Extract<RunResult, { ok: false }> }
  /** The run started and was stopped at the governed gate before the model. Nothing was spent. */
  | { readonly kind: "runBlocked" }
  /** A throw, not a refusal: every refusal these channels produce comes back as DATA. */
  | { readonly kind: "transport" };

// ── The copy ────────────────────────────────────────────────────────────────────────────────

const INTRO =
  "Pinning a workflow remembers the approved version it runs. Nothing starts by itself — you press Run again.";

const TRANSPORT_ERROR = "That did not go through. Check your connection and try again.";

const BLOCKED_RUN =
  "Pikar stopped this run before it started. Nothing ran and nothing was spent — try again shortly.";

/** A blocker refuses the run. Both are server-resolved states, not guesses made here. */
function blockerLine(blocker: Pin["blockers"][number]): string {
  switch (blocker) {
    case "paused":
      return "Pikar is paused right now, so nothing can be run.";
    case "template_not_active":
      return "This workflow is not approved right now, so nothing can be run.";
    default:
      return "This workflow cannot be run right now.";
  }
}

/** A notice describes a run that will still happen. Never rendered as a refusal. */
function noticeLine(notice: Pin["notices"][number], pin: Pin): string {
  switch (notice) {
    case "template_republished":
      return `This pin remembers version ${pin.templateVersion}. Version ${pin.activeVersion} is the approved one now, and that is what Run again uses.`;
    case "customization_not_applied":
      return "Your saved settings for this workflow are not used. Pikar cannot make a customization live in this release, so Run again uses the approved workflow.";
    case "customization_missing":
      return "The settings this pin remembered are no longer there. Run again uses the approved workflow.";
    case "sources_unavailable":
      return pin.sourceUnavailableCount === 1
        ? "One of this workflow's sources is not connected. It will run without it."
        : `${pin.sourceUnavailableCount} of this workflow's sources are not connected. It will run without them.`;
    default:
      return "Something about this pin has changed since you made it.";
  }
}

function runRefusalLine(result: Extract<RunResult, { ok: false }>): string {
  switch (result.reason) {
    case "unknown_pin":
      return "That pin is no longer there. Pin the workflow again.";
    case "not_ready":
      return `That cannot run right now. ${result.blockers.map(blockerLine).join(" ")}`;
    case "run_failed":
      return "That could not be started. Nothing ran — try again.";
    default:
      return "That could not be started.";
  }
}

function pinRefusalLine(result: Extract<PinResult, { ok: false }>): string {
  switch (result.reason) {
    case "unknown_template":
      return "That is not a workflow Pikar offers.";
    case "template_not_active":
      return "That workflow is not approved right now, so there is nothing to pin.";
    default:
      return "That could not be pinned.";
  }
}

/** The one line the live region announces for a pack, or `null` when there is nothing to say. */
export function actionLine(action: PinAction): string | null {
  switch (action.kind) {
    case "pinning":
      return "Pinning…";
    case "unpinning":
      return "Removing the pin…";
    case "running":
      return "Starting a new run…";
    case "runBlocked":
      return BLOCKED_RUN;
    case "runRefused":
      return runRefusalLine(action.result);
    case "pinRefused":
      return pinRefusalLine(action.result);
    case "unpinMissing":
      return "That pin was already gone.";
    case "transport":
      return TRANSPORT_ERROR;
    default:
      return null;
  }
}

/** Where a started run lands: the FRESH conversation it just created, in the workspace. */
export function threadHref(threadId: string): string {
  return `/dashboard/workspace?thread=${encodeURIComponent(threadId)}`;
}

/** The one control style, matching `WorkflowPackCustomizer`'s `control` — tokens only, no new
 *  component library, and the primary action is the shared `.cta-dark` class the rest of the app
 *  already uses for "this is the thing you came here to press". */
const control: CSSProperties = {
  padding: "0.45rem 0.8rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--rule)",
  background: "var(--card)",
  color: "var(--ink)",
  fontFamily: "inherit",
  fontSize: "0.85rem",
};

// ── The view ────────────────────────────────────────────────────────────────────────────────

export type PinnedWorkflowsViewProps = {
  readonly idPrefix: string;
  readonly packs: readonly PackListing[] | undefined;
  readonly pins: readonly Pin[] | undefined;
  readonly actions: Readonly<Record<string, PinAction>>;
  readonly onPin: (packId: string) => void;
  readonly onUnpin: (packId: string) => void;
  readonly onRun: (packId: string) => void;
  readonly registerPinButton: (packId: string, el: HTMLButtonElement | null) => void;
};

export function PinnedWorkflowsView({
  idPrefix,
  packs,
  pins,
  actions,
  onPin,
  onUnpin,
  onRun,
  registerPinButton,
}: PinnedWorkflowsViewProps) {
  return (
    <section
      className="pinned-workflows"
      aria-labelledby={`${idPrefix}-heading`}
      style={{ display: "grid", gap: "0.75rem" }}
    >
      <div>
        <p className="caps-label" style={{ margin: 0 }}>
          Run again
        </p>
        <h2
          id={`${idPrefix}-heading`}
          style={{ margin: "0.2rem 0 0", fontSize: "var(--step-1, 1.15rem)", color: "var(--ink)" }}
        >
          Workflows you run more than once
        </h2>
        <p style={{ margin: "0.3rem 0 0", color: "var(--ink-soft)", fontSize: "0.9rem" }}>
          {INTRO}
        </p>
      </div>

      {packs === undefined || pins === undefined ? (
        <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
          Loading your workflows…
        </p>
      ) : packs.length === 0 ? (
        <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
          No approved workflows are available to you yet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.6rem" }}>
          {packs.map((pack) => (
            <PackRow
              key={pack.packId}
              idPrefix={idPrefix}
              pack={pack}
              pin={pins.find((p) => p.templateId === pack.packId) ?? null}
              action={actions[pack.packId] ?? { kind: "idle" }}
              onPin={onPin}
              onUnpin={onUnpin}
              onRun={onRun}
              registerPinButton={registerPinButton}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PackRow({
  idPrefix,
  pack,
  pin,
  action,
  onPin,
  onUnpin,
  onRun,
  registerPinButton,
}: {
  idPrefix: string;
  pack: PackListing;
  pin: Pin | null;
  action: PinAction;
  onPin: (packId: string) => void;
  onUnpin: (packId: string) => void;
  onRun: (packId: string) => void;
  registerPinButton: (packId: string, el: HTMLButtonElement | null) => void;
}) {
  const statusId = `${idPrefix}-${pack.packId}-status`;
  const busy =
    action.kind === "pinning" || action.kind === "unpinning" || action.kind === "running";
  const line = actionLine(action);

  return (
    <li
      style={{
        background: "var(--card)",
        border: "1px solid var(--rule)",
        borderRadius: "0.5rem",
        padding: "0.75rem",
        display: "grid",
        gap: "0.4rem",
      }}
    >
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ color: "var(--ink)", fontWeight: 600 }}>{pack.title}</span>
        <span style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
          {pin === null
            ? `Approved version ${pack.version}.`
            : `Pinned at version ${pin.templateVersion}.`}
        </span>
      </div>

      {pin !== null && (
        <>
          {pin.blockers.map((b) => (
            <p key={b} style={{ margin: 0, color: "var(--ink)", fontSize: "0.85rem" }}>
              {blockerLine(b)}
            </p>
          ))}
          {pin.notices.map((n) => (
            <p key={n} style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.85rem" }}>
              {noticeLine(n, pin)}
            </p>
          ))}
        </>
      )}

      {/* The pack's own preflight — a gap is stated WITH the thing that would lift it, which is
          what makes "one source is not connected" actionable rather than an apology. */}
      <WorkflowPackPreflight sources={pack.sources} />

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {pin === null ? (
          <button
            type="button"
            ref={(el) => registerPinButton(pack.packId, el)}
            onClick={() => onPin(pack.packId)}
            disabled={busy}
            aria-busy={action.kind === "pinning"}
            aria-describedby={line === null ? undefined : statusId}
            style={{
              ...control,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >
            Pin this workflow
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onRun(pack.packId)}
              disabled={busy || !pin.runnable}
              aria-busy={action.kind === "running"}
              aria-describedby={line === null ? undefined : statusId}
              className="cta-dark"
              style={{
                margin: 0,
                padding: "0.45rem 0.9rem",
                fontSize: "0.85rem",
                border: "none",
                fontFamily: "inherit",
                cursor: busy || !pin.runnable ? "not-allowed" : "pointer",
                opacity: busy || !pin.runnable ? 0.5 : 1,
              }}
            >
              Run again
            </button>
            <button
              type="button"
              onClick={() => onUnpin(pack.packId)}
              disabled={busy}
              aria-busy={action.kind === "unpinning"}
              style={{
                ...control,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.5 : 1,
              }}
            >
              Remove pin
            </button>
          </>
        )}
      </div>

      {/* One live region per pack, so the answer is announced next to the control that was
          pressed rather than at the top of a page the user is no longer looking at. */}
      <p
        id={statusId}
        role="status"
        aria-live="polite"
        style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.85rem", minHeight: "1.2em" }}
      >
        {line}
      </p>
    </li>
  );
}

// ── The container ───────────────────────────────────────────────────────────────────────────

export function PinnedWorkflowButton() {
  const idPrefix = useId();
  const router = useRouter();
  const packs = useQuery(api.workflowPackDiscovery.listPacks);
  const pins = useQuery(api.pinnedWorkflows.listPins);
  const pinWorkflow = useMutation(api.pinnedWorkflows.pinWorkflow);
  const unpinWorkflow = useMutation(api.pinnedWorkflows.unpinWorkflow);
  const runAgain = useAction(api.pinnedWorkflows.runAgain);

  const [actions, setActions] = useState<Record<string, PinAction>>({});
  const setAction = (packId: string, action: PinAction) =>
    setActions((prev) => ({ ...prev, [packId]: action }));

  // FOCUS MUST NOT BE LOST WHEN THE PRESSED CONTROL UNMOUNTS. Removing a pin replaces "Remove pin"
  // with "Pin this workflow", and a keyboard user whose focused button vanished is returned to the
  // top of the document with no idea what happened. The replacement button takes the focus.
  //
  // IT IS DONE IN THE REF CALLBACK, NOT IN AN EFFECT, and the difference is behavioural rather than
  // stylistic: the mutation resolves BEFORE the live `listPins` query pushes the removal, so at the
  // moment the request comes back there is no Pin control on the page to focus yet. An effect that
  // looked once and gave up (the first version of this) left focus on the document body in the real
  // app. The ref callback runs when the replacement button MOUNTS, which is exactly the moment the
  // row flips — so the request is honoured when it can be, and never earlier.
  const pinButtons = useRef(new Map<string, HTMLButtonElement>());
  const [focusPack, setFocusPack] = useState<string | null>(null);
  const registerPinButton = (packId: string, el: HTMLButtonElement | null) => {
    if (el === null) {
      pinButtons.current.delete(packId);
      return;
    }
    pinButtons.current.set(packId, el);
    if (focusPack === packId) {
      el.focus();
      setFocusPack(null);
    }
  };

  const pinIdFor = (packId: string) => pins?.find((p) => p.templateId === packId)?.id;

  const doPin = async (packId: string) => {
    setAction(packId, { kind: "pinning" });
    try {
      const res = await pinWorkflow({ templateId: packId });
      setAction(packId, res.ok ? { kind: "idle" } : { kind: "pinRefused", result: res });
    } catch {
      setAction(packId, { kind: "transport" });
    }
  };

  const doUnpin = async (packId: string) => {
    const id = pinIdFor(packId);
    if (id === undefined) return;
    setAction(packId, { kind: "unpinning" });
    try {
      const res = await unpinWorkflow({ id });
      setAction(packId, res.removed ? { kind: "idle" } : { kind: "unpinMissing" });
      // Only when the row is actually going to change. A refused unpin leaves "Remove pin" on the
      // page and focus exactly where the user left it.
      if (res.removed) setFocusPack(packId);
    } catch {
      setAction(packId, { kind: "transport" });
    }
  };

  const doRun = async (packId: string) => {
    const id = pinIdFor(packId);
    if (id === undefined) return;
    setAction(packId, { kind: "running" });
    try {
      const res = await runAgain({ id });
      if (!res.ok) {
        setAction(packId, { kind: "runRefused", result: res });
        return;
      }
      if (!res.ran) {
        // The turn started and the governed gate stopped it before the model. There IS a thread,
        // but sending the user to a conversation whose only reply is "I've paused for a moment"
        // hides the one fact that matters: nothing was spent and nothing happened.
        setAction(packId, { kind: "runBlocked" });
        return;
      }
      setAction(packId, { kind: "idle" });
      router.push(threadHref(res.threadId));
    } catch {
      setAction(packId, { kind: "transport" });
    }
  };

  return (
    <PinnedWorkflowsView
      idPrefix={idPrefix}
      packs={packs}
      pins={pins}
      actions={actions}
      onPin={(packId) => void doPin(packId)}
      onUnpin={(packId) => void doUnpin(packId)}
      onRun={(packId) => void doRun(packId)}
      registerPinButton={registerPinButton}
    />
  );
}
