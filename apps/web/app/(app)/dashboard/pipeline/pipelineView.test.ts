// The Pipeline page's component contracts, in the DOM-free runner (19-VALIDATION row 19).
//
// `.test.ts`, NOT `.test.tsx` — `apps/web/vitest.config.mts` includes `app/**/*.test.ts` ONLY, so a
// `.tsx` here is SILENTLY SKIPPED and reads as coverage in the diff while asserting nothing.
// Components are built with `createElement` and rendered to a STRING with `renderToStaticMarkup`;
// only hook-free / prop-driven exports are importable, which is why every `useQuery` piece stays
// module-private in `PipelineView.tsx`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  ContactsEmptyState,
  ContactTable,
  ORIGIN_LABELS,
  PipelineTiles,
  UnassignedFollowUps,
} from "./PipelineView";

const render = (component: unknown, props: Record<string, unknown>): string =>
  renderToStaticMarkup(createElement(component as ComponentType<Record<string, unknown>>, props));

const rawSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "PipelineView.tsx"),
  "utf8",
);

/** Comments are stripped before every source scan below, the `contacts.test.ts` rule: the file
 *  carries deliberate GRAVESTONE comments naming what is absent and WHY (no `window.confirm`, no
 *  `--held`, no opportunity concept), and a scan that punished its own documentation would force
 *  the absence to go unexplained. */
const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 9, 12, 0, 0);

const noop = () => {};
const handlers = {
  suppress: noop,
  arm: noop,
  cancelArm: noop,
  unsuppress: noop,
  toggleFollowUp: noop,
  createFollowUp: noop,
};

const contact = (over: Record<string, unknown> = {}) => ({
  contactId: "c1",
  email: "dana@example.com",
  name: "Dana Reeve",
  origin: "user-entered",
  lastTouchAt: NOW - DAY,
  nextStep: { followUpId: "f1", note: "Send the revised quote", dueAt: NOW + DAY },
  consent: { at: NOW - 30 * DAY, source: "asserted-by-user" },
  suppressed: false,
  ...over,
});

const table = (rows: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) =>
  render(ContactTable, {
    rows,
    armed: null,
    followUpFor: null,
    busy: false,
    on: handlers,
    ...over,
  });

describe("the four tiles are ALWAYS-KNOWN counts (invariant 3)", () => {
  test("a brand-new empty tenant reads FOUR real zeroes, and no hedge anywhere", () => {
    const html = render(PipelineTiles, {
      tiles: {
        needingAttention: 0,
        followUpsDue: 0,
        consentOnRecord: 0,
        suppressed: 0,
        partial: null,
      },
    });
    // Four rendered values, each an actual `0`. `split` counts occurrences of the VALUE cell, so a
    // label that happened to contain a zero could not fake this.
    expect(html.split(">0<").length - 1).toBe(4);
    // The 26-10 defect (commit 1a63992) stated from the other side: there the fix was to stop
    // printing a number the system did not know; here it is to stop HEDGING one it does know.
    // Asserted as an ABSENCE, because a tile that reads "—" still renders and still looks fine.
    expect(html).not.toContain("—");
    expect(html).not.toContain("Unknown");
    expect(html).not.toMatch(/not tracked|no data/i);
  });

  test("real counts render as themselves and each tile is separately addressable", () => {
    const html = render(PipelineTiles, {
      tiles: {
        needingAttention: 3,
        followUpsDue: 7,
        consentOnRecord: 2,
        suppressed: 1,
        partial: null,
      },
    });
    for (const value of [">3<", ">7<", ">2<", ">1<"]) expect(html).toContain(value);
    for (const id of ["needing-attention", "followups-due", "consent", "suppressed"]) {
      expect(html).toContain(`data-testid="pipeline-tile-${id}"`);
    }
    // Under the bound the counts are EXACT totals, so nothing may suggest "at least". This is the
    // non-vacuity floor for the `row-cap` case below.
    expect(html).not.toContain("+");
  });

  test("PAST the backend's scan bound every value reads as a FLOOR — `1000+`, still never Unknown", () => {
    // `partial: "row-cap"` is what `pipelineTiles` returns once any of its three scans hits
    // SCAN_LIMIT (19.1-05) — reachable with ONE max-size CSV import into a non-empty book.
    const html = render(PipelineTiles, {
      tiles: {
        needingAttention: 1000,
        followUpsDue: 12,
        consentOnRecord: 1000,
        suppressed: 4,
        partial: "row-cap",
      },
    });
    for (const value of [">1000+<", ">12+<", ">4+<"]) expect(html).toContain(value);
    // A floor is still a NUMBER the page knows. Invariant 3 bans hedging ("we can't say"), not
    // honesty about a bound — so the same absences must still hold here.
    expect(html).not.toContain("—");
    expect(html).not.toContain("Unknown");
    expect(html).not.toMatch(/not tracked|no data/i);
    // And `partial` itself must never leak into a stat cell as a fifth tile.
    expect(html).not.toContain("row-cap");
    expect(html.split('data-testid="pipeline-tile-').length - 1).toBe(4);
    // The e2e integer-parse assertion still works on this markup.
    expect(Number.parseInt("1000+", 10)).toBe(1000);
  });
});

