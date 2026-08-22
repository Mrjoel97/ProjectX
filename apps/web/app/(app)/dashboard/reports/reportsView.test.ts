// Reports component contracts, in the DOM-free runner (RPRT-01, plan 26-17).
//
// `.test.ts`, NOT `.test.tsx` — `apps/web/vitest.config.mts` includes `app/**/*.test.ts` only, so a
// `.tsx` here is SILENTLY SKIPPED. The plan named `reportsView.test.tsx`; this is the same file
// under the name the runner can actually see. Same deviation, same reason, as `contentView.test.ts`.
//
// Components are built with `createElement` and rendered to a STRING with `renderToStaticMarkup`,
// so no jsdom is needed and only the hook-free exports are importable.
//
// THE LAST DESCRIBE IS A SOURCE SCAN, and it carries the claims a fixture cannot: that the window
// anchor is pinned rather than live, that a non-owner never CALLS an owner query, and that no
// health verdict is rendered over the WORM cursor. Those are properties of the module, not of one
// rendered output.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BoardPackInput } from "@pikar/core";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  BusinessSection,
  GovernanceSection,
  OperationsSection,
  OwnerSection,
  PERIODS,
  windowFor,
} from "./ReportsView";

// ONE cast so the fixtures stay readable. These tests assert RENDERED OUTPUT; the prop TYPES are
// enforced where the components are used, in `ReportsView.tsx`, against the generated Convex API —
// so a fixture drifting from the real shape shows up there (the financeView.test.ts rule).
const render = (component: unknown, props: Record<string, unknown>): string =>
  renderToStaticMarkup(createElement(component as ComponentType<Record<string, unknown>>, props));

const TZ = "UTC";
const NOW = Date.UTC(2026, 7, 22, 12, 0, 0);
const full = { state: "covered" } as const;
const whole = { limit: 100, returned: 3, partial: false, nextCursor: null } as const;

// THE FIXTURES ARE TYPED AGAINST THE REAL CONTRACT, not cast into shape. The first draft of this
// file invented `movement: { state: "not-comparable" }` and a `p50`/`p95` latency; both rendered
// plausibly and both were fiction, because the cast at `render()` hid them. A fixture that seeds a
// literal nothing writes is the 26-14 `edit: 0` defect wearing a test's clothes — so the shapes
// come from `BoardPackInput`, which is the same type `reportPackData.snapshot` satisfies.
type Ops = BoardPackInput["operations"];
type Biz = BoardPackInput["business"];

const BASE_OPS: Ops = {
  delivery: { sentCount: 45, bound: whole, coverage: full },
  review: {
    terminals: 51,
    decisions: { approve: 45, reject: 3, edit_text: 2 },
    otherDecisions: 0,
    bound: whole,
    coverage: full,
  },
  latency: {
    state: "known",
    value: 34_000,
    included: 51,
    excluded: 3,
    population: "p95 over 6 timed tools",
    truncated: false,
  },
  deadLetters: { openNow: 2, bound: whole, windowed: false },
  feedback: { rated: 14, positive: 12, negative: 2, bound: whole, coverage: full },
  spend: { coverage: full, readAt: "2026-08-22" },
};
const operations = (over: Partial<Ops> = {}): Ops => ({ ...BASE_OPS, ...over });

describe("the window is one pinned anchor, and the periods are the server's", () => {
  test("every period is a half-open window ending at the SAME anchor", () => {
    const windows = PERIODS.map((p) => windowFor(NOW, p.days));
    expect(windows.every((w) => w.untilMs === NOW)).toBe(true);
    expect(windows.map((w) => NOW - w.sinceMs)).toEqual([
      7 * 86_400_000,
      30 * 86_400_000,
      90 * 86_400_000,
    ]);
  });

  test("the widest period stays inside the server's 91-day ceiling", () => {
    // A period the server refuses is a button that can only produce a governed refusal.
    const widest = Math.max(...PERIODS.map((p) => p.days));
    expect(widest * 86_400_000).toBeLessThanOrEqual(91 * 86_400_000);
  });
});

