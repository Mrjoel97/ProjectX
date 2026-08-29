// Phase 29 (KNOW-01) — WHAT THE USER ACTUALLY READS when a knowledge search comes back.
//
// FILE EXTENSION, DELIBERATELY `.test.ts` AND NOT `.test.tsx`. `apps/web/vitest.config.ts`
// includes `app/**/*.test.ts` only, and says so on purpose. A `KnowledgeSearchPanel.test.tsx`
// would have sat next to the component reading as coverage and executing NOWHERE — the exact
// failure that config was written to stop (`preflightCopy.test.ts`, 15.3-07). 29-09's plan names
// `.test.tsx`; the plan is wrong about this repo and the deviation is recorded in the summary.
//
// EVERY assertion below is over the STRING `renderToStaticMarkup` emits (the `groundedSources.test`
// idiom), never over a helper's return value and never over this file's own fixture. Expected
// sentences are LITERALS: if `renderSourceGap`'s copy changes, this file must change with it, which
// is the point — an oracle imported from the subject can never fail.
//
// WHAT IS *NOT* PROVEN HERE: pixels, focus order in a real browser, and the live action call. The
// container half (`KnowledgeSearchPanel`) needs a Convex provider and is covered by source scan
// plus `e2e/knowledge-search.spec.ts`, which is UNRUN — see `29-SEARCH-GATE.md`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  KnowledgeSearchResult,
  type KnowledgeSearchRow,
  SearchRefusal,
} from "./KnowledgeSearchPanel";

const here = dirname(fileURLToPath(import.meta.url));
const panelSource = readFileSync(join(here, "KnowledgeSearchPanel.tsx"), "utf8");
const pageSource = readFileSync(join(here, "page.tsx"), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

type Citation = {
  source: string;
  sourceRef: string;
  label: string;
  authority: string;
  freshness: string;
  sourceUpdatedAt?: number;
  retrievedAt: number;
};

const cite = (over: Partial<Citation> = {}): Citation => ({
  source: "vault",
  sourceRef: "doc_1",
  label: "Pricing sheet",
  authority: "tenant_owned",
  freshness: "current",
  retrievedAt: 1_700_000_000_000,
  ...over,
});

/** A stored row, shaped like the one `listByThread` returns. The CONTAINER is what binds this
 *  shape to the backend at compile time; this cast only keeps the fixture short. */
const row = (over: Record<string, unknown> = {}): KnowledgeSearchRow =>
  ({
    _id: "ks_1",
    _creationTime: 0,
    tenantId: "tenant_1",
    threadId: "thread_1",
    runId: "run_1",
    question: "What is our margin?",
    summary: "",
    confidence: "unsupported",
    sources: [],
    claims: [],
    unanswered: [],
    unsupportedCount: 0,
    invalidCitationCount: 0,
    createdAt: 1_700_000_000_000,
    ...over,
  }) as unknown as KnowledgeSearchRow;

const render = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(KnowledgeSearchResult, { row: row(over) }));

// ── 1. A source that could not be read never reads as an empty business ────────────────────

describe("a gap is a sentence, and it never says there was nothing", () => {
  test("a disconnected mailbox states why it was not searched", () => {
    const html = render({
      sources: [{ source: "inbox", status: "unavailable", reason: "not_connected" }],
    });
    expect(html).toContain("your mailbox is not connected yet, so it was not searched.");
    // The words this whole feature exists to keep off an unreachable source.
    expect(html).not.toContain("no results");
    expect(html).not.toContain("nothing");
  });

  test("a not-landed source names what would unlock it", () => {
    const html = render({
      sources: [{ source: "support-desk", status: "unavailable", reason: "not_landed" }],
    });
    expect(html).toContain(
      "your connected support inbox is not available in Pikar yet, so it was not searched. It would need connecting your support desk.",
    );
  });

  test("a partial read states how many results were read, not a total", () => {
    const html = render({
      sources: [{ source: "drive", status: "partial", returned: 3, reason: "cap" }],
    });
    expect(html).toContain(
      "your Google Drive was searched, but only the first 3 results were read",
    );
    // No fabricated denominator: the panel never claims to know how many there were.
    expect(html).not.toContain("of 3");
    expect(html).not.toMatch(/\b3 results found\b/);
  });

  test("a provider error is a gap, not an empty read", () => {
    const html = render({
      sources: [{ source: "inbox", status: "unavailable", reason: "provider_error" }],
    });
    expect(html).toContain("your mailbox returned an error, so it was not searched.");
  });

  test("a source that answered in full is stated too, so coverage is complete on the page", () => {
    const html = render({
      sources: [{ source: "vault", status: "available", returned: 2 }],
    });
    expect(html).toContain("your knowledge vault was searched in full");
    // …and an available source contributes no gap sentence.
    expect(html).not.toContain("was not searched");
  });
});