describe("the contact table", () => {
  test("a contact with NO NAME shows its address, never a blank and never Unknown", () => {
    const html = table([contact({ name: null })]);
    expect(html).toContain("dana@example.com");
    expect(html).not.toContain("Unknown");
    // The Contact cell is not empty: the address is inside it, not only in a later column.
    expect(html).toMatch(/data-testid="contact-name"[^>]*>dana@example\.com</);
  });

  test("consent: null reads 'none on record' — the truth, never 'consented'", () => {
    const html = table([contact({ consent: null })]);
    expect(html).toContain("none on record");
    expect(html).not.toMatch(/>Consented/);
  });

  test("lastTouchAt: null is an explicit no-contact-yet, distinct from 0", () => {
    const html = table([contact({ lastTouchAt: null })]);
    expect(html).toContain("No contact yet");
    expect(html).not.toContain(">0<");
  });

  test("the table carries no em-dash row: one row per PERSON, contactless work lives elsewhere", () => {
    const html = table([contact(), contact({ contactId: "c2", email: "sam@example.com" })]);
    expect(html.split('data-testid="pipeline-contact-row"').length - 1).toBe(2);
    expect(html).not.toContain("—");
  });

  test("nothing scheduled is stated, not left blank", () => {
    const html = table([contact({ nextStep: null })]);
    expect(html).toContain("Nothing scheduled");
  });
});

// SILENT SITE 3 (19.1-02). Widening `origin` and `consentSource` in the schema produces a compile
// error at 16 of the 19 consuming sites. This file is where the OTHER THREE live: a label map keyed
// by a literal type tsc never checked against the read model, and a consent cell that rendered a
// date and threw the source away. 19-06 shipped `media` through exactly this gap for a whole phase.
describe("the widened unions are REGISTERED here, where tsc is silent", () => {
  test("ORIGIN_LABELS is bound to the read model AT THE DECLARATION and covers `imported`", () => {
    // `as const satisfies Record<ContactRow["origin"], string>` makes a future origin fail on THIS
    // declaration rather than resolve to `undefined` inside a JSX index expression. tsc enforces
    // the bind; this scan is what stops the bind itself being quietly deleted.
    expect(source).toContain("satisfies Record<");
    expect(ORIGIN_LABELS.imported).toBe("Imported from a file");
    expect(Object.keys(ORIGIN_LABELS)).toHaveLength(4);
  });

  test("an imported contact SAYS SO — never a blank, never Unknown", () => {
    const html = table([contact({ origin: "imported" })]);
    expect(html).toContain("Imported from a file");
    expect(html).not.toContain("Unknown");
  });

  test("the consent chip renders its SOURCE: a batch attestation reads differently", () => {
    const at = NOW - 30 * DAY;
    const asserted = table([contact({ consent: { at, source: "asserted-by-user" } })]);
    const imported = table([contact({ consent: { at, source: "imported-attested" } })]);
    // Same day, same everything: the ONLY difference between these two renders is the source.
    expect(asserted).toContain("Consented");
    expect(imported).toContain("Consented");
    // They must DIFFER. Asserting only that the imported chip says "imported" would still pass if
    // the suffix were appended to EVERY chip — which is the flattening this test exists to catch.
    expect(imported).not.toBe(asserted);
    expect(imported).toContain("imported");
    expect(asserted).not.toContain("imported");
  });

  test("consent: null is still 'none on record' — a source is not invented for absent consent", () => {
    const html = table([contact({ consent: null })]);
    expect(html).toContain("none on record");
    expect(html).not.toContain("imported");
    expect(html).not.toMatch(/>Consented/);
  });
});

