// Content library component contracts, in the DOM-free runner (CONT-01, plan 26-13).
//
// `.test.ts`, NOT `.test.tsx` — `apps/web/vitest.config.mts` includes `app/**/*.test.ts` only, and
// its own header records why: a `.tsx` here is silently skipped, which is exactly how a test file
// becomes decoration. The plan named `contentView.test.tsx`; this is the same file under the name
// the runner can actually see. Components are built with `createElement` and rendered to a STRING
// with `renderToStaticMarkup`, so no jsdom is needed and only the hook-free exports are importable.
//
// The last describe is a SOURCE SCAN. Two of this plan's requirements are about what the page does
// NOT contain — no sent-mail lane, no research card, no Refresh Research — and an absence is proven
// by reading the module, not by rendering one fixture and finding nothing.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  ArtifactCard,
  CONTENT_STATE_COPY,
  ContentStateNotice,
  countLabel,
  formatBytes,
  formatDay,
  LaneFilters,
  PROMOTION_ONE_WAY,
  reelUnprovedCopy,
  typeBadge,
  WhereItLivesNote,
} from "./ContentView";

// ONE cast so the fixtures stay readable. These tests assert RENDERED OUTPUT; the prop TYPES are
// enforced where the components are used, in `ContentView.tsx`, against the generated Convex API —
// so a fixture drifting from the real shape shows up there (the financeView.test.ts rule).
const render = (component: unknown, props: Record<string, unknown>): string =>
  renderToStaticMarkup(createElement(component as ComponentType<Record<string, unknown>>, props));

const noop = () => {};
const actions = {
  open: noop,
  play: noop,
  askPromote: noop,
  confirmPromote: noop,
  cancelPromote: noop,
};

type CardOver = Record<string, unknown>;
const artifact = (over: CardOver = {}): CardOver => ({
  vaultDocId: "doc_1",
  lane: "document",
  title: "Northfield — Q3 scope and pricing",
  createdAt: Date.UTC(2026, 7, 2, 12, 0, 0),
  status: "ready",
  failureReason: null,
  sizeBytes: 86_016,
  bytes: { state: "available", mimeType: "application/pdf" },
  provenance: { state: "known", threadId: "thread-1", planId: "plan_1" },
  reuse: { state: "available", href: "/dashboard/workspace?thread=thread-1" },
  promotion: { state: "eligible" },
  reel: null,
  ...over,
});

const cardProps = (over: CardOver = {}, rest: Record<string, unknown> = {}) => ({
  card: artifact(over),
  actions,
  timeZone: "UTC",
  confirming: false,
  busy: false,
  note: null,
  playing: false,
  ...rest,
});

describe("honest labels", () => {
  test("a capped count says so instead of stating a wrong exact number", () => {
    expect(countLabel(3, false)).toBe("3");
    expect(countLabel(50, true)).toBe("50+");
    expect(countLabel(0, false)).toBe("0");
  });

  test("the type badge names the BYTES when they differ from the row", () => {
    // An agent-authored long document is a markdown row carrying a rendered PDF; the badge has to
    // say what the reader will actually download.
    expect(typeBadge(artifact() as never)).toBe("Doc · PDF");
    expect(typeBadge(artifact({ lane: "memo", bytes: { state: "none" } }) as never)).toBe("Memo");
    expect(
      typeBadge(
        artifact({ lane: "reel", bytes: { state: "available", mimeType: "video/mp4" } }) as never,
      ),
    ).toBe("Reel · MP4");
  });

  test("dates format in the NAMED zone the caller supplies, never server-local", () => {
    const newYearUtc = Date.UTC(2026, 0, 1, 2, 0, 0);
    expect(formatDay(newYearUtc, "UTC")).toBe("Jan 1, 2026");
    expect(formatDay(newYearUtc, "America/Los_Angeles")).toBe("Dec 31, 2025");
  });

  test("sizes read as sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(86_016)).toBe("84 KB");
    expect(formatBytes(5_242_880)).toBe("5.0 MB");
  });

  test("every reel refusal reason has its own sentence — none is silent", () => {
    const reasons = ["no-plan", "no-bytes", "no-sidecar", "superseded"] as const;
    const copies = reasons.map((reason) => reelUnprovedCopy(reason));
    expect(new Set(copies).size).toBe(reasons.length);
    for (const copy of copies) expect(copy.length).toBeGreaterThan(20);
  });

  test("each page state is announced, not just styled", () => {
    const html = render(ContentStateNotice, { state: "processing" });
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-content-state="processing"');
    expect(html).toContain(CONTENT_STATE_COPY.processing);
  });
});

