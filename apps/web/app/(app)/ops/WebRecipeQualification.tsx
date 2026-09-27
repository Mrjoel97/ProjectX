"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

type Row = {
  id: string;
  name: string;
  version: number;
  bodyHash: string;
  definitionHash: string;
  provenanceValid: boolean;
  evalValid: boolean;
  browserValid: boolean;
};
type Group = { name: string; candidate: Row | null; active: Row | null; rollbackTargets: Row[] };
type Viewport = "desktop" | "mobile";
type Run = { candidate: Row; runId: string; revision: number; lane: Record<Viewport, number> };
type Rendered = {
  kind: "rendered";
  outcome: string;
  revision: number;
  candidateId: string;
  bodyHash: string;
  inputHash: string;
  documentHash: string;
  artifactHash: string;
  html: string;
  byteLength: number;
};
type Preview = Rendered | { kind: "refusal"; revision: number; inputHash: string };
const outcomes = ["selected", "partial", "refusal", "recovery", "edit", "preview"] as const;
const ownerApi = api as unknown as {
  skills: Record<string, unknown>;
  webRecipes: Record<string, unknown>;
};

export function WebRecipeQualification() {
  const groups = useQuery(api.skills.webRecipeCandidatesForReview, {}) as Group[] | undefined;
  const activate = useMutation(api.skills.activateWebRecipeCandidate);
  const rollback = useMutation(api.skills.rollbackWebRecipe);
  const begin = useMutation(
    ownerApi.skills.beginWebRecipeBrowserQualification as never,
  ) as unknown as (args: { candidateId: string }) => Promise<{ runId: string; revision: number }>;
  const openLane = useMutation(
    ownerApi.skills.advanceWebRecipeBrowserQualification as never,
  ) as unknown as (args: {
    candidateId: string;
    runId: string;
    revision: number;
    viewport: Viewport;
  }) => Promise<{ revision: number }>;
  const preview = useMutation(
    ownerApi.webRecipes.previewWebRecipeCandidate as never,
  ) as unknown as (args: {
    candidateId: string;
    runId: string;
    revision: number;
    viewport: Viewport;
    values: Record<string, unknown>;
  }) => Promise<Preview>;
  const finalize = useMutation(
    ownerApi.skills.finalizeWebRecipeBrowserQualification as never,
  ) as unknown as (args: {
    candidateId: string;
    runId: string;
    revision: number;
  }) => Promise<{ transcriptHash: string }>;
  const qualifyStorefront = useMutation(
    ownerApi.webRecipes.qualifyStorefront as never,
  ) as unknown as (args: {
    recipeId: "storefront-catalogue";
    values: Record<string, unknown>;
    slug: string;
    title: string;
    expectedAvailability: "private_qualification";
  }) => Promise<{ projectId: string }>;
  const [run, setRun] = useState<Run | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [brandName, setBrandName] = useState("");
  const [headline, setHeadline] = useState("");
  const [intro, setIntro] = useState("");
  const [privateSlug, setPrivateSlug] = useState("phase49-private-catalogue");
  const [privateId, setPrivateId] = useState<string | null>(null);
  const privateReadback = useQuery(
    ownerApi.webRecipes.getStorefrontQualification as never,
    privateId ? ({ projectId: privateId } as never) : "skip",
  ) as
    | {
        project: { _id: string };
        version: { contentHash: string; recipeRef: { version: number; bodyHash: string } };
      }
    | null
    | undefined;
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [awaitingRunner, setAwaitingRunner] = useState(false);
  const visibleGroups = groups?.filter((g) => g.candidate || g.active || g.rollbackTargets.length);
  const unfinishedLane =
    run && viewport && run.lane[viewport] > 0 && run.lane[viewport] < outcomes.length
      ? viewport
      : null;
  const action = async (task: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await task();
    } catch (error) {
      setNotice(error instanceof Error ? `Action refused: ${error.message}` : "Action refused.");
    } finally {
      setBusy(false);
    }
  };
  const family = run?.candidate.name.replace("web-recipe-", "");
  const valuesFor = (mode: string): Record<string, unknown> => {
    const brand = mode === "refusal" ? "<script>refused</script>" : brandName.trim();
    const design = { variance: 5, motion: 3, density: 5 };
    if (family === "storefront-catalogue")
      return {
        brandName: brand,
        ...(mode === "partial"
          ? {}
          : { intro: intro.trim() || "A private catalogue qualification." }),
        items: [{ id: "item-1", name: "Catalogue item", description: "Qualification-only item." }],
        design,
      };
    if (family === "campaign-landing")
      return {
        brandName: brand,
        headline: headline.trim(),
        ...(mode === "partial"
          ? {}
          : {
              offer: "A bounded qualification offer.",
              ctaLabel: "Learn more",
              ctaPath: "/learn-more",
            }),
        design,
      };
    return {
      brandName: brand,
      headline: headline.trim(),
      ...(mode === "partial" ? {} : { summary: "A bounded qualification summary." }),
      design,
    };
  };
  const start = (candidate: Row) =>
    void action(async () => {
      const result = await begin({ candidateId: candidate.id });
      setRun({
        candidate,
        runId: result.runId,
        revision: result.revision,
        lane: { desktop: 0, mobile: 0 },
      });
      setViewport(null);
      setRendered(null);
      setAwaitingRunner(false);
      setBrandName(`Phase 49 ${candidate.name.replace("web-recipe-", "")}`);
      setHeadline("A bounded rendered qualification preview");
      setIntro("A private qualification-only catalogue.");
      setNotice(`Selected exact ${candidate.name} v${candidate.version}; run ${result.runId}.`);
    });
  const selectLane = (chosen: Viewport) => {
    if (!run) return;
    void action(async () => {
      const result = await openLane({
        candidateId: run.candidate.id,
        runId: run.runId,
        revision: run.revision,
        viewport: chosen,
      });
      setRun({ ...run, revision: result.revision, lane: { ...run.lane, [chosen]: 1 } });
      setViewport(chosen);
      setRendered(null);
      setNotice(`${chosen} lane opened; runner must verify actual browser width.`);
    });
  };
  const renderNext = () => {
    if (!run || !viewport) return;
    const mode = outcomes[run.lane[viewport]];
    if (!mode || mode === "selected") return;
    void action(async () => {
      const result = await preview({
        candidateId: run.candidate.id,
        runId: run.runId,
        revision: run.revision,
        viewport,
        values: valuesFor(mode),
      });
      setRun({
        ...run,
        revision: result.revision,
        lane: { ...run.lane, [viewport]: run.lane[viewport] + 1 },
      });
      if (result.kind === "refusal") {
        setRendered(null);
        setNotice(`Bounded input refusal observed in ${viewport}.`);
      } else {
        setRendered(result);
        setNotice(`${result.outcome} rendered in ${viewport}; document ${result.documentHash}.`);
      }
    });
  };
  const finish = () => {
    if (!run) return;
    void action(async () => {
      const result = await finalize({
        candidateId: run.candidate.id,
        runId: run.runId,
        revision: run.revision,
      });
      setAwaitingRunner(true);
      setNotice(`Transcript ${result.transcriptHash} frozen; awaiting trusted runner review.`);
    });
  };
  return (
    <section
      aria-labelledby="web-recipe-qualification-heading"
      style={{ display: "grid", gap: 16 }}
    >
      <div>
        <p className="caps-label">Owner qualification</p>
        <h2 id="web-recipe-qualification-heading">Web recipe candidates</h2>
        <p>Exact candidate review. Browser evidence follows a separate runner review.</p>
      </div>
      {notice && (
        <p role="status" aria-live="polite">
          {notice}
        </p>
      )}
      {groups === undefined ? (
        <p role="status">Loading candidate evidence…</p>
      ) : visibleGroups?.length === 0 ? (
        <p role="status">No web recipe candidates or active versions are available for review.</p>
      ) : (
        visibleGroups?.map((group) => (
          <article
            key={group.name}
            aria-label={group.name}
            style={{
              background: "var(--card)",
              border: "1px solid var(--rule)",
              borderRadius: 16,
              padding: 16,
              display: "grid",
              gap: 8,
            }}
          >
            <strong>{group.name}</strong>
            <span>
              Candidate version {group.candidate?.version ?? "none"} · active version{" "}
              {group.active?.version ?? "none"}
            </span>
            {group.candidate && (
              <section aria-label={`Evidence planes for ${group.name}`}>
                <div data-testid={`recipe-candidate-${group.candidate.id}`}>
                  Exact row {group.candidate.id} · {group.name} v{group.candidate.version}
                </div>
                <div data-testid={`recipe-body-hash-${group.candidate.id}`}>
                  Body hash {group.candidate.bodyHash} · definition {group.candidate.definitionHash}
                </div>
                <div>
                  {
                    [
                      group.candidate.provenanceValid,
                      group.candidate.evalValid,
                      group.candidate.browserValid,
                    ].filter(Boolean).length
                  }{" "}
                  of 3 evidence planes pass
                </div>
              </section>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {group.candidate && (
                <>
                  <button type="button" disabled={busy} onClick={() => start(group.candidate!)}>
                    Start rendered candidate qualification
                  </button>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !group.candidate.provenanceValid ||
                      !group.candidate.evalValid ||
                      !group.candidate.browserValid
                    }
                    onClick={() =>
                      void action(async () => {
                        await activate({ candidateId: group.candidate!.id as never });
                        setNotice(
                          "Candidate activation completed for the exact server-returned row.",
                        );
                      })
                    }
                  >
                    Activate exact candidate
                  </button>
                </>
              )}
              {group.rollbackTargets.map((target) => (
                <button
                  type="button"
                  key={target.id}
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await rollback({ targetId: target.id as never });
                      setNotice(`Rolled back to exact eligible version ${target.version}.`);
                    })
                  }
                >
                  Roll back to v{target.version}
                </button>
              ))}
            </div>
            {group.name === "web-recipe-storefront-catalogue" && group.active && (
              <section
                aria-label="Private storefront qualification"
                style={{ display: "grid", gap: 8 }}
              >
                <strong>Private storefront artifact</strong>
                <p>
                  Commerce unavailable. This project stays outside ordinary discovery and anonymous
                  serving.
                </p>
                <label>
                  Private storefront slug
                  <input
                    aria-label="Private storefront slug"
                    value={privateSlug}
                    onChange={(e) => setPrivateSlug(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const result = await qualifyStorefront({
                        recipeId: "storefront-catalogue",
                        slug: privateSlug,
                        title: "Private catalogue",
                        expectedAvailability: "private_qualification",
                        values: {
                          brandName: brandName.trim() || "Private catalogue",
                          intro: intro.trim() || "Private catalogue qualification.",
                          items: [
                            {
                              id: "item-1",
                              name: "Catalogue item",
                              description: "Qualification-only item.",
                            },
                          ],
                          design: { variance: 5, motion: 3, density: 5 },
                        },
                      });
                      setPrivateId(result.projectId);
                      setNotice(`Private storefront artifact ${result.projectId} created.`);
                    })
                  }
                >
                  Create private storefront artifact
                </button>
                {privateReadback?.version && (
                  <p data-testid="storefront-readback">
                    Readback {privateReadback.project._id} · v
                    {privateReadback.version.recipeRef.version} · body{" "}
                    {privateReadback.version.recipeRef.bodyHash} · content{" "}
                    {privateReadback.version.contentHash}
                  </p>
                )}
              </section>
            )}
            {run !== null && run.candidate.id === group.candidate?.id && (
              <section
                aria-label="Rendered exact candidate run"
                style={{
                  display: "grid",
                  gap: 8,
                  borderTop: "1px solid var(--rule)",
                  paddingTop: 12,
                }}
              >
                <strong>Rendered exact candidate run</strong>
                <code>Run {run!.runId}</code>
                <label>
                  Candidate brand name
                  <input
                    aria-label="Candidate brand name"
                    maxLength={128}
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                  />
                </label>
                {family === "storefront-catalogue" ? (
                  <label>
                    Candidate introduction
                    <textarea
                      aria-label="Candidate introduction"
                      maxLength={4000}
                      value={intro}
                      onChange={(e) => setIntro(e.target.value)}
                    />
                  </label>
                ) : (
                  <label>
                    Candidate headline
                    <input
                      aria-label="Candidate headline"
                      maxLength={240}
                      value={headline}
                      onChange={(e) => setHeadline(e.target.value)}
                    />
                  </label>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  {(["desktop", "mobile"] as const).map((choice) => (
                    <button
                      type="button"
                      key={choice}
                      disabled={
                        busy ||
                        run!.lane[choice] > 0 ||
                        awaitingRunner ||
                        (unfinishedLane !== null && unfinishedLane !== choice)
                      }
                      onClick={() => selectLane(choice)}
                    >
                      Open {choice} lane
                    </button>
                  ))}
                </div>
                {unfinishedLane && (
                  <p>Finish the {unfinishedLane} lane before opening the other viewport.</p>
                )}
                {viewport && (
                  <p>
                    Selected lane: {viewport}. Next server observation:{" "}
                    {outcomes[run!.lane[viewport]] ?? "complete"}.
                  </p>
                )}
                {viewport && run!.lane[viewport] > 0 && run!.lane[viewport] < outcomes.length && (
                  <button type="button" disabled={busy || awaitingRunner} onClick={renderNext}>
                    {
                      (
                        {
                          partial: "Try allowed partial",
                          refusal: "Try bounded refusal",
                          recovery: "Render recovery",
                          edit: "Render changed edit",
                          preview: "Preview and read back exact document",
                        } as Record<string, string>
                      )[outcomes[run!.lane[viewport]]!]
                    }
                  </button>
                )}
                {rendered && (
                  <>
                    <p data-testid="recipe-preview-readback">
                      Readback exact row {rendered.candidateId} · body {rendered.bodyHash} ·
                      document {rendered.documentHash} · artifact {rendered.artifactHash} ·{" "}
                      {rendered.byteLength} bytes. Commerce unavailable; qualification-only.
                    </p>
                    <iframe
                      title="Read-only recipe preview"
                      sandbox=""
                      srcDoc={rendered.html}
                      style={{ width: "100%", minHeight: 480, border: "1px solid var(--rule)" }}
                    />
                  </>
                )}
                <p>
                  Observed lanes: desktop {run!.lane.desktop}/{outcomes.length}, mobile{" "}
                  {run!.lane.mobile}/{outcomes.length}.
                </p>
                <button
                  type="button"
                  disabled={
                    busy ||
                    awaitingRunner ||
                    run!.lane.desktop !== outcomes.length ||
                    run!.lane.mobile !== outcomes.length
                  }
                  onClick={finish}
                >
                  Finalize owner transcript
                </button>
                {awaitingRunner && (
                  <p>
                    Awaiting trusted runner review. Activation remains unavailable until browser
                    evidence is issued.
                  </p>
                )}
              </section>
            )}
          </article>
        ))
      )}
    </section>
  );
}
