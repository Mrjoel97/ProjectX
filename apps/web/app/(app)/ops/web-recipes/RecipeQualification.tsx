"use client";

import { api } from "@pikar/backend/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef, useState } from "react";
import { inertRecipePreview } from "./preview";
import styles from "./qualification.module.css";

type Family = FunctionReturnType<typeof api.webRecipes.listQualificationCandidates>[number];
type Candidate = NonNullable<Family["candidate"]>;
type Viewport = "desktop" | "mobile";
const outcomes = ["selected", "partial", "refusal", "recovery", "edit", "preview"] as const;

export function OwnerQualificationLink() {
  const auth = useConvexAuth();
  const viewer = useQuery(api.owner.viewer, auth.isAuthenticated ? {} : "skip");
  return viewer?.isOwner === true ? (
    <a className={styles.entry} href="/ops?view=web-recipes">
      Recipe browser qualification →
    </a>
  ) : null;
}

/** Mount the owner subscriptions only after the native owner check succeeds. */
export default function RecipeQualification() {
  const auth = useConvexAuth();
  const viewer = useQuery(api.owner.viewer, auth.isAuthenticated ? {} : "skip");
  if (auth.isLoading) return <p role="status">Checking owner access…</p>;
  if (!auth.isAuthenticated) return <p>Recipe qualification is unavailable for this account.</p>;
  if (viewer === undefined) return <p role="status">Checking owner access…</p>;
  if (viewer?.isOwner !== true) return <p>Recipe qualification is unavailable for this account.</p>;
  return <CandidateWorkspace />;
}