// ── 2. THE PAIR. "We looked and there is nothing" vs "we could not look" ───────────────────

describe("an empty answer and an unreachable one are DIFFERENT on the page", () => {
  const ALL_EMPTY = "The sources that were searched had nothing on this.";
  const ALL_UNAVAILABLE = "None of your sources could be searched, so there is no answer to give.";

  test("all-empty says the search happened", () => {
    const html = render({
      sources: [
        { source: "inbox", status: "available", returned: 0 },
        { source: "drive", status: "available", returned: 0 },
      ],
    });
    expect(html).toContain(ALL_EMPTY);
    expect(html).not.toContain(ALL_UNAVAILABLE);
  });

  test("all-unavailable says the search did NOT happen", () => {
    const html = render({
      sources: [
        { source: "inbox", status: "unavailable", reason: "not_connected" },
        { source: "drive", status: "unavailable", reason: "reauth" },
      ],
    });
    expect(html).toContain(ALL_UNAVAILABLE);
    expect(html).not.toContain(ALL_EMPTY);
  });

  test("one source that answered emptily beside one that could not be read is NOT all-unavailable", () => {
    // The mixed case: something WAS searched, so the honest sentence is the empty one, and the
    // unreachable source still gets its own gap line beside it.
    const html = render({
      sources: [
        { source: "vault", status: "available", returned: 0 },
        { source: "inbox", status: "unavailable", reason: "not_connected" },
      ],
    });
    expect(html).toContain(ALL_EMPTY);
    expect(html).not.toContain(ALL_UNAVAILABLE);
    expect(html).toContain("your mailbox is not connected yet, so it was not searched.");
  });

  test("a blank summary beside real claims is NOT 'the sources had nothing'", () => {
    // The synthesis schema puts no minimum on `summary`, so a model can answer only in claims.
    // Reading `summary.length` printed the all-empty sentence directly above the cited evidence.
    const html = render({
      summary: "",
      confidence: "high",
      sources: [{ source: "vault", status: "available", returned: 2 }],
      claims: [
        {
          text: "The renewal price is $40.",
          evidence: [cite({ label: "Rate card", sourceRef: "doc_4" })],
          conflictEvidence: [],
        },
      ],
    });
    expect(html).toContain("The renewal price is $40.");
    expect(html).not.toContain(ALL_EMPTY);
    expect(html).not.toContain(ALL_UNAVAILABLE);
    // …and the reader still gets the trust label, which the old branch suppressed too.
    expect(html).toContain("High confidence — several sources agree and every source answered.");
  });

  test("a blank summary with no claims still says the sources were searched and empty", () => {
    const html = render({
      summary: "",
      sources: [{ source: "vault", status: "available", returned: 0 }],
      claims: [],
    });
    expect(html).toContain(ALL_EMPTY);
  });

  test("neither sentence appears once there is an answer", () => {
    const html = render({
      summary: "Margin is 40%.",
      confidence: "low",
      sources: [{ source: "vault", status: "available", returned: 1 }],
      claims: [{ text: "Margin is 40%.", evidence: [cite()], conflictEvidence: [] }],
    });
    expect(html).not.toContain(ALL_EMPTY);
    expect(html).not.toContain(ALL_UNAVAILABLE);
    expect(html).toContain("Margin is 40%.");
  });
});

// ── 3. Citations: a provider ref is never dressed as a vault document ──────────────────────

