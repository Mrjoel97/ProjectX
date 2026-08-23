"use client";

// 27-09 (PACK-02/PACK-04): the curated knowledge-work quick starts.
//
// ACTIVE-ONLY, and that is the server's job, not this component's. `workflowPackDiscovery.listPacks`
// returns a pack only when its registry row is `active`; there is deliberately no "show candidates"
// prop here, because a filter in the browser is a filter a future caller can pass `false` to. The
// owner's candidate preview goes through `startWorkflowPack`'s server-checked `previewVersion`.
//
// WHAT THIS IS NOT. There is no marketplace, no install state, no enable/disable toggle, no tool
// picker and no grant UI. A pack's capability is code-owned (`toolsForWorkflowPack`) — a control
// here that appeared to widen it would be describing something the runtime cannot do.
//
// AND PACKS ARE LEAF AGENTS. `runAgentLoop` derives `grantDispatch` from `toolNames === undefined`
// and a pack always supplies an array, so a pack structurally cannot hand work to a specialist.
// Nothing here may imply otherwise — the blurbs are code-owned in `@pikar/core` and a test asserts
// none of them promises orchestration.

import type { PackSourceView } from "./WorkflowPackPreflight";
import { WorkflowPackPreflight } from "./WorkflowPackPreflight";

export type WorkflowPackOffer = {
  packId: string;
  title: string;
  blurb: string;
  output: "briefing" | "document" | "draft_reply";
  version: number;
  sources: PackSourceView[];
  missingKnownCount: number;
  missingRuntimeCount: number;
};

/** What the user gets back, in their words. Code-owned so six cards cannot each say it differently. */
const OUTPUT_PROMISE: Record<WorkflowPackOffer["output"], string> = {
  briefing: "Answers here in the chat",
  document: "Saves a document to your vault",
  draft_reply: "Drafts a reply for you to approve — nothing is sent",
};

export function WorkflowPackQuickStarts({
  packs,
  onStart,
  busy,
  starting,
}: {
  packs: readonly WorkflowPackOffer[] | undefined;
  onStart: (packId: string) => void;
  busy: boolean;
  starting?: string | null;
}) {
  // `undefined` is "the query has not answered", which is NOT the same as "there are none" — and
  // during the dark pilot the empty case is the normal one, so it must read as calm, not broken.
  if (packs === undefined) {
    return (
      <p className="pack-quickstarts-loading" style={{ color: "var(--ink-soft)", margin: 0 }}>
        Loading workflows…
      </p>
    );
  }
  if (packs.length === 0) return null;

  return (
    <section className="pack-quickstarts" aria-labelledby="pack-quickstarts-label">
      {/* BRAND §3: the tracked-caps section label is the signature pattern for titling a section. */}
      <h2
        id="pack-quickstarts-label"
        className="pack-quickstarts-label"
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontSize: "0.7rem",
          color: "var(--ink-soft)",
          margin: "0 0 0.5rem",
        }}
      >
        Guided workflows
      </h2>

      {/* Responsive with no breakpoint of its own: `auto-fit` + `minmax` collapses to one column on
          a narrow phone and spreads on a desktop, which is the BRAND §6 rule — the UAT matrix is
          desktop AND narrow mobile, and a hard media query is a second place to get that wrong. */}
      <ul
        className="pack-quickstart-grid"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: "0.6rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 16rem), 1fr))",
        }}
      >
        {packs.map((pack) => {
          const isStarting = starting === pack.packId;
          return (
            <li key={pack.packId} className="pack-quickstart">
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
                <h3 style={{ margin: 0, fontSize: "0.95rem", color: "var(--ink)" }}>
                  {pack.title}
                </h3>
                <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--ink-soft)" }}>
                  {pack.blurb}
                </p>
                {/* The output contract, stated before the run rather than discovered after it. */}
                <p
                  className="pack-quickstart-output"
                  style={{ margin: 0, fontSize: "0.8rem", color: "var(--ink-soft)" }}
                >
                  {OUTPUT_PROMISE[pack.output]}
                </p>

                <WorkflowPackPreflight sources={pack.sources} />

                <button
                  type="button"
                  className="pack-quickstart-start"
                  // The pack's own words, so a screen-reader user picking between six buttons hears
                  // which workflow each one starts rather than six identical "Start"s.
                  aria-label={`Start ${pack.title}`}
                  aria-busy={isStarting}
                  // One turn at a time: `busy` is the page's shared in-flight signal, so a quick
                  // start cannot race a typed message or a second quick start.
                  disabled={busy || isStarting}
                  onClick={() => onStart(pack.packId)}
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
                  {isStarting ? "Starting…" : "Start"}
                </button>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
