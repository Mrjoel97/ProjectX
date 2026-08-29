"use client";

import { api } from "@pikar/backend/api";
// The gap sentence, the citation mapping and the source vocabulary are CODE in `@pikar/core`,
// imported rather than restated. A second copy of "your mailbox is not connected yet" in this file
// is how a backend state and the sentence describing it drift apart.
import {
  aggregateCoverage,
  groundedSourceProps,
  PACK_SOURCE_LABEL,
  renderSourceGap,
} from "@pikar/core";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { GroundedSources } from "./cards";

// KNOW-01: the user's ONE unified-search surface. It asks `knowledgeSearch.search` a bounded
// question and renders the stored, cited answer back — with every source's state visible.
//
// WHAT IT IS NOT:
//  - not a second door into the agent. There is no mutation, no cockpit send and no tool grant
//    here; the coordinator has no tool loop, so evidence containing an instruction cannot make
//    anything happen. `knowledgeSearch.test.ts` proves the acting planes stay empty across a run
//    whose evidence carries a prompt injection.
//  - not a place that invents a denominator. `KnowledgeSearchPanel.test.ts` asserts that a partial
//    read renders "only the first 3 results were read" and NOT "of 3".
//  - not a vault browser. Only a `vault` citation becomes a `VaultDocButton` — `groundedSourceProps`
//    is what separates them, because a Gmail message id or a Drive file id handed to `docIds` would
//    open a vault-document modal for something that is not a vault document. Non-vault citations are
//    still shown, as `Citation` rows carrying their own source label — pinned by the tests
//    "a citation names the SYSTEM it came from" and "a mailbox citation is NOT a vault document
//    button".
//
// Rendered inline in the chat pane from the existing "Chat options" menu, like
// `SkillAuthoringPanel` — no new route and no nav entry (BRAND §4: the cockpit is two panes).

/** The stored row, as `listByThread` returns it. Derived, so a backend shape change breaks here. */
export type KnowledgeSearchRow = FunctionReturnType<
  typeof api.knowledgeSearch.listByThread
>[number];

type SearchOutcome = FunctionReturnType<typeof api.knowledgeSearch.search>;
/** The coordinator's closed refusal union. A new reason fails `REFUSAL_COPY` at compile time. */
export type SearchRefusalReason = Extract<SearchOutcome, { ok: false }>["reason"];

type StoredClaim = KnowledgeSearchRow["claims"][number];
type StoredCitation = StoredClaim["evidence"][number];

// ── Copy. Closed records over code-owned vocabularies, so a new label cannot ship unworded. ──

const CONFIDENCE_COPY: Readonly<Record<KnowledgeSearchRow["confidence"], string>> = {
  high: "High confidence — several sources agree and every source answered.",
  medium: "Medium confidence — something is missing, old, weakly sourced or disputed.",
  low: "Low confidence — this rests on a single source.",
  unsupported: "Not supported — nothing was found that could back an answer.",
};

const AUTHORITY_COPY: Readonly<Record<StoredCitation["authority"], string>> = {
  tenant_owned: "Your own document or file",
  system_of_record: "A system that owns this fact",
  correspondence: "Something someone said, not a record",
  third_party_research: "Material you did not write",
  // The provenance-laundering door, stated to the reader rather than only closed in code.
  agent_authored: "Written by your assistant, not by you",
};

const FRESHNESS_COPY: Readonly<Record<StoredCitation["freshness"], string>> = {
  current: "Updated in the last month",
  recent: "Updated in the last year",
  stale: "Over a year old",
  unknown: "No date on the source",
};

const REFUSAL_COPY: Readonly<Record<SearchRefusalReason, string>> = {
  kill_switch: "Search is paused for this workspace right now.",
  // No apostrophes in this record on purpose: these strings are asserted against the RENDERED
  // markup, where React escapes `'` to `&#x27;` and an assertion would silently be about escaping
  // rather than about the words.
  daily_budget_exhausted: "The daily AI budget is used up, so this search did not run.",
  deployment_budget_exhausted: "The Pikar-wide AI budget is used up, so this search did not run.",
  question_too_long: "That question is too long to search. Shorten it and try again.",
  // Not the user's question's fault, and it must not read as if it were.
  thread_id_invalid: "This conversation could not be identified, so nothing was searched.",
};

