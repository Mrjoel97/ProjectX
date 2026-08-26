"use client";

// 27-11: the OWNER's candidate preview, and the half of the deadlock breaker that was missing.
//
// WHY IT IS A SEPARATE COMPONENT AND A SEPARATE REGION. `WorkflowPackQuickStarts` renders what
// `listPacks` returns, which is ACTIVE-ONLY by construction, and its own header note rules out a
// "show candidates" prop — a filter in the browser is a filter a future caller can pass `false` to.
// The region is named differently on purpose too: the `@dark` browser assertions prove the pilot is
// invisible by requiring the "Guided workflows" region to be empty, and a preview that rendered
// into that region would make those assertions pass for a reason they do not mean.
//
// THE DEADLOCK. Activation needs browser evidence; browser evidence needs an authenticated person to
// reach the pack in a browser; nothing is active until the gate passes. `startWorkflowPack`'s
// owner-only `previewVersion` (27-09) let the owner RUN a candidate, but no surface let them SEE
// one — so the gate could not be satisfied by anyone. This is that surface.
//
// IT IS NOT A MARKETPLACE. No install, no enable, no tool grants, no activation control: a pack's
// capability is code-owned (`toolsForWorkflowPack`) and activation flows through the registry's
// three-plane gate, never a button here.

import type { PackSourceView } from "./WorkflowPackPreflight";
import { WorkflowPackPreflight } from "./WorkflowPackPreflight";

export type WorkflowPackCandidate = {
  packId: string;
  title: string;
  blurb: string;
  output: "briefing" | "document" | "draft_reply";
  /** The CANDIDATE's version. Sent back as `previewVersion` so the run pins the row shown. */
  version: number;
  sources: PackSourceView[];
  missingKnownCount: number;
  missingRuntimeCount: number;
};

export function WorkflowPackOwnerPreview({
  candidates,
  onPreview,
  busy,
  starting,
}: {
  candidates: readonly WorkflowPackCandidate[] | undefined;
  onPreview: (packId: string) => void;
  busy: boolean;
  starting?: string | null;
}) {
  // `undefined` is "not answered yet", and for a non-owner the query is skipped and stays undefined
  // forever — which must render nothing rather than a spinner nobody is waiting on.
  if (candidates === undefined || candidates.length === 0) return null;

  return (
    <section className="pack-candidates" aria-labelledby="pack-candidates-label">
      {/* BRAND §3: tracked caps is the signature section-label pattern. */}
      <h2
        id="pack-candidates-label"
        className="pack-candidates-label"
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontSize: "0.7rem",
          color: "var(--ink-soft)",
          margin: "0 0 0.5rem",
        }}
      >
        Candidate workflows — owner preview
      </h2>

      <p style={{ margin: "0 0 0.6rem", fontSize: "0.8rem", color: "var(--ink-soft)" }}>
        Not live. Only you can see these, and running one here is how a workflow earns the browser
        evidence it needs before anyone else is offered it.
      </p>

      <ul
        className="pack-candidate-grid"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: "0.6rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 16rem), 1fr))",
        }}
      >
        {candidates.map((pack) => {
          const isStarting = starting === pack.packId;
          return (
            <li key={pack.packId} className="pack-candidate">
              <article
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--rule)",
                  borderRadius: "0.6rem",
                  padding: "0.7rem 0.8rem",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.35rem",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}
                >
                  <h3 style={{ margin: 0, fontSize: "0.95rem", color: "var(--ink)" }}>
                    {pack.title}
                  </h3>
                  {/* BRAND §5 status pill, and §6: the state is carried by the WORD, never by the
                      colour alone. `--ink-soft` on `--paper`, not amber — `--held` belongs to the
                      approval gate and nothing else (§2). */}
                  <span
                    className="pack-candidate-badge"
                    style={{
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      fontSize: "0.6rem",
                      color: "var(--ink-soft)",
                      border: "1px solid var(--rule)",
                      borderRadius: "999px",
                      padding: "0.1rem 0.4rem",
                    }}
                  >
                    {`Candidate v${pack.version}`}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--ink-soft)" }}>
                  {pack.blurb}
                </p>

                <WorkflowPackPreflight sources={pack.sources} />

                <button
                  type="button"
                  className="pack-candidate-start"
                  aria-label={`Preview ${pack.title}`}
                  aria-busy={isStarting}
                  disabled={busy || isStarting}
                  onClick={() => onPreview(pack.packId)}
                  style={{
                    marginTop: "auto",
                    alignSelf: "flex-start",
                    background: "var(--teal-600)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "0.4rem",
                    padding: "0.35rem 0.7rem",
                    fontSize: "0.85rem",
                    cursor: busy || isStarting ? "default" : "pointer",
                  }}
                >
                  {isStarting ? "Starting…" : "Preview"}
                </button>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
