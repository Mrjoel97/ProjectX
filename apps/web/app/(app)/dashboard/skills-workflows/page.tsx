"use client";
import { api } from "@pikar/backend/api";
import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorBoundary } from "../workspace/ErrorBoundary";
import { SkillAuthoringPanel } from "../workspace/SkillAuthoringPanel";
import { WorkflowPackOwnerControls } from "../workspace/WorkflowPackOwnerControls";
import { WorkflowPackOwnerPreview } from "../workspace/WorkflowPackOwnerPreview";
import { WorkflowPackQuickStarts } from "../workspace/WorkflowPackQuickStarts";

export default function SkillsAndWorkflowsPage() {
  return (
    <ErrorBoundary
      label="skills-and-workflows"
      fallback={
        <p role="alert">Your toolkit could not be loaded. Refresh this page to try again.</p>
      }
    >
      <SkillsAndWorkflowsLibrary />
    </ErrorBoundary>
  );
}

function SkillsAndWorkflowsLibrary() {
  const router = useRouter();
  const tabs = ["workflows", "skills"] as const;
  const [section, setSection] = useState<(typeof tabs)[number]>("workflows");
  const [sending, setSending] = useState(false);
  const openThread = (threadId: string, label: string) => {
    router.push(
      `/dashboard/workspace?thread=${encodeURIComponent(threadId)}&label=${encodeURIComponent(label)}`,
    );
  };
  const packs = useQuery(api.workflowPackDiscovery.listPacks);
  const startPack = useAction(api.cockpit.startWorkflowPack);
  const [startingPack, setStartingPack] = useState<string | null>(null);
  const [packNotice, setPackNotice] = useState<string | null>(null);
  const onStartPack = (packId: string) => {
    const pack = packs?.find((p) => p.packId === packId);
    if (pack === undefined || sending || startingPack !== null) return;
    setPackNotice(null);
    setSending(true);
    setStartingPack(packId);
    void startPack({ packId, text: pack.opener })
      .then((res) => openThread(res.threadId, pack.title))
      // The notice lands next to the control the user pressed. It never names the pack id — an id
      // the server refused is an id this surface must not echo back.
      .catch(() =>
        setPackNotice("That workflow could not be started. Check Past chats before trying again."),
      )
      .finally(() => {
        setSending(false);
        setStartingPack(null);
      });
  };

  // 27-11: THE OWNER'S CANDIDATE PREVIEW, and the only surface that may send `previewVersion`.
  //
  // Skipped entirely for a non-owner — `listPackCandidates` is an `ownerQuery` and would throw, so
  // the `isOwner ? {} : "skip"` idiom (the same one `FinanceView` uses for its owner-only reads) is
  // what keeps the workspace working for everybody else. The server check is the real one; this is
  // only about not asking a question the caller is not allowed to ask.
  //
  // The version comes FROM THE CARD the owner is looking at, so the run pins the exact row that was
  // shown. Without that pin a preview would run whatever the newest candidate happened to be by the
  // time the click landed — and the browser evidence would name a version nobody watched.
  const viewer = useQuery(api.owner.viewer, {});
  const packCandidates = useQuery(
    api.workflowPackDiscovery.listPackCandidates,
    viewer?.isOwner === true ? {} : "skip",
  );
  const onPreviewPack = (packId: string) => {
    const pack = packCandidates?.find((p) => p.packId === packId);
    if (pack === undefined || sending || startingPack !== null) return;
    setPackNotice(null);
    setSending(true);
    setStartingPack(packId);
    void startPack({ packId, text: pack.opener, previewVersion: pack.version })
      .then((res) => openThread(res.threadId, pack.title))
      .catch(() =>
        setPackNotice("That workflow could not be started. Check Past chats before trying again."),
      )
      .finally(() => {
        setSending(false);
        setStartingPack(null);
      });
  };

  // 27-11: THE UNDO PATH. `skills.deactivatePack` is an `ownerMutation` and the CLI cannot call it
  // (`convex run` carries no identity, and on this stack it also destroys the browser session), so
  // until there was a control here rollback-to-dark was proven by nothing. Owner-only by the same
  // rule as the preview: the mutation is the real check, the conditional render is only about not
  // showing a button that would refuse.
  const deactivatePack = useMutation(api.skills.deactivatePack);
  // ROLLBACK TO A PRIOR VERSION. `activateCandidate` is the same owner mutation the ops panel uses;
  // `planGlobalActivation` gates on `status === "candidate"`, so an ARCHIVED row — one that was live
  // before — goes back without re-running the evidence planes. That exemption is deliberate:
  // rollback must work mid-incident and must never be blocked by a broken eval or browser harness.
  const activatePackVersion = useMutation(api.skills.activateCandidate);
  const packPriorVersions = useQuery(
    api.workflowPackDiscovery.listPackPriorVersions,
    viewer?.isOwner === true ? {} : "skip",
  );
  const onRollBackPack = (packId: string, title: string, version: number) => {
    if (sending || turningOff !== null) return;
    setPackNotice(null);
    setTurningOff(packId);
    void activatePackVersion({ name: `pack-${packId}`, version })
      .then(() => setPackNotice(`${title} is back on v${version}.`))
      .catch(() =>
        setPackNotice(
          "That workflow could not be rolled back. Refresh to check its current status before trying again.",
        ),
      )
      .finally(() => setTurningOff(null));
  };
  const [turningOff, setTurningOff] = useState<string | null>(null);
  const onTurnOffPack = (packId: string, title: string) => {
    if (sending || turningOff !== null) return;
    setPackNotice(null);
    setTurningOff(packId);
    void deactivatePack({ name: `pack-${packId}` })
      .then(() => setPackNotice(`${title} is off. Nobody is offered it now.`))
      .catch(() =>
        setPackNotice(
          "That workflow could not be turned off. Refresh to check its current status before trying again.",
        ),
      )
      .finally(() => setTurningOff(null));
  };

  return (
    <div
      style={{
        padding: "clamp(1rem, 3vw, 2rem)",
        maxWidth: "72rem",
        margin: "0 auto",
        display: "grid",
        gap: "1.25rem",
      }}
    >
      <header>
        <p className="caps-label" style={{ margin: 0 }}>
          Your business toolkit
        </p>
        <h1 style={{ margin: "0.25rem 0", color: "var(--ink)" }}>Skills and Workflows</h1>
        <p style={{ margin: 0, color: "var(--ink-soft)" }}>
          Start a guided workflow or review your business skills.
        </p>
      </header>
      <div
        role="tablist"
        aria-label="Skills and workflows"
        style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
      >
        {tabs.map((tab) => (
          <button
            key={tab}
            id={`${tab}-tab`}
            role="tab"
            type="button"
            aria-selected={section === tab}
            tabIndex={section === tab ? 0 : -1}
            aria-controls={`${tab}-panel`}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next =
                tabs[
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : (tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                        tabs.length
                ] ?? "workflows";
              setSection(next);
              event.currentTarget.parentElement
                ?.querySelector<HTMLButtonElement>(`#${next}-tab`)
                ?.focus();
            }}
            onClick={() => setSection(tab)}
            className="composer-pill"
            style={{
              minHeight: 44,
              padding: "0.5rem 1rem",
              fontWeight: section === tab ? 700 : 400,
              background: section === tab ? "var(--teal-900)" : "var(--card)",
              color: section === tab ? "var(--card)" : "var(--ink)",
            }}
          >
            {tab === "workflows" ? "Workflows" : "Skills"}
          </button>
        ))}
      </div>
      <section
        id="workflows-panel"
        role="tabpanel"
        aria-labelledby="workflows-tab"
        hidden={section !== "workflows"}
      >
        <ErrorBoundary
          label="workflow-library"
          fallback={
            <p role="alert">Workflows could not be loaded. Refresh this page to try again.</p>
          }
        >
          <p style={{ color: "var(--ink-soft)", marginTop: 0 }}>
            Starting a workflow opens its own conversation in My Workspace. You review any proposed
            action before it runs.
          </p>
          {packs?.length === 0 && <p>No guided workflows are available yet.</p>}
          <WorkflowPackQuickStarts
            packs={packs}
            onStart={onStartPack}
            busy={sending || turningOff !== null}
            starting={startingPack}
          />
          {packNotice !== null && <p role="status">{packNotice}</p>}
          {viewer?.isOwner === true && (
            <details style={{ marginTop: "1.5rem" }}>
              <summary style={{ cursor: "pointer", minHeight: 44, alignContent: "center" }}>
                Review and manage workflows
              </summary>
              <WorkflowPackOwnerPreview
                candidates={packCandidates}
                onPreview={onPreviewPack}
                busy={sending || turningOff !== null}
                starting={startingPack}
              />
              <WorkflowPackOwnerControls
                packs={packs}
                priorVersions={packPriorVersions}
                onTurnOff={onTurnOffPack}
                onRollBack={onRollBackPack}
                busy={sending}
                turningOff={turningOff}
              />
            </details>
          )}
        </ErrorBoundary>
      </section>
      <section
        id="skills-panel"
        role="tabpanel"
        aria-labelledby="skills-tab"
        hidden={section !== "skills"}
      >
        <ErrorBoundary
          label="skill-library"
          fallback={<p role="alert">Skills could not be loaded. Refresh this page to try again.</p>}
        >
          <SkillAuthoringPanel canAuthor={viewer?.isOwner === true} />
          {viewer?.isOwner === true && (
            <p>
              <Link href="/ops">Review and restore skill versions</Link>
            </p>
          )}
        </ErrorBoundary>
      </section>
    </div>
  );
}