describe("the artifact card offers exactly the terminals the row has earned", () => {
  test("a promotable document offers Open, Reuse and Promote — and no Play", () => {
    const html = render(ArtifactCard, cardProps());
    expect(html).toContain('data-testid="open-artifact"');
    expect(html).toContain('data-testid="reuse-artifact"');
    expect(html).toContain("/dashboard/workspace?thread=thread-1");
    expect(html).toContain('data-testid="promote-artifact"');
    expect(html).not.toContain('data-testid="play-reel"');
  });

  test("a memo reads rather than opens, and is never offered promotion", () => {
    // A memo is ingested by its own write site, so it is already reference material.
    const html = render(
      ArtifactCard,
      cardProps({ lane: "memo", bytes: { state: "none" }, promotion: { state: "not-applicable" } }),
    );
    expect(html).toContain(">Read<");
    expect(html).not.toContain('data-testid="promote-artifact"');
  });

  test("an already-promoted document shows it and offers no second promotion", () => {
    const html = render(ArtifactCard, cardProps({ promotion: { state: "promoted" } }));
    expect(html).toContain("Reference material");
    expect(html).not.toContain('data-testid="promote-artifact"');
  });

  test("a failed promotion offers a retry, worded as one", () => {
    const html = render(
      ArtifactCard,
      cardProps({
        promotion: { state: "retry" },
        status: "failed",
        failureReason: "embed timeout",
      }),
    );
    expect(html).toContain("Try promoting again");
    expect(html).toContain("embed timeout");
  });

  test("a PROVED reel gets Play and a canvas link; an unproved one gets the reason instead", () => {
    const proved = render(
      ArtifactCard,
      cardProps({
        lane: "reel",
        bytes: { state: "available", mimeType: "video/mp4" },
        promotion: { state: "not-applicable" },
        reel: {
          planId: "plan_1",
          renderStatus: "rendered",
          canvasHref: "/dashboard/workspace?thread=thread-1&view=canvas",
          playback: { state: "proved" },
        },
      }),
    );
    expect(proved).toContain('data-testid="play-reel"');
    expect(proved).toContain('data-testid="open-canvas"');

    const unproved = render(
      ArtifactCard,
      cardProps({
        lane: "reel",
        bytes: { state: "available", mimeType: "video/mp4" },
        promotion: { state: "not-applicable" },
        reel: {
          planId: "plan_1",
          renderStatus: "pending",
          canvasHref: "/dashboard/workspace?thread=thread-1&view=canvas",
          playback: { state: "unproved", reason: "no-sidecar" },
        },
      }),
    );
    expect(unproved).not.toContain('data-testid="play-reel"');
    expect(unproved).toContain(reelUnprovedCopy("no-sidecar"));
    // The canvas is still reachable — an unplayable reel is not an unreachable one.
    expect(unproved).toContain('data-testid="open-canvas"');
  });

  test("a legacy artifact says its conversation is unknown instead of linking somewhere", () => {
    const html = render(
      ArtifactCard,
      cardProps({
        provenance: { state: "unknown" },
        reuse: { state: "unavailable", reason: "unknown-thread" },
      }),
    );
    expect(html).toContain('data-testid="reuse-unavailable"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('data-testid="reuse-artifact"');
    expect(html).not.toContain("/dashboard/workspace?thread=");
  });

  test("processing is a state on the card, not an absence", () => {
    const html = render(ArtifactCard, cardProps({ status: "processing" }));
    expect(html).toContain('data-content-state="processing"');
    expect(html).toContain(CONTENT_STATE_COPY.processing);
  });
});

describe("promotion explains itself BEFORE it happens", () => {
  test("the confirm step states the citation effect and that it is one-way", () => {
    const html = render(ArtifactCard, cardProps({}, { confirming: true }));
    expect(html).toContain('data-testid="promote-confirm"');
    expect(html).toContain(PROMOTION_ONE_WAY);
    expect(html).toContain("cannot be undone");
    expect(html).toContain('data-testid="promote-confirm-button"');
    // A way out that is not the destructive one.
    expect(html).toContain("Keep it editable");
  });

  test("the promise the copy makes is the one the backend enforces", () => {
    // `patchCreatedDoc` refuses any row whose `origin !== "agent"`, so "it can no longer be
    // rewritten in this conversation" is a real consequence — not a caution.
    expect(PROMOTION_ONE_WAY).toContain("reference material");
    expect(PROMOTION_ONE_WAY).toContain("can no longer be rewritten");
  });

  test("a busy confirm cannot be double-fired", () => {
    const html = render(ArtifactCard, cardProps({}, { confirming: true, busy: true }));
    expect(html).toContain("disabled");
    expect(html).toContain(CONTENT_STATE_COPY.busy);
  });
});

describe("the filter chips and the moved surfaces", () => {
  test("counts render per lane and the active chip is pressed", () => {
    const html = render(LaneFilters, {
      summary: {
        lanes: {
          document: { count: 11, capped: false },
          memo: { count: 1, capped: false },
          reel: { count: 50, capped: true },
        },
        total: { count: 62, capped: true },
      },
      active: "reel",
      onSelect: noop,
    });
    expect(html).toContain("Documents");
    expect(html).toContain(">11<");
    expect(html).toContain(">50+<");
    expect(html).toMatch(/data-lane="reel"[^>]*/);
    expect(html).toContain('aria-pressed="true"');
  });

  test("with no summary yet the chips render without inventing a zero", () => {
    const html = render(LaneFilters, { summary: undefined, active: "all", onSelect: noop });
    expect(html).toContain("Documents");
    expect(html).not.toContain(">0<");
  });

  test("the page names Reports as sent mail's owner and links the Vault for research", () => {
    const html = render(WhereItLivesNote, {});
    expect(html).toContain("Reports");
    expect(html).toContain("Sent email");
    expect(html).toContain("/dashboard/vault");
    // Reports has no route yet, so it is named and NOT linked — the nav's own no-dead-links rule.
    expect(html).not.toContain("/dashboard/reports");
  });
});

const here = dirname(fileURLToPath(import.meta.url));

/**
 * CODE ONLY — comments are stripped before the scan below reads the module.
 *
 * Not a nicety: the first version of these assertions failed against the file's own header, which
 * explains at length that there is no recipient state and no Refresh Research action. A scan that
 * trips on the documentation of the property it is checking is a scan nobody can keep green, and
 * the fix is not to stop writing the explanation. `llmRedaction.test.ts` learned the same lesson
 * the same way (a JSDoc backtick turned its template-literal scan into a false positive).
 */
function stripComments(source: string): string {
  return (
    source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      // Cut at the first `//` that is not part of a `://` scheme.
      .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
      .join("\n")
  );
}

const viewSource = stripComments(readFileSync(join(here, "ContentView.tsx"), "utf8"));

describe("the surfaces CONT-01 moved away are absent from the page (source scan)", () => {
  test("no sent-mail lane, no recipient state, no delivery read", () => {
    // Reports owns the record of what happened. `requests` is the delivery-spine table; the page
    // must not read it, and it must not grow a recipients column by another name.
    expect(viewSource).not.toMatch(/api\.requests\b/);
    expect(viewSource).not.toMatch(/\brecipients?\b/i);
    expect(viewSource).not.toMatch(/sent mail|sent-mail/i);
  });

  test("no research-brief card and no Refresh Research action", () => {
    expect(viewSource).not.toMatch(/Refresh Research/i);
    expect(viewSource).not.toMatch(/web_research/);
    expect(viewSource).not.toMatch(/api\.research\b/);
  });

  test("promotion goes to the ONE guarded surface, never a Content re-wrap", () => {
    expect(viewSource).toContain("api.vault.promoteToReference");
    expect(viewSource).not.toMatch(/api\.content\.promote/);
    // …and the audit is a separate caller-side call, not something vault.ts grew.
    expect(viewSource).toContain("api.contentAudit.recordPromotion");
  });

  test("no URL is minted eagerly: the modal and the player mount only when opened", () => {
    // The card carries ids. `vault.vaultDoc` (which the modal uses to reach a signed URL) and
    // `media.reel` must not be subscribed for every row on the shelf.
    expect(viewSource).not.toMatch(/api\.vault\.vaultDownloadUrl/);
    expect(viewSource).toMatch(/openId !== null \? <ArtifactModal/);
    expect(viewSource).toMatch(/playing \? player : null/);
  });
});