describe("citations drill in only where a drill-in exists", () => {
  test("a vault citation renders as the landed vault source control", () => {
    const html = render({
      summary: "s",
      claims: [
        {
          text: "Margin is 40%.",
          evidence: [cite({ label: "Pricing sheet", sourceRef: "doc_9" })],
          conflictEvidence: [],
        },
      ],
      sources: [{ source: "vault", status: "available", returned: 1 }],
    });
    // `GroundedSources` -> `VaultDocButton` — the landed shape, reached through `groundedSourceProps`.
    expect(html).toContain('data-testid="source-title"');
    expect(html).toContain("Pricing sheet");
  });

  test("a mailbox citation is NOT a vault document button", () => {
    const html = render({
      summary: "s",
      claims: [
        {
          text: "They asked about renewal.",
          evidence: [
            cite({
              source: "inbox",
              sourceRef: "msg_abc",
              label: "Re: renewal",
              authority: "correspondence",
            }),
          ],
          conflictEvidence: [],
        },
      ],
      sources: [{ source: "inbox", status: "available", returned: 1 }],
    });
    // The provenance is still shown — dropping it would be worse than a broken control …
    expect(html).toContain("Re: renewal");
    expect(html).toContain("your mailbox");
    // … but it is not a vault drill-in, and the raw provider id is not rendered as one.
    expect(html).not.toContain('data-testid="source-title"');
  });

  test("a citation names the SYSTEM it came from, beside its authority and freshness", () => {
    // The headline provenance claim of the feature. The assertion spans the citation's own label
    // through to its authority so it cannot be satisfied by the coverage sentence, which is the
    // other place the words "your mailbox" appear on this card.
    const html = render({
      summary: "s",
      claims: [
        {
          text: "They asked about renewal.",
          evidence: [
            cite({
              source: "inbox",
              sourceRef: "msg_abc",
              label: "Re: renewal",
              authority: "correspondence",
            }),
          ],
          conflictEvidence: [],
        },
      ],
      sources: [{ source: "inbox", status: "available", returned: 1 }],
    });
    expect(html).toContain(
      "Re: renewal</span> — your mailbox · Something someone said, not a record · Updated in the last month",
    );
  });

  test("a Drive citation names Drive, so two systems on one claim are told apart", () => {
    const html = render({
      summary: "s",
      claims: [
        {
          text: "Two sources agree.",
          evidence: [
            cite({ label: "Pricing sheet", sourceRef: "doc_9" }),
            cite({ source: "drive", sourceRef: "file_1", label: "Q3 model.xlsx" }),
          ],
          conflictEvidence: [],
        },
      ],
      sources: [],
    });
    expect(html).toContain("Pricing sheet</span> — your knowledge vault · Your own document");
    expect(html).toContain("Q3 model.xlsx</span> — your Google Drive · Your own document");
  });

  test("a mixed claim splits: the vault row drills in, the Drive row does not", () => {
    const html = render({
      summary: "s",
      claims: [
        {
          text: "Two sources agree.",
          evidence: [
            cite({ label: "Pricing sheet", sourceRef: "doc_9" }),
            cite({ source: "drive", sourceRef: "file_1", label: "Q3 model.xlsx" }),
          ],
          conflictEvidence: [],
        },
      ],
      sources: [],
    });
    expect(html.match(/data-testid="source-title"/g)).toHaveLength(1);
    expect(html).toContain("Pricing sheet");
    expect(html).toContain("Q3 model.xlsx");
  });

  test("an excerpt is rendered as a quotation of the cited evidence", () => {
    const html = render({
      summary: "s",
      claims: [
        {
          text: "Margin is 40%.",
          evidence: [cite()],
          conflictEvidence: [],
          excerpt: "the margin is 40 percent",
        },
      ],
    });
    expect(html).toContain("<blockquote");
    expect(html).toContain("the margin is 40 percent");
  });
});

// ── 4. Disagreement survives to the page ───────────────────────────────────────────────────