describe("operations renders the honest number, never a bare count", () => {
  test("a capped scan is a floor, not a total", () => {
    const html = render(OperationsSection, {
      data: operations({
        delivery: {
          sentCount: 1000,
          bound: { limit: 1000, returned: 1000, partial: true, nextCursor: null },
          coverage: full,
        },
      }),
      timeZone: TZ,
    });
    expect(html).toContain("at least 1000");
  });

  test("an unmeasured window renders WORDS, never a zero", () => {
    const html = render(OperationsSection, {
      data: operations({
        delivery: {
          sentCount: 0,
          bound: whole,
          coverage: { state: "unknown", reason: "not-started" },
        },
      }),
      timeZone: TZ,
    });
    expect(html).toContain("not measured");
    // The load-bearing assertion: "0 failures" and "we were not watching" are the same bytes and
    // different facts, and only one of them is safe to render.
    expect(html).not.toMatch(/>0</);
  });

  test("an unmeasured percentile renders what it NEEDS, never a number", () => {
    const html = render(OperationsSection, {
      data: operations({
        latency: {
          state: "unknown",
          needs: "at least 8 measured steps",
          included: 3,
          excluded: 12,
          population: "p95 over 6 timed tools",
          truncated: false,
        },
      }),
      timeZone: TZ,
    });
    expect(html).toContain("at least 8 measured steps");
    expect(html).toContain("3 measured, 12 excluded");
  });

  test("dead letters say they are point-in-time, because the type says so", () => {
    const html = render(OperationsSection, { data: operations(), timeZone: TZ });
    expect(html).toContain("open right now");
    expect(html).toContain("not a count for this window");
  });

  test("an unrecognised decision literal is reported, never silently dropped", () => {
    const html = render(OperationsSection, {
      data: operations({
        review: {
          terminals: 5,
          decisions: { approve: 4 },
          otherDecisions: 1,
          bound: whole,
          coverage: full,
        },
      }),
      timeZone: TZ,
    });
    expect(html).toContain("does not recognise");
  });
});

describe("business distinguishes 'nothing' from 'not built'", () => {
  test("no blueprint is a sentence, not a zero", () => {
    const empty: Biz = {
      blueprint: { state: "not-built" },
      evaluation: { state: "no-review-run" },
    };
    const html = render(BusinessSection, { data: empty, timeZone: TZ });
    expect(html).toContain("has not been written");
    expect(html).toContain("No review has run");
  });

  test("an incomparable snapshot pair says so instead of showing no movement", () => {
    // `verdict-insufficient` is a REAL member of `SnapshotComparison`'s reason union. An
    // unassessed run is neither a result nor a baseline, and rendering it as "no movement" would
    // report a hiccup as a clean sweep.
    const data: Biz = {
      blueprint: { state: "live", facts: { filled: 8, total: 11, missing: [] }, segments: [] },
      evaluation: {
        state: "run",
        framework: "swot",
        verdict: "insufficient",
        findingCount: 0,
        createdAt: NOW,
        scorecard: { filled: 2, total: 6, missing: [] },
        movement: { state: "incomparable", reason: "verdict-insufficient" },
      },
    };
    const html = render(BusinessSection, { data, timeZone: TZ });
    expect(html).toContain("not comparable");
    expect(html).toContain("verdict insufficient");
  });
});

describe("the governance table shows the record, and only the record", () => {
  const page = (over: Record<string, unknown> = {}) => ({
    window: {
      sinceMs: NOW - 86_400_000,
      untilMs: NOW,
      timeZone: TZ,
      timeZoneSource: "browser-fallback",
    },
    rows: [
      {
        ts: NOW,
        eventType: "plan.discarded",
        category: "plan",
        actor: "you",
        correlationRef: "c_7f3ad21",
        refs: { planId: "k17abc", kind: "media" },
        known: true,
        unsafeDrops: 0,
      },
    ],
    nextCursor: null,
    ...over,
  });

  test("an unknown event renders as a shell, never as a missing row", () => {
    const html = render(GovernanceSection, {
      page: page({
        rows: [
          {
            ts: NOW,
            eventType: "brand.new_event",
            category: "other",
            actor: "system",
            correlationRef: "c_1",
            refs: {},
            known: false,
            unsafeDrops: 0,
          },
        ],
      }),
      timeZone: TZ,
      onMore: () => {},
      loadingMore: false,
    });
    expect(html).toContain("brand.new_event");
    expect(html).toContain("no detail");
  });

  test("the page states that filtering, not the schema, is what makes it safe", () => {
    // The mockup claimed the opposite and 26-15 disproved it. If this copy ever reverts to a
    // schema claim, the page is telling the owner something the backend does not believe.
    const html = render(GovernanceSection, {
      page: page(),
      timeZone: TZ,
      onMore: () => {},
      loadingMore: false,
    });
    expect(html).toContain("server-side projection");
    expect(html).not.toContain("safe by construction");
  });

  test("'Show older' appears only when there IS an older page", () => {
    const withMore = render(GovernanceSection, {
      page: page({ nextCursor: "v1:1:x" }),
      timeZone: TZ,
      onMore: () => {},
      loadingMore: false,
    });
    const without = render(GovernanceSection, {
      page: page(),
      timeZone: TZ,
      onMore: () => {},
      loadingMore: false,
    });
    expect(withMore).toContain("Show older");
    expect(without).not.toContain("Show older");
  });
});