describe("the empty state", () => {
  test("zero contacts replaces the table with ONE action and no mailbox suggestions", () => {
    const html = render(ContactsEmptyState, { onAdd: noop });
    expect(html).toContain("Add your first contact");
    // EXACTLY one action. A second button here is the "seeded suggestions from recent mail" idea
    // creeping back in, which reads the mailbox to propose contacts and breaks invariant 1.
    expect(html.split("<button").length - 1).toBe(1);
    expect(html).not.toContain("<a ");
    expect(html).not.toMatch(/suggest|recent mail|from your inbox/i);
  });
});

describe("contactless follow-ups own their section", () => {
  test("they render their notes beneath the table, not inside it", () => {
    const html = render(UnassignedFollowUps, {
      followUps: [{ followUpId: "f9", note: "Chase the supplier quote", dueAt: NOW + DAY }],
    });
    expect(html).toContain("Chase the supplier quote");
    expect(html).toContain('data-testid="pipeline-unassigned"');
  });

  test("the section is rendered BELOW the contact table on the page", () => {
    const contactsAt = source.indexOf("<ConnectedContacts");
    const unassignedAt = source.indexOf("<ConnectedUnassigned");
    expect(contactsAt).toBeGreaterThan(-1);
    expect(unassignedAt).toBeGreaterThan(contactsAt);
  });
});

describe("un-suppressing is a two-step arm/commit", () => {
  test("a suppressed row offers ONE arming control and no confirm until it is armed", () => {
    const html = table([contact({ suppressed: true })]);
    expect(html).toContain('data-testid="contact-unsuppress-arm"');
    expect(html).not.toContain('data-testid="contact-unsuppress-confirm"');
    // A suppressed contact must not also be offered "mark suppressed".
    expect(html).not.toContain('data-testid="contact-suppress"');
  });

  test("armed, it states that re-subscribing without fresh consent is the user's responsibility", () => {
    const html = table([contact({ suppressed: true })], { armed: "dana@example.com" });
    expect(html).toContain('data-testid="contact-unsuppress-confirm"');
    expect(html).toMatch(/your responsibility/i);
  });

  test("NO window.confirm anywhere on this page — a browser modal blocks the Playwright spec", () => {
    expect(source).not.toContain("window.confirm");
    expect(source).not.toContain("confirm(");
  });
});

describe("the page stays inside the Phase 19 substrate", () => {
  test("no opportunity, no deal state, no monetary value (PIPE-01 / SC#8)", () => {
    // Non-vacuity floor: a bad read yields "" and every `not.toMatch` here would pass.
    expect(source.length).toBeGreaterThan(4_000);
    expect(/amountCents|opportunit|\bstage\b/i.test("amountCents")).toBe(true);
    expect(source).not.toMatch(/amountCents|opportunit|\bstage\b/i);
    expect(source).not.toContain("DashboardMoney");
  });

  test("page state prose comes from the code-owned DASHBOARD_STATE_COPY, not the backend", () => {
    expect(source).toContain("DASHBOARD_STATE_COPY");
  });

  test("every section owns its own useQuery, so one failing read cannot erase the page", () => {
    expect(source.split("useQuery(api.contacts.").length - 1).toBe(3);
  });

  test("the dark marketing .ledger block and the approval-gate amber are both absent", () => {
    expect(source).not.toContain('className="ledger');
    expect(source).not.toContain("--held");
  });
});