describe("conflicting evidence is shown, never resolved away", () => {
  test("both readings are named beside the claim", () => {
    const html = render({
      summary: "s",
      confidence: "medium",
      claims: [
        {
          text: "The rate is $40.",
          evidence: [cite({ label: "Rate card v2", sourceRef: "doc_1" })],
          conflictEvidence: [
            { source: "drive", sourceRef: "file_7", label: "Rate card (old copy)" },
          ],
        },
      ],
      sources: [],
    });
    expect(html).toContain("Another source disagrees");
    expect(html).toContain("Rate card v2");
    // WHICH source disagrees is the point of the block — a bare title is not a disagreement the
    // reader can act on.
    expect(html).toContain("Rate card (old copy)</span> — your Google Drive");
  });

  test("no disagreement block when nothing disagreed", () => {
    const html = render({
      summary: "s",
      claims: [{ text: "The rate is $40.", evidence: [cite()], conflictEvidence: [] }],
    });
    expect(html).not.toContain("Another source disagrees");
  });
});

// ── 5. Provenance words: authority, freshness, confidence ──────────────────────────────────

describe("how much to trust it is stated in words, never a number the model authored", () => {
  test("the agent's own earlier words are labelled as such, not as the owner's", () => {
    const html = render({
      summary: "s",
      claims: [
        {
          text: "We grew 20%.",
          evidence: [cite({ authority: "agent_authored", freshness: "stale" })],
          conflictEvidence: [],
        },
      ],
    });
    expect(html).toContain("Written by your assistant, not by you");
    expect(html).toContain("Over a year old");
  });

  test("a tenant document is labelled as the owner's own, and a current one says so", () => {
    const html = render({
      summary: "s",
      claims: [{ text: "c", evidence: [cite()], conflictEvidence: [] }],
    });
    expect(html).toContain("Your own document or file");
    expect(html).toContain("Updated in the last month");
  });

  test("an undatable source is not passed off as fresh", () => {
    const html = render({
      summary: "s",
      claims: [{ text: "c", evidence: [cite({ freshness: "unknown" })], conflictEvidence: [] }],
    });
    expect(html).toContain("No date on the source");
    expect(html).not.toContain("Updated in the last month");
  });

  test("each confidence label renders its own explanation", () => {
    expect(render({ summary: "s", confidence: "high" })).toContain(
      "High confidence — several sources agree and every source answered.",
    );
    expect(render({ summary: "s", confidence: "medium" })).toContain(
      "Medium confidence — something is missing, old, weakly sourced or disputed.",
    );
    expect(render({ summary: "s", confidence: "low" })).toContain(
      "Low confidence — this rests on a single source.",
    );
    expect(render({ summary: "s", confidence: "unsupported" })).toContain(
      "Not supported — nothing was found that could back an answer.",
    );
  });
});

// ── 6. The things the run could not do are said out loud ───────────────────────────────────

describe("what was not answered, and what was thrown away", () => {
  test("unanswered parts of the question are listed", () => {
    const html = render({
      summary: "s",
      unanswered: ["what the renewal date is", "who signed it"],
    });
    expect(html).toContain("Not answered");
    expect(html).toContain("what the renewal date is");
    expect(html).toContain("who signed it");
  });

  test("dropped uncited claims and invented citations are surfaced as counts", () => {
    const html = render({ summary: "s", unsupportedCount: 2, invalidCitationCount: 1 });
    expect(html).toContain("2 statements were dropped for citing nothing");
    expect(html).toContain("1 citation did not match any source that was read");
  });

  test("nothing dropped, nothing said", () => {
    const html = render({ summary: "s", unsupportedCount: 0, invalidCitationCount: 0 });
    expect(html).not.toContain("were dropped for citing nothing");
    expect(html).not.toContain("did not match any source that was read");
  });

  test("the singular is not a plural with an s bolted on", () => {
    const html = render({ summary: "s", unsupportedCount: 1, invalidCitationCount: 2 });
    expect(html).toContain("1 statement was dropped for citing nothing");
    expect(html).toContain("2 citations did not match any source that was read");
  });
});

// ── 6b. Every card says which question it answers ──────────────────────────────────────────