describe("the owner card reports a cursor position, never a health verdict", () => {
  const worm = (over: Record<string, unknown> = {}) => ({
    lastCursorAdvanceMs: NOW - 5 * 3_600_000,
    rowsAwaitingExport: 412,
    awaitingPartial: true,
    oldestAwaitingMs: NOW - 5 * 3_600_000,
    ...over,
  });
  const skills = [{ name: "cockpit-agent", version: 14, status: "active", gated: true }];

  test("no health word appears anywhere in the card", () => {
    const html = render(OwnerSection, { worm: worm(), skills, timeZone: TZ });
    expect(html).toContain("Last cursor advance");
    expect(html).toContain("not a durability receipt");
    for (const word of ["Healthy", "healthy", "Degraded", "OK"]) {
      expect(html, `the WORM card must not claim ${word}`).not.toContain(word);
    }
  });

  test("a never-advanced cursor says so instead of reading as zero lag", () => {
    const html = render(OwnerSection, {
      worm: worm({
        lastCursorAdvanceMs: null,
        rowsAwaitingExport: 0,
        awaitingPartial: false,
        oldestAwaitingMs: null,
      }),
      skills,
      timeZone: TZ,
    });
    expect(html).toContain("never advanced");
  });

  test("a capped backlog is marked as a floor", () => {
    expect(render(OwnerSection, { worm: worm(), skills, timeZone: TZ })).toContain("412+");
  });

  test("skill rows carry version and gate, and no body", () => {
    const html = render(OwnerSection, { worm: worm(), skills, timeZone: TZ });
    expect(html).toContain("cockpit-agent");
    expect(html).toContain("v14");
    expect(html).toContain("gated");
  });
});

describe("the module itself — properties no fixture can show", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "ReportsView.tsx"),
    "utf8",
  );
  const code = source
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");

  test("the window anchor is pinned at mount, never read live in render", () => {
    // The whole synchronization contract, and the reason a double-click is one artifact rather
    // than two: `landPack`'s replay key is the CONTENT hash, so a drifting upper bound makes every
    // click a different report.
    expect(code).toContain("useState(() => Date.now())");
    const nowCalls = [...code.matchAll(/Date\.now\(\)/g)];
    expect(nowCalls, "Date.now() belongs in exactly one place: the pinned anchor").toHaveLength(1);
  });

  test("a non-owner never calls an owner query", () => {
    // Hiding a control is presentation. NOT MAKING THE CALL is the behaviour, and `"skip"` is how
    // a hook expresses it without becoming conditional.
    expect(code).toContain('api.reportsGovernance.wormExport, isOwner ? {} : "skip"');
    expect(code).toContain('api.reportsGovernance.activeSkills, isOwner ? {} : "skip"');
  });

  test("every windowed subscription receives the SAME args object", () => {
    // Three sections and the pack action, one `args`. A second literal here is how one section
    // ends up a window behind the others.
    for (const call of [
      "api.reportsBusiness.business, args",
      "api.reportsBusiness.operations, args",
      "api.reportsGovernance.auditPage, { ...args, limit: auditLimit }",
      "generate(args)",
    ]) {
      expect(code, `expected ${call}`).toContain(call);
    }
  });

  test("the displayed window is the one the SERVER resolved", () => {
    expect(code).toContain("audit?.window ?? null");
  });

  test("the coverage vocabulary is imported from @pikar/core, not redefined here", () => {
    expect(code).toContain('from "@pikar/core"');
    for (const local of ["not measured — instrumentation", "at least ${", "const countCell"]) {
      expect(code, `${local} belongs to @pikar/core`).not.toContain(local);
    }
  });

  test("the page mints no URL of its own and writes nothing", () => {
    expect(code).toContain("api.vault.vaultDownloadUrl");
    expect(code).not.toContain("useMutation");
    expect(code).not.toContain("storage.getUrl");
  });
});