/**
 * THE PAIR THIS FEATURE EXISTS FOR. "We looked and there is nothing" and "we could not look" are
 * different answers and must read differently. The discriminator is whether ANY source was read:
 * an `unavailable` state carries no count by construction, so a source that is not `unavailable`
 * is one that answered — even when it answered with zero rows.
 */
const NOTHING_FOUND = "The sources that were searched had nothing on this.";
const NOTHING_SEARCHED = "None of your sources could be searched, so there is no answer to give.";

// ── Styles (BRAND tokens only — never a hex a token covers) ─────────────────────────────────

const card = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: "0.75rem",
  padding: "1rem",
  display: "flex",
  flexDirection: "column" as const,
  gap: "0.6rem",
};
const dim = { margin: 0, fontSize: "0.8rem", color: "var(--ink-soft)" } as const;
const body = { margin: 0, fontSize: "0.9rem", color: "var(--ink)" } as const;

/** A governed stop, or a trust-boundary refusal. Announced, and never drawn as an empty answer. */
export function SearchRefusal({ reason }: { reason: SearchRefusalReason }) {
  return (
    <p role="status" style={{ ...body, color: "var(--held-text)" }} data-testid="knowledge-refusal">
      {REFUSAL_COPY[reason]}
    </p>
  );
}

function Citation({ citation }: { citation: StoredCitation }) {
  return (
    <li style={{ ...dim, listStyle: "none" }} data-testid="knowledge-citation">
      <span style={{ color: "var(--ink)", fontWeight: 600 }}>{citation.label}</span>
      {" — "}
      {PACK_SOURCE_LABEL[citation.source]} · {AUTHORITY_COPY[citation.authority]} ·{" "}
      {FRESHNESS_COPY[citation.freshness]}
    </li>
  );
}

