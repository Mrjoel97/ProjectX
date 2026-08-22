// Command Center v2 presentation contract (26-20, HOME-01), in the repository's DOM-free runner.
//
// FILE NAME: `.ts`, NOT `.tsx`, deliberately. `apps/web/vitest.config.mts` includes
// `app/**/*.test.ts` only — a `.tsx` beside this one is SILENTLY SKIPPED and reads as coverage in
// the diff while asserting nothing. 26-13 and 26-17 both hit that and recorded it; this file uses
// `createElement` instead of JSX for the same reason.
//
// WHAT THIS PROVES AND WHAT IT CANNOT. Every assertion below is on a RENDERED STRING or a
// RENDERED href, never on a key or an enum value — this repo has shipped a green suite over a
// renamed literal that left the whole visible symptom standing. What it cannot prove:
// `renderToStaticMarkup` never invokes `getDerivedStateFromError`, so a THROWN Convex error is
// proven here as subscription INDEPENDENCE (the throwing section is rendered on its own, and its
// siblings still render their real data in the same file) plus a SOURCE SCAN of the boundary
// composition. A live throw belongs to the browser gate.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getFunctionName } from "convex/server";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import CommandCenter, {
  ConnectedBriefing,
  ConnectedStats,
  ConstraintCard,
  HealthCard,
  type HomeHealth,
  type HomeSummary,
  type LatestBriefing,
  LatestBriefingCard,
  RecommendationCard,
  SourceStats,
} from "./CommandCenter";

const hooks = vi.hoisted(() => {
  const state = {
    queryCalls: [] as unknown[],
    resolveQuery: (_reference: unknown): unknown => undefined,
  };
  return {
    state,
    useQuery: vi.fn((reference: unknown) => {
      state.queryCalls.push(reference);
      return state.resolveQuery(reference);
    }),
    useMutation: vi.fn(() => async () => undefined),
  };
});

vi.mock("convex/react", () => ({
  useQuery: hooks.useQuery,
  useMutation: hooks.useMutation,
}));

// ── harness ───────────────────────────────────────────────────────────────────

/** ONE cast so the fixtures stay readable; the prop TYPES are enforced in `CommandCenter.tsx`
 *  itself, at the `useQuery` call sites, against the generated Convex API. */
const render = (component: unknown, props: Record<string, unknown>): string =>
  renderToStaticMarkup(createElement(component as ComponentType<Record<string, unknown>>, props));

const names = (references: unknown[]): string[] =>
  references.map((reference) =>
    getFunctionName(reference as Parameters<typeof getFunctionName>[0]),
  );

type QueryAnswers = {
  summary?: unknown;
  health?: unknown;
  briefing?: unknown;
  /** Function names that should THROW, the way a real Convex query error reaches `useQuery`. */
  throwing?: string[];
};

/** Renders a connected tree with the Convex transport replaced. Anything not named here is an
 *  unexpected mount and fails loudly rather than resolving to a silent `undefined`. */
function mount(component: unknown, answers: QueryAnswers) {
  hooks.state.queryCalls.length = 0;
  hooks.state.resolveQuery = (reference) => {
    const name = getFunctionName(reference as Parameters<typeof getFunctionName>[0]);
    if (answers.throwing?.includes(name)) throw new Error(`query failed: ${name}`);
    switch (name) {
      case "home:summary":
        return answers.summary;
      case "home:health":
        return answers.health;
      case "briefings:latestForTenant":
        return answers.briefing;
      default:
        throw new Error(`Unexpected query mounted: ${name}`);
    }
  };
  const html = renderToStaticMarkup(
    createElement(component as ComponentType<Record<string, unknown>>, {}),
  );
  return { html, queries: names(hooks.state.queryCalls) };
}

beforeEach(() => {
  hooks.state.queryCalls.length = 0;
  hooks.useQuery.mockClear();
});

// ── fixtures ──────────────────────────────────────────────────────────────────

const signal = (code: string, state: "ok" | "triggered" | "unknown", count?: number) =>
  ({ code, state, ...(count === undefined ? {} : { count }) }) as HomeSignal;

type HomeSignal = NonNullable<HomeHealth>["signals"][number];

const SOURCE_CODES = [
  "connection-failure",
  "unresolved-dead-letters",
  "stale-approval",
  "scheduled-risk",
  "diagnostic-blocker",
  "binding-constraint",
] as const;

/** Every required source reporting ok — the only input that may reach the all-clear sentence. */
const allClear = (): HomeHealth => ({
  state: "healthy",
  signals: SOURCE_CODES.map((code) => signal(code, "ok")),
});

/** All ok EXCEPT the named codes, which are triggered. `state` is what the backend rolled up. */
const withTriggered = (...codes: string[]): HomeHealth => ({
  state: "degraded",
  signals: SOURCE_CODES.map((code) => signal(code, codes.includes(code) ? "triggered" : "ok")),
});

const READY_SUMMARY: HomeSummary = {
  approvals: { awaitingCount: 4, capped: false, oldestWaitingAt: 1_700_000_000_000 },
  content: { total: 38, capped: false },
  delivered: { count: 45, capped: false },
  deadLetters: { newCount: 2 },
  pipeline: {
    status: "ready",
    needingAttention: 7,
    followUpsDue: 3,
    consentOnRecord: 21,
    suppressed: 5,
  },
};