describe("a stacked answer is attributable to the question that produced it", () => {
  test("the stored question is the card's heading", () => {
    // `listByThread` returns up to LIST_LIMIT rows into one thread, so a card with no question on
    // it cannot be told from the one above it.
    const html = render({ question: "Renewal price, please", summary: "s" });
    expect(html).toContain('class="caps-label"');
    expect(html).toContain(">Renewal price, please</p>");
  });

  test("the heading is the STORED question, not the summary", () => {
    const html = render({ question: "What is our margin?", summary: "Margin is 40%." });
    expect(html).toContain(">What is our margin?</p>");
    expect(html).toContain("Margin is 40%.");
  });
});

// ── 7. A governed stop is a sentence, not a spinner that never ends ────────────────────────

describe("every refusal the backend can return has its own words", () => {
  const refusal = (reason: string) =>
    renderToStaticMarkup(createElement(SearchRefusal, { reason: reason as never }));

  test("a paused feature says it is paused, and does not read as an empty answer", () => {
    const html = refusal("kill_switch");
    expect(html).toContain("Search is paused for this workspace right now.");
    expect(html).not.toContain("nothing");
  });

  test("a budget stop names the budget", () => {
    expect(refusal("daily_budget_exhausted")).toContain(
      "The daily AI budget is used up, so this search did not run.",
    );
    expect(refusal("deployment_budget_exhausted")).toContain(
      "The Pikar-wide AI budget is used up, so this search did not run.",
    );
  });

  test("a refused question says what to do about it", () => {
    expect(refusal("question_too_long")).toContain(
      "That question is too long to search. Shorten it and try again.",
    );
  });

  test("a refused thread id does not blame the user's question", () => {
    const html = refusal("thread_id_invalid");
    expect(html).toContain("This conversation could not be identified, so nothing was searched.");
    expect(html).not.toContain("too long to search");
  });

  test("a refusal is announced, not just drawn", () => {
    expect(refusal("kill_switch")).toContain('role="status"');
  });
});

// ── 8. The surface is mounted, and it is not a second door into the agent ──────────────────

describe("the panel is wired into the workspace and stays a read", () => {
  const panel = stripComments(panelSource);
  const page = stripComments(pageSource);

  test("the scan read real code, not prose", () => {
    expect(panelSource.length).toBeGreaterThan(4000);
    expect(panel.length).toBeGreaterThan(2000);
  });

  test("page.tsx imports and renders the panel", () => {
    expect(page).toContain('from "./KnowledgeSearchPanel"');
    expect(page).toContain("<KnowledgeSearchPanel");
  });

  test("it calls the landed coordinator, and nothing else", () => {
    expect(panel).toContain("api.knowledgeSearch.search");
    expect(panel).toContain("api.knowledgeSearch.listByThread");
    // No cockpit send, no mutation, no tool grant: a search reads, it never acts.
    expect(panel).not.toContain("useMutation");
    expect(panel).not.toContain("sendCockpitMessage");
    expect(panel).not.toContain("api.cockpit");
  });

  test("the gap sentences come from @pikar/core, not from a second copy in the UI", () => {
    expect(panel).toContain("renderSourceGap");
    expect(panel).toContain("groundedSourceProps");
    // The exact strings `renderSourceGap` owns must not be restated here.
    expect(panel).not.toContain("so it was not searched");
    expect(panel).not.toContain("only the first");
  });

  test("the available/unavailable split is read from @pikar/core, not restated in the UI", () => {
    // `aggregateCoverage`'s docstring claims the distinction is made there; this is what fails if
    // the panel starts deciding it again on its own.
    expect(panel).toContain("aggregateCoverage(row.sources)");
    expect(panel).not.toContain('status !== "unavailable"');
    expect(panel).not.toContain('status === "unavailable"');
  });

  test("the panel's own thread handle wins once it has minted one", () => {
    // A search filed under the panel's `ks_` handle stays readable after the cockpit mints its
    // thread. Reading the prop first re-subscribed the panel and the answers on screen vanished.
    expect(panel).toContain("ownThread ?? threadId ?? null");
    expect(panel).not.toContain("threadId ?? ownThread");
  });

  test("the query field is labelled and the panel is reachable by name", () => {
    expect(panel).toContain("htmlFor=");
    expect(panel).toContain('aria-label="Search everything you have connected"');
  });
});