function CandidateWorkspace() {
  const families = useQuery(api.webRecipes.listQualificationCandidates, {});
  const [selected, setSelected] = useState<string>("business-site");
  const family = families?.find((item) => item.recipeId === selected);
  const candidate = family?.candidate;
  return (
    <section className={styles.page} aria-labelledby="qualification-title">
      <header className={styles.header}>
        <div>
          <a href="/ops">← Operations</a>
          <h1 id="qualification-title">Recipe qualification</h1>
          <p>
            Observe this exact candidate in both browser sizes before independent runner review.
          </p>
        </div>
        <span className={styles.scope}>Owner workspace</span>
      </header>
      <label className={styles.choose}>
        Recipe
        <select value={selected} onChange={(event) => setSelected(event.target.value)}>
          {(families ?? []).map((item) => (
            <option key={item.recipeId} value={item.recipeId}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {!families ? (
        <p role="status">Loading current candidates…</p>
      ) : !candidate ? (
        <div className={styles.empty}>
          <h2>No pending candidate</h2>
          <p>
            This family has no candidate to qualify. Candidate seeding and evaluation remain
            separate operator steps.
          </p>
        </div>
      ) : (
        <CandidateRun
          key={`${candidate.id}:${candidate.version}:${candidate.bodyHash}:${candidate.definitionHash}:${candidate.bundleHash}:${candidate.rendererVersion}:${candidate.run?.runId ?? "none"}:${candidate.run?.ownedByViewer ?? false}`}
          candidate={candidate}
        />
      )}
      <p className={styles.footnote}>
        This workspace records a server transcript. It cannot issue passing browser evidence,
        activate a recipe, publish a site, or enable commerce.
      </p>
    </section>
  );
}

function CandidateRun({ candidate }: { candidate: Candidate }) {
  const begin = useMutation(api.skills.beginWebRecipeBrowserQualification);
  const advance = useMutation(api.skills.advanceWebRecipeBrowserQualification);
  const preview = useMutation(api.webRecipes.previewWebRecipeCandidate);
  const finalize = useMutation(api.skills.finalizeWebRecipeBrowserQualification);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [values, setValues] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [rendered, setRendered] = useState<{
    html: string;
    hash: string;
    runId: string;
    viewport: Viewport;
  } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const mounted = useRef(true);
  const alert = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    const resize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    resize();
    window.addEventListener("resize", resize);
    return () => {
      mounted.current = false;
      window.removeEventListener("resize", resize);
    };
  }, []);
  useEffect(() => {
    if (error) alert.current?.focus();
  }, [error]);
  const run = candidate.run;
  const owned = run?.ownedByViewer === true;
  const frozen = run?.finalizedHash != null;
  const lane = run?.lanes.find((item) => item.viewport === viewport);
  const next = outcomes[lane?.outcomes.length ?? 0];
  const complete = (["desktop", "mobile"] as const).every(
    (name) =>
      run?.lanes.find((item) => item.viewport === name)?.outcomes.join(",") === outcomes.join(","),
  );
  const nativeSizeMatches =
    size !== null && (viewport === "desktop" ? size.width >= 1024 : size.width <= 480);
  const canUseRun = candidate.current && owned && !frozen;
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage("");
    try {
      await action();
    } catch (cause) {
      if (mounted.current) {
        setRendered(null);
        setError(
          cause instanceof Error
            ? cause.message
            : "The request failed. Your inputs are retained; check the current run before retrying.",
        );
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const visiblePreview =
    rendered && rendered.runId === run?.runId && rendered.viewport === viewport ? rendered : null;
  return (
    <>
      <details className={styles.identity}>
        <summary>
          Candidate v{candidate.version} ·{" "}
          {candidate.current ? "Current definition" : "Stale definition — unavailable"}
        </summary>
        <dl>
          <dt>Candidate</dt>
          <dd>{candidate.id}</dd>
          <dt>Body hash</dt>
          <dd>{candidate.bodyHash}</dd>
          <dt>Definition hash</dt>
          <dd>{candidate.definitionHash ?? "Not current"}</dd>
          <dt>Bundle hash</dt>
          <dd>{candidate.bundleHash}</dd>
          <dt>Renderer</dt>
          <dd>{candidate.rendererVersion}</dd>
          <dt>Run</dt>
          <dd>{run?.runId ?? "Not started"}</dd>
          <dt>Protocol route</dt>
          <dd>/ops</dd>
        </dl>
        <p>
          Provenance: {candidate.provenanceReady ? "current" : "missing or stale"} · Evaluation:{" "}
          {candidate.evaluationReady ? "passing" : "missing or stale"} · Browser evidence:{" "}
          {candidate.browserReady ? "passing" : "not passing"}
        </p>
      </details>
      {error ? (
        <div className={styles.error} role="alert" tabIndex={-1} ref={alert}>
          <strong>Step not recorded</strong>
          <p>{error}</p>
          <p>Your inputs are retained. Check the current identity and revision before retrying.</p>
          <a href="#recipe-values">Review inputs</a>
        </div>
      ) : null}
      <div className={styles.runbar}>
        <div>
          <strong>
            {frozen
              ? "Awaiting independent runner review"
              : run
                ? `Run revision ${run.revision}`
                : "No current run"}
          </strong>
          <p>
            {candidate.staleRun
              ? "The previous run belongs to an older identity. Begin a new run."
              : run && !owned
                ? "Another owner started this run. Begin your own run to continue."
                : "A new run replaces the previous transcript and clears its browser evidence."}
          </p>
        </div>
        <button
          type="button"
          disabled={busy || !candidate.current}
          onClick={() =>
            void perform(async () => {
              await begin({ candidateId: candidate.id });
              if (mounted.current) {
                setRendered(null);
                setMessage("New server run started. Open a browser lane.");
              }
            })
          }
        >
          {run ? "Restart qualification" : "Begin qualification"}
        </button>
      </div>
      <div className={styles.workbench}>
        <div className={styles.protocol}>
          <h2>Browser protocol</h2>
          <fieldset className={styles.tabs} aria-label="Browser lane">
            {(["desktop", "mobile"] as const).map((name) => (
              <button
                type="button"
                key={name}
                aria-pressed={viewport === name}
                disabled={busy}
                onClick={() => setViewport(name)}
              >
                {name === "desktop" ? "Desktop" : "Mobile"} ·{" "}
                {run?.lanes.find((item) => item.viewport === name)?.outcomes.length ?? 0}/6
              </button>
            ))}
          </fieldset>
          <p className={styles.muted}>
            Observed browser: {size ? `${size.width} × ${size.height} px` : "measuring…"}.{" "}
            {viewport === "desktop"
              ? "Use a browser at least 1024 px wide."
              : "Resize the actual browser to 480 px or narrower."}
          </p>
          <ol className={styles.steps}>
            {outcomes.map((outcome, index) => (
              <li key={outcome} aria-current={next === outcome ? "step" : undefined}>
                <span>{index + 1}</span>
                {outcome}
                <small>
                  {lane?.outcomes.includes(outcome)
                    ? "Recorded"
                    : next === outcome
                      ? "Next"
                      : "Pending"}
                </small>
              </li>
            ))}
          </ol>
          {!lane ? (
            <button
              type="button"
              disabled={busy || !canUseRun || !nativeSizeMatches}
              onClick={() =>
                void perform(async () => {
                  if (!run) return;
                  await advance({
                    candidateId: candidate.id,
                    runId: run.runId,
                    revision: run.revision,
                    viewport,
                  });
                  if (mounted.current) setMessage(`${viewport} lane opened.`);
                })
              }
            >
              Open {viewport} lane
            </button>
          ) : null}
          <details className={styles.fields}>
            <summary>Recipe input requirements</summary>
            <ul>
              {candidate.fields.map((field) => (
                <li key={field.id}>
                  <code>{field.id}</code> · {field.label} ·{" "}
                  {field.required ? "required" : "optional"} · {field.type}
                </li>
              ))}
            </ul>
            <p className={styles.muted}>
              Text lists use arrays of strings. Catalogue items use objects with required{" "}
              <code>id</code>, <code>name</code> and <code>description</code> strings; optional{" "}
              <code>displayPriceText</code> and <code>availabilityLabel</code> remain presentation
              only. Design dials are numeric <code>variance</code>, <code>motion</code> and{" "}
              <code>density</code> from 1 to 10. Media requires prepared owned asset references;
              this observation preview disables image requests.
            </p>
          </details>
          <label className={styles.editor} htmlFor="recipe-values">
            Recipe inputs (JSON)
            <textarea
              id="recipe-values"
              value={values}
              spellCheck={false}
              onChange={(event) => setValues(event.target.value)}
              aria-describedby="recipe-input-help"
            />
          </label>
          <p id="recipe-input-help" className={styles.muted}>
            Partial: valid required fields, omit an optional field. Refusal: invalid input.
            Recovery: valid input. Edit: change rendered content. Preview: submit the unchanged edit
            again.
          </p>
          {lane && next ? (
            <button
              type="button"
              className={styles.primary}
              disabled={busy || !canUseRun || !nativeSizeMatches}
              onClick={() =>
                void perform(async () => {
                  if (!run) return;
                  const parsed: unknown = JSON.parse(values);
                  const result = await preview({
                    candidateId: candidate.id,
                    runId: run.runId,
                    revision: run.revision,
                    viewport,
                    values: parsed,
                  });
                  if (!mounted.current) return;
                  if (result.kind === "rendered")
                    setRendered({
                      html: inertRecipePreview(result.html),
                      hash: result.artifactHash,
                      runId: run.runId,
                      viewport,
                    });
                  else setRendered(null);
                  setMessage(`${result.outcome} recorded by the server.`);
                })
              }
            >
              {busy ? "Recording…" : `Record ${next}`}
            </button>
          ) : null}
          {complete && !frozen ? (
            <button
              type="button"
              className={styles.primary}
              disabled={busy || !canUseRun}
              onClick={() =>
                void perform(async () => {
                  if (!run) return;
                  const result = await finalize({
                    candidateId: candidate.id,
                    runId: run.runId,
                    revision: run.revision,
                  });
                  if (mounted.current)
                    setMessage(
                      `Awaiting independent runner review. Transcript ${result.transcriptHash}`,
                    );
                })
              }
            >
              Finalize for independent review
            </button>
          ) : null}
          {frozen ? (
            <p className={styles.receipt}>
              Frozen transcript: <code>{run.finalizedHash}</code>
            </p>
          ) : null}
          <p role="status" aria-live="polite" className={styles.status}>
            {message}
          </p>
        </div>
        <section className={styles.preview} aria-labelledby="preview-heading">
          <header>
            <h2 id="preview-heading">Rendered observation</h2>
            <span>{viewport === "desktop" ? "1024" : "390"} px frame</span>
          </header>
          {visiblePreview ? (
            <>
              <div className={styles.frameScroll}>
                <iframe
                  title={`${viewport} recipe observation`}
                  sandbox=""
                  referrerPolicy="no-referrer"
                  srcDoc={visiblePreview.html}
                  style={{ width: viewport === "desktop" ? 1024 : 390 }}
                />
              </div>
              <p className={styles.receipt}>
                Original artifact: <code>{visiblePreview.hash}</code>
              </p>
            </>
          ) : (
            <div className={styles.placeholder}>
              <h3>{frozen ? "Transcript frozen" : "The next rendered result appears here"}</h3>
              <p>
                {frozen
                  ? "Independent runner review is still required before browser evidence can pass."
                  : "Open a lane and record valid partial inputs to inspect the candidate."}
              </p>
            </div>
          )}
          <p className={styles.muted}>
            Inert preview: navigation, forms, scripts and image loading are disabled. Its
            presentation is isolated from the original artifact bytes. Frame sizing alone does not
            certify the native browser viewport.
          </p>
        </section>
      </div>
    </>
  );
}