const BRIEFING: LatestBriefing = {
  createdAt: 1_700_000_000_000,
  range: "Aug 20 to Aug 22",
  tz: "Africa/Nairobi",
  // listedCount = how many the mailbox listing RETURNED; itemCount = how many were SUMMARIZED
  // (== items.length). These were 2 and 9 — summarizing NINE of TWO, which is impossible, and an
  // impossible fixture is why the renderer shipped them swapped ("7 listed of 2") unnoticed.
  listedCount: 9,
  itemCount: 2,
  synopsis: "Two threads are still open with the supplier.",
  items: [
    {
      id: "m1",
      bucket: "today",
      sender: "supplier@example.com",
      subject: "Revised quote for the March order",
      ts: 1_700_000_000_000,
      needsReply: true,
    },
    {
      id: "m2",
      bucket: "yesterday",
      sender: "ops@example.com",
      subject: "Warehouse slot confirmation",
      ts: 1_699_000_000_000,
      needsReply: false,
    },
  ],
  capped: false,
};

/** The code-owned recommendation copy, RETYPED here on purpose. Importing `HOME_PRIORITY_COPY`
 *  and asserting against it would pass for any rename — including one the renderer never picks
 *  up. These are the strings a person must see. */
const EXPECTED = {
  "connection-failure": {
    label: "Connect your mailbox",
    reason:
      "Pikar cannot reach a mailbox for you. Nothing can be sent or briefed until one is connected.",
    route: "/connect-gmail",
  },
  "unresolved-dead-letters": {
    label: "Clear the blocked work",
    reason:
      "Work stopped part-way and is waiting in the blocked queue. Nothing retries on its own.",
    route: "/ops",
  },
  "stale-approval": {
    label: "Answer the waiting approval",
    reason: "A plan is waiting on your decision. It will not send until you approve or reject it.",
    route: "/dashboard/approvals",
  },
  "scheduled-risk": {
    label: "Check the scheduled sends",
    reason: "A scheduled send is due soon or has no confirmed send time. Review it before it goes.",
    route: "/dashboard/approvals",
  },
  "diagnostic-blocker": {
    label: "Fix the failing gate",
    reason:
      "The diagnostic found a failing gate. Fixing that one first is what moves the business.",
    route: "/dashboard/reports",
  },
  "binding-constraint": {
    label: "Name your binding constraint",
    reason:
      "Your blueprint has no binding constraint on record, so nothing here is ranked against your real bottleneck.",
    route: "/dashboard/profile",
  },
  workspace: {
    label: "Open the workspace",
    reason:
      "Nothing needs your decision right now. Pick up the next piece of work in the workspace.",
    route: "/dashboard/workspace",
  },
} as const;

/** Any sentence that would tell a person nothing is wrong. None may be reachable from unknown. */
const ALL_CLEAR = /nothing is blocked|all clear|everything is fine|no issues/i;

// ── a) the recommendation ─────────────────────────────────────────────────────

describe("the recommended next move renders code-owned copy and a real deep link", () => {
  for (const [code, copy] of Object.entries(EXPECTED)) {
    test(`${code} renders its exact label, reason and href`, () => {
      // Only this code is triggered, so the total order must resolve to it.
      const health: HomeHealth =
        code === "workspace"
          ? { state: "healthy", signals: SOURCE_CODES.map((c) => signal(c, "ok")) }
          : withTriggered(code);
      const html = render(RecommendationCard, { health });

      expect(html).toContain(copy.label);
      expect(html).toContain(copy.reason);
      expect(html).toContain(`href="${copy.route}"`);
      expect(html).toContain(`data-cc-priority="${code}"`);
    });
  }

  test("every recommendation route is a route that actually exists in the app", () => {
    // A deep link into a 404 is worse than no link. `(app)` is a route group, so a route's
    // directory sits directly under it.
    for (const { route } of Object.values(EXPECTED)) {
      const page = fileURLToPath(new URL(`..${route}/page.tsx`, import.meta.url));
      expect(existsSync(page), `${route} has no page.tsx at ${page}`).toBe(true);
    }
  });

  test("clearing blockers in order walks the recommendation down the priority ladder", () => {
    // Each step clears exactly the blocker the previous step recommended.
    const ladder = [
      withTriggered(...SOURCE_CODES),
      withTriggered(
        "unresolved-dead-letters",
        "stale-approval",
        "scheduled-risk",
        "diagnostic-blocker",
        "binding-constraint",
      ),
      withTriggered("stale-approval", "scheduled-risk", "diagnostic-blocker", "binding-constraint"),
      withTriggered("scheduled-risk", "diagnostic-blocker", "binding-constraint"),
      withTriggered("diagnostic-blocker", "binding-constraint"),
      withTriggered("binding-constraint"),
      allClear(),
    ];
    const expected = [
      EXPECTED["connection-failure"].label,
      EXPECTED["unresolved-dead-letters"].label,
      EXPECTED["stale-approval"].label,
      EXPECTED["scheduled-risk"].label,
      EXPECTED["diagnostic-blocker"].label,
      EXPECTED["binding-constraint"].label,
      EXPECTED.workspace.label,
    ];

    const seen = ladder.map((health) => {
      const html = render(RecommendationCard, { health });
      const match = html.match(/data-cc-priority="([^"]+)"[^>]*>([^<]+)</);
      return match?.[2] ?? "";
    });

    expect(seen).toEqual(expected);
  });

  test("loading and a malformed payload are distinct states, and neither invents a move", () => {
    const loading = render(RecommendationCard, { health: undefined });
    expect(loading).toContain('data-cc-state="loading"');
    expect(loading).toContain("Loading");
    expect(loading).not.toContain(EXPECTED.workspace.label);

    const broken = render(RecommendationCard, { health: { state: "healthy" } });
    expect(broken).toContain('data-cc-state="error"');
    expect(broken).toContain("This could not be loaded");
    expect(broken).not.toContain(EXPECTED.workspace.label);
  });

  test("the primary CTA names its destination, never the bare word Open", () => {
    // The loudest control on the page. "Open" alone gives a screen-reader user no link purpose.
    for (const [health, name] of [
      [allClear(), "Open the workspace"],
      [withTriggered("connection-failure"), "Open mailbox connection"],
      [withTriggered("stale-approval"), "Open approvals"],
      [withTriggered("binding-constraint"), "Open your business profile"],
    ] as const) {
      expect(ctaName(render(RecommendationCard, { health }))).toBe(name);
    }
  });
});