function Claim({ claim }: { claim: StoredClaim }) {
  // Vault rows also get the landed drill-in. Only vault refs reach `docIds` — a Gmail message
  // id there would render a clickable vault-document modal for something that is not one.
  const grounded = groundedSourceProps(claim.evidence);
  return (
    <div
      style={{ borderTop: "1px solid var(--rule)", paddingTop: "0.6rem" }}
      data-testid="knowledge-claim"
    >
      <p style={body}>{claim.text}</p>
      {claim.excerpt !== undefined && (
        <blockquote
          style={{
            ...dim,
            margin: "0.4rem 0 0",
            paddingLeft: "0.7rem",
            borderLeft: "2px solid var(--rule)",
            fontStyle: "italic",
          }}
        >
          {claim.excerpt}
        </blockquote>
      )}
      {grounded.count > 0 && <GroundedSources titles={grounded.titles} docIds={grounded.docIds} />}
      {/* EVERY citation, vault included. The block above is "documents you can open"; this is
          "where it came from and how much to trust it" — and the vault is exactly where an
          agent-promoted document lives, so dropping vault rows here would hide the one authority
          class this feature added (`agent_authored`) on the one source that can carry it. */}
      {claim.evidence.length > 0 && (
        <ul style={{ margin: "0.4rem 0 0", padding: 0, display: "grid", gap: "0.2rem" }}>
          {claim.evidence.map((row) => (
            <Citation key={`${row.source}:${row.sourceRef}`} citation={row} />
          ))}
        </ul>
      )}
      {claim.conflictEvidence.length > 0 && (
        <div style={{ marginTop: "0.4rem" }} data-testid="knowledge-conflict">
          {/* The disagreement is shown, not resolved: `dedupeEvidence` kept both readings and a
              panel that picked one would undo that in the last inch. */}
          <p style={{ ...dim, fontWeight: 600, color: "var(--ink)" }}>
            Another source disagrees with this
          </p>
          <ul style={{ margin: "0.2rem 0 0", padding: 0, display: "grid", gap: "0.2rem" }}>
            {claim.conflictEvidence.map((row) => (
              <li key={`${row.source}:${row.sourceRef}`} style={{ ...dim, listStyle: "none" }}>
                <span style={{ color: "var(--ink)", fontWeight: 600 }}>{row.label}</span>
                {" — "}
                {PACK_SOURCE_LABEL[row.source]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One stored answer, rendered whole. Pure — no hooks, no provider, no network. */
export function KnowledgeSearchResult({ row }: { row: KnowledgeSearchRow }) {
  // DERIVED FROM WHAT THE ROW CARRIES, never from the summary string. The synthesis JSON schema
  // puts no minimum length on `summary` (`knowledgeLlm.ts`) and the coordinator stores it trimmed
  // and unguarded, so a model that answers only in claims produces a row with citation-checked
  // claims and a blank summary — and reading `summary.length` there printed "the sources that were
  // searched had nothing on this" directly above the evidence it was rendering.
  const answered = row.claims.length > 0 || row.summary.trim().length > 0;
  // The "we looked and there is nothing" / "we could not look" split is @pikar/core's
  // `aggregateCoverage`, not a second copy of the rule here.
  const coverage = aggregateCoverage(row.sources);
  const readSomething = coverage.available + coverage.partial > 0;
  return (
    <article
      style={{ display: "grid", gap: "0.5rem" }}
      aria-label="Search result"
      data-testid="knowledge-answer"
    >
      <p className="caps-label" style={{ margin: 0 }}>
        {row.question}
      </p>
      {answered ? (
        <>
          {row.summary.trim().length > 0 && <p style={body}>{row.summary}</p>}
          <p style={dim} data-testid="knowledge-confidence">
            {CONFIDENCE_COPY[row.confidence]}
          </p>
        </>
      ) : (
        <p style={body} data-testid="knowledge-empty">
          {readSomething ? NOTHING_FOUND : NOTHING_SEARCHED}
        </p>
      )}

      {row.claims.map((claim) => (
        <Claim key={claim.text} claim={claim} />
      ))}

      {row.unanswered.length > 0 && (
        <div data-testid="knowledge-unanswered">
          <p style={{ ...dim, fontWeight: 600, color: "var(--ink)" }}>Not answered</p>
          <ul style={{ margin: "0.2rem 0 0", paddingLeft: "1.1rem" }}>
            {row.unanswered.map((item) => (
              <li key={item} style={dim}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {row.unsupportedCount > 0 && (
        <p style={dim}>
          {row.unsupportedCount === 1
            ? "1 statement was dropped for citing nothing that was actually read."
            : `${row.unsupportedCount} statements were dropped for citing nothing that was actually read.`}
        </p>
      )}
      {row.invalidCitationCount > 0 && (
        <p style={dim}>
          {row.invalidCitationCount === 1
            ? "1 citation did not match any source that was read, and was removed."
            : `${row.invalidCitationCount} citations did not match any source that was read, and were removed.`}
        </p>
      )}

      {row.sources.length > 0 && (
        <div data-testid="knowledge-coverage">
          <p style={{ ...dim, fontWeight: 600, color: "var(--ink)" }}>Where this was searched</p>
          <ul style={{ margin: "0.2rem 0 0", padding: 0, display: "grid", gap: "0.2rem" }}>
            {row.sources.map((state) => {
              // `null` for an available source — the one function that decides whether a source
              // owes the reader a sentence, and it lives in @pikar/core.
              const gap = renderSourceGap(state);
              return (
                <li
                  key={state.source}
                  style={{ ...dim, listStyle: "none" }}
                  data-testid="knowledge-source-state"
                >
                  {gap ?? `${PACK_SOURCE_LABEL[state.source]} was searched in full.`}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </article>
  );
}

export function KnowledgeSearchPanel({
  threadId,
  onClose,
}: {
  threadId?: string;
  onClose: () => void;
}) {
  const runSearch = useAction(api.knowledgeSearch.search);
  // A search needs a thread to file itself under, and the workspace has none until the first
  // message is sent. Minted on submit rather than at mount: a `useState` initializer would run on
  // the server too and hydrate to a different id.
  const [ownThread, setOwnThread] = useState<string | null>(null);
  // OWN HANDLE FIRST. `threadId` is undefined on a fresh workspace and becomes the cockpit thread
  // the moment the user sends their first message; reading the prop first re-subscribed the panel
  // to that thread and the answers already on screen became unreadable — the rows stay in the DB
  // under the `ks_` handle and nothing could ever query them back.
  // ponytail: session-scoped. The panel unmounts on close (`page.tsx` renders it behind
  // `searching`), so `ownThread` lives only as long as the open card. Upgrade path if searches
  // should follow chat-tab switches: file them under the thread and add a thread picker here.
  const activeThread = ownThread ?? threadId ?? null;
  const rows = useQuery(
    api.knowledgeSearch.listByThread,
    activeThread === null ? "skip" : { threadId: activeThread },
  );

  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<SearchRefusalReason | null>(null);
  const [failed, setFailed] = useState(false);

  const submit = async () => {
    const asked = question.trim();
    if (asked.length === 0) return;
    // NO CLIENT-SIDE LENGTH CAP. The server owns `QUESTION_CHAR_CAP` and refuses as DATA;
    // duplicating the number here would drift, and truncating would answer a different question.
    const thread = activeThread ?? `ks_${crypto.randomUUID()}`;
    if (activeThread === null) setOwnThread(thread);
    setRefusal(null);
    setFailed(false);
    setBusy(true);
    try {
      const out = await runSearch({ threadId: thread, question: asked });
      if (!out.ok) setRefusal(out.reason);
      else setQuestion("");
    } catch {
      // The question never reaches an error string (CLAUDE.md §4) and a provider message never
      // reaches the reader.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={card} aria-label="Search everything you have connected">
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="caps-label" style={{ margin: 0 }}>
            Search your knowledge
          </p>
          <p style={dim}>
            Asks your vault, your Drive, your mailbox and your contact records at once, and shows
            you what each one could and could not answer.
          </p>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close knowledge search"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        style={{ display: "grid", gap: "0.4rem" }}
      >
        <label htmlFor="knowledge-search-question" style={{ fontSize: "0.8rem", fontWeight: 600 }}>
          What do you want to know?
        </label>
        <input
          id="knowledge-search-question"
          data-testid="knowledge-search-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
          placeholder="e.g. What did we agree the renewal price would be?"
          style={{
            padding: "0.5rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--rule)",
            background: "var(--card)",
            color: "var(--ink)",
            fontFamily: "inherit",
            fontSize: "0.9rem",
          }}
        />
        <button
          type="submit"
          className="cta-dark"
          data-testid="knowledge-search-submit"
          style={{
            margin: 0,
            padding: "0.55rem 1rem",
            fontSize: "0.85rem",
            border: "none",
            cursor: busy || question.trim().length === 0 ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            opacity: busy || question.trim().length === 0 ? 0.5 : 1,
          }}
          disabled={busy || question.trim().length === 0}
        >
          {busy ? "Searching…" : "Search"}
        </button>
      </form>

      {busy && (
        <p role="status" style={dim}>
          Searching your connected sources…
        </p>
      )}
      {refusal !== null && <SearchRefusal reason={refusal} />}
      {failed && (
        <p role="alert" style={{ ...body, color: "var(--held-text)" }}>
          That search could not be completed. Nothing was changed — try again.
        </p>
      )}

      {rows === undefined
        ? activeThread !== null && <p style={dim}>Loading…</p>
        : rows.map((row) => <KnowledgeSearchResult key={row._id} row={row} />)}
    </section>
  );
}