/** The hero HEADLINE — the one slot the all-clear copy may never reach. Scoped, because the CTA
 *  under it legitimately reads "Open the workspace" whenever the route is the workspace. */
const heroHeadline = (html: string): string => {
  const match = html.match(/<h2 data-cc-priority="[^"]*"[^>]*>([^<]*)</);
  return match?.[1] ?? "";
};

/** The visible (and therefore accessible) name of the hero CTA — the icon is `aria-hidden`. */
const ctaName = (html: string): string => {
  const at = html.indexOf('class="cta-dark"');
  if (at === -1) return "";
  const open = html.indexOf(">", at);
  return html
    .slice(open + 1, html.indexOf("</a>", open))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

// ── a2) the hero can never all-clear over an incomplete set ───────────────────
// The rule itself lives in `recommendNextMove` (packages/core/src/home.ts) so that the hero and
// the health verdict cannot drift; these assert that the RENDERER inherits it. Reverting core's
// guard (`const certain = rollUpHealth(list) !== "unknown"` -> `const certain = true`) turns the
// first three RED and leaves the fourth green — proof the guard is not simply always-on.

describe("the recommended next move never all-clears over sources that did not report", () => {
  const partlyUnread = (...unread: string[]): HomeHealth => ({
    state: "unknown",
    signals: SOURCE_CODES.map((code) => signal(code, unread.includes(code) ? "unknown" : "ok")),
  });

  test("two sources that threw are not 'nothing needs your decision right now'", () => {
    // Exactly what `home.ts` returns when `gmailAuth.gmailStatus` and `deadLetters.newCount` throw:
    // `orElse(..., unknownSignal(code))` for both.
    const html = render(RecommendationCard, {
      health: partlyUnread("connection-failure", "unresolved-dead-letters"),
    });
    // Scoped to the HEADLINE: the CTA legitimately reads "Open the workspace" (that is where the
    // link goes). What must never appear is the all-clear HEADLINE and its all-clear sentence.
    expect(heroHeadline(html)).not.toBe(EXPECTED.workspace.label);
    expect(heroHeadline(html)).toBe("Some checks did not report");
    expect(html).not.toContain(EXPECTED.workspace.reason);
    expect(html).toContain(
      "Pikar could not read at least one source, so it cannot tell you whether anything needs your decision.",
    );
    expect(html).toContain('href="/dashboard/workspace"');
  });

  test("a required signal MISSING entirely is not an all-clear — absence is not health", () => {
    // The shipped default for every tenant that has never run the business review: `home.ts`
    // returns `unknownSignal("diagnostic-blocker")` when `evaluations.byThread` has no row.
    const html = render(RecommendationCard, {
      health: {
        state: "unknown",
        signals: SOURCE_CODES.filter((code) => code !== "diagnostic-blocker").map((code) =>
          signal(code, "ok"),
        ),
      },
    });
    // Scoped to the HEADLINE: the CTA legitimately reads "Open the workspace" (that is where the
    // link goes). What must never appear is the all-clear HEADLINE and its all-clear sentence.
    expect(heroHeadline(html)).not.toBe(EXPECTED.workspace.label);
    expect(heroHeadline(html)).toBe("Some checks did not report");
    expect(html).not.toContain(EXPECTED.workspace.reason);
  });

  test("a triggered blocker still wins outright, with the unread source stated as a caveat", () => {
    // Priority 1 is unreadable while priority 6 is triggered: the move is still reported (a real
    // blocker outranks an unread source), but the page must not imply nothing above it exists.
    const html = render(RecommendationCard, {
      health: {
        state: "unknown",
        signals: SOURCE_CODES.map((code) =>
          signal(
            code,
            code === "connection-failure"
              ? "unknown"
              : code === "binding-constraint"
                ? "triggered"
                : "ok",
          ),
        ),
      },
    });
    expect(html).toContain('data-cc-priority="binding-constraint"');
    expect(html).toContain(EXPECTED["binding-constraint"].label);
    expect(html).toContain(
      "At least one source did not report, so something higher than this may also be waiting.",
    );
  });

  test("the COMPLETE all-ok set DOES reach the all-clear — the guard is not always-on", () => {
    const html = render(RecommendationCard, { health: allClear() });
    expect(heroHeadline(html)).toBe(EXPECTED.workspace.label);
    expect(html).toContain(EXPECTED.workspace.reason);
    expect(html).not.toContain("Some checks did not report");
    expect(html).not.toContain("At least one source did not report");
  });
});

// ── b) the binding constraint ─────────────────────────────────────────────────

describe("the binding constraint says insufficient when nothing types it", () => {
  test("an unknown signal renders the insufficient copy, not a claim either way", () => {
    const html = render(ConstraintCard, {
      health: { state: "unknown", signals: [signal("binding-constraint", "unknown")] },
    });
    expect(html).toContain('data-cc-constraint="insufficient"');
    expect(html).toContain("Not enough information");
    expect(html).toContain("Nothing on record types your binding constraint yet");
    expect(html).not.toContain("is on record");
  });

  test("an absent signal is treated exactly like an unknown one", () => {
    const html = render(ConstraintCard, { health: { state: "unknown", signals: [] } });
    expect(html).toContain('data-cc-constraint="insufficient"');
    expect(html).toContain("Not enough information");
  });

  test("a triggered signal asks for the constraint by name and links to the profile", () => {
    const html = render(ConstraintCard, { health: withTriggered("binding-constraint") });
    expect(html).toContain('data-cc-constraint="triggered"');
    expect(html).toContain(EXPECTED["binding-constraint"].reason);
    expect(html).toContain('href="/dashboard/profile"');
  });

  test("an ok signal says it is on record, and claims nothing this page cannot do", () => {
    const html = render(ConstraintCard, { health: allClear() });
    expect(html).toContain('data-cc-constraint="ok"');
    expect(html).toContain("Your binding constraint is on record");
    expect(html).toContain(
      "It is recorded in your blueprint. This page ranks what is blocked or waiting, not the constraint itself.",
    );
    // The old body promised a capability nothing implements: the ranking is the fixed
    // `HOME_PRIORITY_ORDER`, and the signal carries a state — the constraint text never crosses.
    expect(html).not.toContain("ranked against the bottleneck");
  });

  test("loading and a malformed payload are distinct states, and neither types the constraint", () => {
    const loading = render(ConstraintCard, { health: undefined });
    expect(loading).toContain('data-cc-state="loading"');
    expect(loading).toContain("Loading");
    expect(loading).not.toContain("Not enough information");
    expect(loading).not.toContain("is on record");

    // `{ state: "healthy" }` has no `signals` array, so `healthOf` rejects it.
    const broken = render(ConstraintCard, { health: { state: "healthy" } });
    expect(broken).toContain('data-cc-state="error"');
    expect(broken).toContain("This could not be loaded");
    expect(broken).not.toContain("is on record");
  });

  test("the card states the FACT; only the hero issues the imperative", () => {
    // Two identical <h2>s at the last rung made heading navigation ambiguous (WCAG 2.4.6).
    const health = withTriggered("binding-constraint");
    expect(render(RecommendationCard, { health })).toContain("Name your binding constraint");
    const constraint = render(ConstraintCard, { health });
    expect(constraint).toContain('data-cc-constraint="triggered"');
    expect(constraint).toContain("No binding constraint on record");
    expect(constraint).not.toContain("Name your binding constraint");
  });
});

// ── c) source stats and the narrow pipeline summary ───────────────────────────

/** The pipeline block is the tail of the stats section — sliced so "never renders 0" is a claim
 *  about the PIPELINE, not about the page (other tiles legitimately show a zero). */
const pipelineOf = (html: string) => html.slice(html.indexOf("data-cc-pipeline"));

/** The same block as TEXT — inline `style` attributes are full of digits, so "this section never
 *  renders a number" is only meaningful about what a person actually reads. */
const pipelineTextOf = (html: string) =>
  pipelineOf(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("source stats render real numbers and never turn a failure into a zero", () => {
  test("a ready summary renders every source count and the four pipeline numbers", () => {
    const html = render(SourceStats, { summary: READY_SUMMARY });
    expect(html).toContain("Awaiting approval");
    expect(html).toContain(">4<");
    expect(html).toContain("Content artifacts");
    expect(html).toContain(">38<");
    expect(html).toContain("Emails delivered");
    expect(html).toContain(">45<");
    expect(html).toContain("Blocked work");
    expect(html).toContain(">2<");

    const pipeline = pipelineOf(html);
    expect(pipeline).toContain('data-cc-pipeline="ready"');
    expect(pipeline).toContain("Contacts needing attention");
    expect(pipeline).toContain(">7<");
    expect(pipeline).toContain("Follow-ups due");
    expect(pipeline).toContain(">3<");
    expect(pipeline).toContain("Consent on record");
    expect(pipeline).toContain(">21<");
    expect(pipeline).toContain("Suppressed contacts");
    expect(pipeline).toContain(">5<");
  });

  test("an unavailable source renders the word, never a zero", () => {
    const html = render(SourceStats, {
      summary: {
        ...READY_SUMMARY,
        approvals: { unavailable: true },
        deadLetters: { unavailable: true },
      },
    });
    expect(html).toContain("Unavailable");
    // The two failed tiles must not have become 0, while the healthy ones keep their real values.
    expect(html).not.toContain(">0<");
    expect(html).toContain(">38<");
    expect(html).toContain(">45<");
  });

  test("a capped count renders a floor, not a confidently wrong integer", () => {
    const html = render(SourceStats, {
      summary: { ...READY_SUMMARY, delivered: { count: 1000, capped: true } },
    });
    expect(html).toContain("1000+");
    expect(html).not.toContain(">1000<");
  });

  test("pipeline PARTIAL renders floors and says why, while the other tiles keep real values", () => {
    const html = render(SourceStats, {
      summary: {
        ...READY_SUMMARY,
        pipeline: {
          status: "partial",
          reason: "row-cap",
          needingAttention: 1000,
          followUpsDue: 40,
          consentOnRecord: 1000,
          suppressed: 12,
        },
      },
    });
    const pipeline = pipelineOf(html);
    expect(pipeline).toContain('data-cc-pipeline="partial"');
    expect(pipeline).toContain('data-cc-state="partial"');
    expect(pipeline).toContain("Some results are not shown");
    expect(pipeline).toContain("the scan stopped at its row limit, so these are floors.");
    expect(pipeline).toContain("1000+");
    expect(pipeline).toContain("40+");
    expect(pipeline).not.toContain(">1000<");

    // The sibling tiles are untouched by the pipeline's degradation.
    expect(html).toContain(">4<");
    expect(html).toContain(">38<");
    expect(html).toContain(">45<");
  });

  test("pipeline UNAVAILABLE renders its own words and no digit at all", () => {
    const html = render(SourceStats, {
      summary: { ...READY_SUMMARY, pipeline: { status: "unavailable" } },
    });
    const pipeline = pipelineOf(html);
    expect(pipeline).toContain('data-cc-pipeline="unavailable"');
    expect(pipeline).toContain("Pipeline numbers are unavailable right now");
    expect(pipeline).toContain("This is not a count of zero");
    expect(pipelineTextOf(html)).not.toMatch(/\d/);
    expect(html).toContain(">4<");
    expect(html).toContain(">45<");
  });

  test("pipeline ERROR renders the code-owned error state and no digit at all", () => {
    const html = render(SourceStats, {
      summary: { ...READY_SUMMARY, pipeline: { status: "error" } },
    });
    const pipeline = pipelineOf(html);
    expect(pipeline).toContain('data-cc-pipeline="error"');
    expect(pipeline).toContain('data-cc-state="error"');
    expect(pipeline).toContain("This could not be loaded");
    expect(pipelineTextOf(html)).not.toMatch(/\d/);
    expect(html).toContain(">4<");
    expect(html).toContain(">45<");
  });

  test("every legal partial reason renders prose, and the enum slug never reaches the page", () => {
    // `DashboardPartialReason` is a closed set of five (packages/core/src/dashboard.ts). Four of
    // them used to render as "the scan hit its coverage-gap limit" — a wire value in product copy.
    const REASON_PROSE = {
      "row-cap": "the scan stopped at its row limit, so these are floors.",
      "time-cap": "the scan ran out of time, so these are floors.",
      "legacy-window":
        "older records fall outside the window this scan can read, so these are floors.",
      "coverage-gap": "some records could not be read, so these are floors.",
      "source-unavailable": "a source could not be reached, so these are floors.",
    } as const;

    for (const [reason, prose] of Object.entries(REASON_PROSE)) {
      const html = render(SourceStats, {
        summary: {
          ...READY_SUMMARY,
          pipeline: {
            status: "partial",
            reason,
            needingAttention: 1000,
            followUpsDue: 40,
            consentOnRecord: 1000,
            suppressed: 12,
          },
        },
      });
      const pipeline = pipelineOf(html);
      expect(pipeline, reason).toContain('data-cc-state="partial"');
      expect(pipeline, reason).toContain(prose);
      expect(html, reason).not.toContain(reason);
    }
  });

  test("a summary that is null or off-contract is an error state, not four zeros", () => {
    for (const broken of [null, "nope", 7]) {
      const html = render(SourceStats, { summary: broken });
      expect(html).toContain('data-cc-section="stats"');
      expect(html).toContain('data-cc-state="error"');
      expect(html).toContain("This could not be loaded");
      expect(html).not.toContain(">0<");
      expect(html).not.toContain("Awaiting approval");
    }
  });

  test("each pipeline state carries a live region and a word, never colour alone", () => {
    for (const status of ["unavailable", "error"] as const) {
      const pipeline = pipelineOf(
        render(SourceStats, { summary: { ...READY_SUMMARY, pipeline: { status } } }),
      );
      expect(pipeline).toContain('role="status"');
      expect(pipeline).toContain('aria-live="polite"');
      expect(pipelineTextOf(pipeline)).toMatch(/[A-Za-z]{4,}/);
    }
  });
});

// ── d) the latest briefing ────────────────────────────────────────────────────

describe("the latest briefing offers workspace links and nothing that sounds like an action", () => {
  test("rows render the real subject and sender and link to the workspace", () => {
    const html = render(LatestBriefingCard, { briefing: BRIEFING });
    expect(html).toContain("Revised quote for the March order");
    expect(html).toContain("supplier@example.com");
    expect(html).toContain("Warehouse slot confirmation");
    expect(html).toContain('href="/dashboard/workspace"');
    expect(html).toContain("Open in workspace");
  });

  test("no row offers to reply, send or schedule", () => {
    const html = render(LatestBriefingCard, { briefing: BRIEFING });
    // Every anchor and button label in this section, checked against the forbidden verbs.
    const labels = [...html.matchAll(/<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/g)].map(
      (match) => (match[1] ?? "").replace(/<[^>]*>/g, "").trim(),
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label).not.toMatch(/\b(reply|replying|send|sending|schedule|scheduling)\b/i);
      expect(label).toContain("Open in workspace");
    }
    expect(html).toContain(`href="/dashboard/workspace"`);
    expect(html).not.toMatch(/href="\/dashboard\/approvals"/);
  });

  test("the summarized count never exceeds the listed total", () => {
    const html = render(LatestBriefingCard, { briefing: BRIEFING });
    // The exact sentence, so a swap or a relabel fails here rather than only in a browser.
    expect(html).toContain("Summarized 2 of 9 in this window.");
    // And the invariant behind it, which no ordering of the two numbers can satisfy by accident.
    const shown = /Summarized (\d+) of (\d+) in this window\./.exec(html);
    expect(shown, "the briefing card stopped stating its coverage").not.toBeNull();
    const summarized = Number(shown?.[1]);
    const listed = Number(shown?.[2]);
    expect(summarized).toBe(BRIEFING?.itemCount);
    expect(listed).toBe(BRIEFING?.listedCount);
    expect(summarized).toBeLessThanOrEqual(listed);
  });

  test("the model-written synopsis is rendered under an explicit Pikar attribution", () => {
    const html = render(LatestBriefingCard, { briefing: BRIEFING });
    expect(html).toContain("Pikar summary");
    expect(html).toContain("Two threads are still open with the supplier.");
  });

  test("no briefing is an empty state, not a crash and not a fake row", () => {
    const html = render(LatestBriefingCard, { briefing: null });
    expect(html).toContain('data-cc-state="empty"');
    expect(html).toContain("Nothing here yet");
    expect(html).not.toContain("Open in workspace");
  });

  test("a capped briefing says so", () => {
    const html = render(LatestBriefingCard, { briefing: { ...BRIEFING, capped: true } });
    expect(html).toContain('data-cc-state="partial"');
    expect(html).toContain("Some results are not shown");
  });

  test("a briefing row with zero items is an empty state, not a fake row", () => {
    // A `briefings` row with an empty `items` array is legal (schema.ts) and the backend passes
    // it through untouched, so the card has to answer for it.
    const html = render(LatestBriefingCard, {
      briefing: { ...BRIEFING, items: [], listedCount: 0, itemCount: 0 },
    });
    expect(html).toContain('data-cc-state="empty"');
    expect(html).toContain("Nothing here yet");
    expect(html).not.toContain("Open in workspace");
    expect(html).not.toContain("Revised quote for the March order");
    // The header the row DOES carry is still rendered — an empty list is not a dead card.
    expect(html).toContain("Aug 20 to Aug 22");
  });

  test("a malformed items field is an error state, never a crash and never an empty state", () => {
    for (const items of ["nope", 3, null, { 0: "x" }]) {
      const html = render(LatestBriefingCard, { briefing: { ...BRIEFING, items } });
      expect(html).toContain('data-cc-state="error"');
      expect(html).toContain("This could not be loaded");
      expect(html).not.toContain("Nothing here yet");
      expect(html).not.toContain("Open in workspace");
    }
  });
});

// ── e) health ─────────────────────────────────────────────────────────────────

describe("health is fail-closed: the all-clear is unreachable from unknown", () => {
  test("an unknown roll-up says Unknown and never says nothing is blocked", () => {
    const html = render(HealthCard, {
      health: {
        state: "unknown",
        signals: [signal("connection-failure", "unknown"), signal("stale-approval", "ok")],
      },
    });
    expect(html).toContain('data-cc-health="unknown"');
    expect(html).toContain("Unknown");
    expect(html).not.toMatch(ALL_CLEAR);
  });

  test("loading health is Unknown-shaped too — no flash of an all-clear", () => {
    const html = render(HealthCard, { health: undefined });
    expect(html).toContain('data-cc-state="loading"');
    expect(html).not.toMatch(ALL_CLEAR);
    expect(html).not.toContain('data-cc-health="healthy"');
  });

  test("a malformed health payload is Unknown, never healthy", () => {
    for (const broken of [null, {}, { state: "healthy" }, { signals: [] }]) {
      const html = render(HealthCard, { health: broken });
      expect(html).toContain('data-cc-health="unknown"');
      expect(html).not.toMatch(ALL_CLEAR);
    }
  });

  test("only a complete set of ok reports reaches the all-clear sentence", () => {
    const html = render(HealthCard, { health: allClear() });
    expect(html).toContain('data-cc-health="healthy"');
    expect(html).toContain("Nothing is blocked.");
  });

  test("a degraded roll-up names every source in NEUTRAL words, not by colour and not by command", () => {
    const html = render(HealthCard, { health: withTriggered("unresolved-dead-letters") });
    expect(html).toContain('data-cc-health="degraded"');
    expect(html).not.toMatch(ALL_CLEAR);

    // Each required source is listed by a neutral noun phrase with a state WORD beside it.
    for (const [code, label] of Object.entries(ROW_LABEL)) {
      expect(html, code).toContain(`data-cc-signal="${code}"`);
      expect(html, code).toContain(label);
    }
    // A status row must never issue a command: BRAND §1 reserves imperatives for the ONE next-move
    // headline, and this card sits under "Nothing is blocked." on the healthy branch.
    for (const [code, copy] of Object.entries(EXPECTED)) {
      expect(html, code).not.toContain(copy.label);
    }

    // SCOPED to the row. Unscoped, `toContain("Clear")` was satisfied by the recommendation label
    // "Clear the blocked work" elsewhere in the same html — it passed for ANY ok word, "" included.
    expect(signalWord(html, "unresolved-dead-letters")).toBe("Needs attention");
    expect(signalWord(html, "stale-approval")).toBe("Clear");
    expect(signalWord(html, "connection-failure")).toBe("Clear");
  });

  test("an unknown signal inside a reporting set still reads as the word Unknown", () => {
    const html = render(HealthCard, {
      health: {
        state: "unknown",
        signals: SOURCE_CODES.map((code) =>
          signal(code, code === "scheduled-risk" ? "unknown" : "ok"),
        ),
      },
    });
    expect(signalWord(html, "scheduled-risk")).toBe("Unknown");
    expect(signalWord(html, "stale-approval")).toBe("Clear");
  });

  test("the verdict is DERIVED from the signals shown, never taken off the wire", () => {
    // Every payload below PASSES `healthOf` — an array of signals and a string state — so the only
    // thing standing between the wire and the all-clear sentence is the recomputation.
    const lying: HomeHealth = {
      state: "healthy",
      signals: SOURCE_CODES.map((code) =>
        signal(code, code === "connection-failure" ? "unknown" : "ok"),
      ),
    };
    const html = render(HealthCard, { health: lying });
    expect(html).toContain('data-cc-health="unknown"');
    expect(html).not.toContain('data-cc-health="healthy"');
    expect(html).not.toMatch(ALL_CLEAR);
    expect(signalWord(html, "connection-failure")).toBe("Unknown");

    // The emptiest contradiction of all: an all-clear over six rows that every one read Unknown.
    const empty = render(HealthCard, { health: { state: "healthy", signals: [] } });
    expect(empty).toContain('data-cc-health="unknown"');
    expect(empty).not.toMatch(ALL_CLEAR);
    for (const code of SOURCE_CODES) expect(signalWord(empty, code)).toBe("Unknown");

    // ...and the derivation is a COMPUTATION, not hard-coded pessimism: a complete ok set still
    // reaches "healthy" even when the wire understated it.
    const understated = render(HealthCard, { health: { ...allClear(), state: "unknown" } });
    expect(understated).toContain('data-cc-health="healthy"');
    expect(understated).toContain("Nothing is blocked.");

    // A wire "healthy" over a genuinely triggered source is degraded, not healthy.
    const overstated = render(HealthCard, {
      health: { ...withTriggered("scheduled-risk"), state: "healthy" },
    });
    expect(overstated).toContain('data-cc-health="degraded"');
    expect(overstated).not.toMatch(ALL_CLEAR);
  });
});

/** The NEUTRAL row labels, retyped on purpose — importing `HOME_SIGNAL_LABEL` would pass for any
 *  rename, including one the renderer never picks up. These are the words a person must see. */
const ROW_LABEL = {
  "connection-failure": "Mailbox connection",
  "unresolved-dead-letters": "Blocked work queue",
  "stale-approval": "Approvals waiting",
  "scheduled-risk": "Scheduled sends",
  "diagnostic-blocker": "Diagnostic gates",
  "binding-constraint": "Binding constraint",
} as const;

/** The state word of ONE health row, scoped to that row's own element. */
const signalWord = (html: string, code: string): string => {
  const at = html.indexOf(`data-cc-signal="${code}"`);
  if (at === -1) return "";
  const open = html.indexOf(">", at);
  return html.slice(open + 1, html.indexOf("</span>", open)).trim();
};

// ── section independence ──────────────────────────────────────────────────────

describe("one subscription failing or loading never blanks the others", () => {
  test("the three contracted subscriptions all mount", () => {
    const { queries } = mount(CommandCenter, {
      summary: READY_SUMMARY,
      health: allClear(),
      briefing: BRIEFING,
    });
    expect(queries).toContain("home:summary");
    expect(queries).toContain("home:health");
    expect(queries).toContain("briefings:latestForTenant");
  });

  test("summary still LOADING leaves health and the briefing fully rendered", () => {
    const { html } = mount(CommandCenter, {
      summary: undefined,
      health: allClear(),
      briefing: BRIEFING,
    });
    expect(html).toContain('data-cc-section="stats"');
    expect(html).toContain('data-cc-state="loading"');
    // Siblings unaffected.
    expect(html).toContain("Nothing is blocked.");
    expect(html).toContain("Revised quote for the March order");
    expect(html).toContain(EXPECTED.workspace.label);
  });

  test("the briefing still LOADING leaves the stats and the recommendation rendered", () => {
    const { html } = mount(CommandCenter, {
      summary: READY_SUMMARY,
      health: withTriggered("stale-approval"),
      briefing: undefined,
    });
    expect(html).toContain(">4<");
    expect(html).toContain(">45<");
    expect(html).toContain(EXPECTED["stale-approval"].label);
    expect(html).toContain('data-cc-state="loading"');
  });

  test("a THROWING home.summary does not stop briefings.latestForTenant from rendering", () => {
    // `renderToStaticMarkup` cannot run an error boundary, so this proves the property the
    // boundary depends on: the subscriptions are independent, and the throw is contained to the
    // one section that reads the failing query.
    expect(() => mount(ConnectedStats, { throwing: ["home:summary"] })).toThrow(
      /query failed: home:summary/,
    );

    const { html, queries } = mount(ConnectedBriefing, {
      briefing: BRIEFING,
      throwing: ["home:summary"],
    });
    expect(queries).toEqual(["briefings:latestForTenant"]);
    expect(html).toContain("Revised quote for the March order");
    expect(html).toContain('href="/dashboard/workspace"');
  });

  test("every connected section sits inside its OWN boundary", () => {
    // The composition claim the DOM-free runner cannot execute, asserted as source.
    const source = readFileSync(
      fileURLToPath(new URL("./CommandCenter.tsx", import.meta.url)),
      "utf8",
    );
    for (const section of ["recommendation", "constraint", "stats", "briefing", "health"]) {
      expect(source).toContain(`<SectionBoundary section="${section}">`);
    }
    expect(source.match(/<SectionBoundary /g) ?? []).toHaveLength(5);
    // A single page-wide boundary is exactly the 26-10 FinanceTabs bug.
    expect(source).not.toMatch(/<SectionBoundary[^>]*>\s*<div className="cc"/);
  });

  test("each section emits its mount marker EXACTLY once, loaded and while showing a notice", () => {
    // The marker is the browser gate's mount discriminator (`toHaveCount(1)`). It used to be
    // emitted on the container AND on every nested state notice, so the count was 2 — and the
    // gate then aborted all eight tests on the wrong diagnosis ("the legacy dashboard is mounted").
    const markers = (html: string, section: string) =>
      html.split(`data-cc-section="${section}"`).length - 1;

    const loaded = mount(CommandCenter, {
      summary: READY_SUMMARY,
      health: allClear(),
      briefing: BRIEFING,
    }).html;
    for (const section of ["recommendation", "constraint", "stats", "briefing", "health"]) {
      expect(markers(loaded, section), section).toBe(1);
    }
    expect(markers(loaded, "pipeline")).toBe(1);

    // Now with a notice inside every one of them — the briefing carries TWO (partial + empty).
    const noticed = mount(CommandCenter, {
      summary: undefined,
      health: null,
      briefing: { ...BRIEFING, capped: true, items: [] },
    }).html;
    expect(noticed).toContain('data-cc-state="loading"');
    expect(noticed).toContain('data-cc-state="partial"');
    expect(noticed).toContain('data-cc-state="empty"');
    expect(noticed).toContain('data-cc-state="error"');
    for (const section of ["recommendation", "constraint", "stats", "briefing", "health"]) {
      expect(markers(noticed, section), section).toBe(1);
    }
  });

  test("the hero eyebrow is BRAND §3's dated context label, not the rail's own nav item", () => {
    const { html } = mount(CommandCenter, {
      summary: READY_SUMMARY,
      health: allClear(),
      briefing: BRIEFING,
    });
    const hero = html.slice(
      html.indexOf('class="cc-hero"'),
      html.indexOf('data-cc-section="recommendation"'),
    );
    expect(hero).toContain("Solopreneur • ");
    expect(hero).toContain("Run the next revenue move");
    // `layout.tsx`'s rail already carries a "Command Center" item for this route, so as an eyebrow
    // it only restated where you already are — and it made every heading locator ambiguous.
    expect(hero).not.toContain("Command Center");
  });

  test("each region landmark is named BY the visible label inside it, not by a second string", () => {
    const { html } = mount(CommandCenter, {
      summary: READY_SUMMARY,
      health: allClear(),
      briefing: BRIEFING,
    });
    const labelText = (id: string) => {
      const at = html.indexOf(`id="${id}"`);
      if (at === -1) return "";
      const open = html.indexOf(">", at);
      return html.slice(open + 1, html.indexOf("</p>", open)).trim();
    };
    for (const [id, visible] of Object.entries({
      "cc-constraint-label": "Your binding constraint",
      "cc-stats-label": "Key numbers",
      "cc-briefing-label": "Latest briefing",
      "cc-health-label": "System health",
    })) {
      expect(html, id).toContain(`aria-labelledby="${id}"`);
      expect(labelText(id), id).toBe(visible);
    }
    // The old `aria-label` announced a title the eye never saw — and on the constraint card the
    // accessible name ("Binding constraint") did not even match the visible one.
    expect(html).not.toContain("aria-label=");
  });

  test("the binding-constraint imperative is rendered ONCE on the whole page", () => {
    const { html } = mount(CommandCenter, {
      summary: READY_SUMMARY,
      health: withTriggered("binding-constraint"),
      briefing: BRIEFING,
    });
    // Was three: the hero <h2>, the constraint card's <h2>, and a health status row.
    expect(html.split("Name your binding constraint").length - 1).toBe(1);
    expect(html).toContain('data-cc-priority="binding-constraint"');
    expect(html).toContain("No binding constraint on record");
    expect(html).toContain("Binding constraint</span>");
  });
});

// ── the home route ────────────────────────────────────────────────────────────
// The reversible-switch suite that lived here (and its TRIPWIRE) was deleted with the switch
// itself on owner approval, 2026-08-23. What survives is the part that is still true and still
// worth defending: `/dashboard` mounts the Command Center and nothing else.

describe("the dashboard route mounts the Command Center", () => {
  const pageSource = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

  test("page.tsx renders CommandCenter with no fork and no build-time flag", () => {
    expect(pageSource).toContain('import CommandCenter from "./CommandCenter"');
    expect(pageSource).toContain("return <CommandCenter />;");
    // The fork is gone, not merely defaulted: no second home, no boolean, no env switch.
    expect(pageSource).not.toContain("LegacyDashboard");
    expect(pageSource).not.toContain("COMMAND_CENTER_V2");
    expect(pageSource).not.toContain("process.env");
  });

  test("the legacy dashboard file is deleted, not orphaned beside the live one", () => {
    // An unrendered second home is a maintenance trap and a source of "which one is real?".
    expect(existsSync(fileURLToPath(new URL("./LegacyDashboard.tsx", import.meta.url)))).toBe(false);
  });
});
