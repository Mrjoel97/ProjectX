"use client";

// RPRT-01 — the Reports route (plan 26-17), the connected surface over the three read planes
// shipped in 26-14 (`business`, `operations`), 26-15 (`auditPage`, `wormExport`, `activeSkills`)
// and 26-16 (`generateBoardPack`).
//
// THE PAGE ADDS NO BACKEND SURFACE. Every subscription is an existing tenantQuery, the two
// deployment-global cards are existing ownerQuerys, and the download is `api.vault.vaultDownloadUrl`
// — the same ownership-checked minting the Vault and Content already use.
//
// **THE ONE DECISION EVERYTHING ELSE HANGS OFF: THE WINDOW IS PINNED ONCE PER MOUNT.**
// `anchorMs` is `useState(() => Date.now())`, so it is captured at mount and never recomputed.
// A live `Date.now()` in render would be wrong twice over:
//   • every re-render produces a new `untilMs`, so every Convex subscription gets a new query key
//     and the page re-fetches forever instead of staying reactive; and
//   • `reportPackData.landPack`'s own ponytail note names the second consequence — the replay key
//     is the CONTENT hash, so a drifting upper bound makes every click a different report and
//     fills the vault with near-duplicate packs. Pinning the anchor is what makes "generate twice,
//     get one artifact" true from the browser and not just from a test.
// Changing the period recomputes `sinceMs` from the SAME anchor, so all four sections move together
// and the pack a user downloads is the window they were looking at.
//
// THE COVERAGE VOCABULARY IS IMPORTED, NEVER RE-WRITTEN. `countCell`, `coverageWord`, `floorCell`,
// `fmtDate` and `fmtDateTime` come from `@pikar/core` — the same functions that render the PDF. A
// screen that said "0" where the pack says "not measured" would be the 26-14 defect (a fix that
// never reached the renderer) inverted, and the way two surfaces drift is each owning a copy.
import { api } from "@pikar/backend/api";
import {
  type CoverageLabel,
  countCell,
  coverageWord,
  floorCell,
  fmtDate,
  fmtDateTime,
} from "@pikar/core";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { type CSSProperties, useCallback, useMemo, useState } from "react";

type Business = FunctionReturnType<typeof api.reportsBusiness.business>;
type Operations = FunctionReturnType<typeof api.reportsBusiness.operations>;
type AuditPage = FunctionReturnType<typeof api.reportsGovernance.auditPage>;
type Worm = FunctionReturnType<typeof api.reportsGovernance.wormExport>;
type Skills = FunctionReturnType<typeof api.reportsGovernance.activeSkills>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The three periods. 90 is the server's own ceiling (`MAX_WINDOW_MS` is 91 days). */
export const PERIODS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;
export type PeriodDays = (typeof PERIODS)[number]["days"];

/**
 * ONE absolute window, from one pinned anchor — see the header. Exported so the component test can
 * assert the property directly rather than inferring it from rendered output.
 */
export function windowFor(anchorMs: number, days: PeriodDays) {
  return { sinceMs: anchorMs - days * DAY_MS, untilMs: anchorMs };
}

// ── styles ────────────────────────────────────────────────────────────────────────────
// Inline `CSSProperties` like ContentView/FinanceView: the mockup's class names are not in
// `globals.css` and the app deliberately has no component library (BRAND §8.3). Every grid uses
// `minmax(0, 1fr)` — an implicit `auto` column refuses to shrink below its widest item, which is
// what clipped the Cost Console at 390px in 26-10.
const stack: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr)",
  gap: "0.9rem",
};
const card: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: "1rem",
  padding: "1rem",
  boxShadow: "0 10px 30px color-mix(in srgb, var(--ink) 7%, transparent)",
  minWidth: 0,
};
const caps: CSSProperties = {
  color: "var(--ink-soft)",
  fontSize: "0.7rem",
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  margin: 0,
};
const muted: CSSProperties = { color: "var(--ink-soft)", margin: 0, lineHeight: 1.55 };
const button: CSSProperties = {
  minHeight: "2.5rem",
  borderRadius: "999px",
  padding: "0.5rem 1.1rem",
  border: "1px solid var(--rule)",
  background: "var(--card)",
  color: "var(--ink)",
  font: "inherit",
  fontSize: "0.86rem",
  fontWeight: 600,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: "0.4rem",
};
const activeButton: CSSProperties = {
  ...button,
  background: "var(--ink)",
  color: "var(--card)",
  borderColor: "var(--ink)",
};
const grid2: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 15rem), 1fr))",
  gap: "0.9rem",
};
const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.84rem",
};
const th: CSSProperties = { ...caps, textAlign: "left", padding: "0.4rem 0.6rem" };
const td: CSSProperties = {
  padding: "0.45rem 0.6rem",
  borderTop: "1px solid var(--rule)",
  verticalAlign: "top",
  minWidth: 0,
  overflowWrap: "anywhere",
};

// ── small presentational pieces ───────────────────────────────────────────────────────

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p style={caps}>{label}</p>
      <p style={{ margin: "0.2rem 0 0", fontSize: "1.35rem", fontWeight: 700 }}>{value}</p>
      {note ? <p style={{ ...muted, fontSize: "0.78rem", marginTop: "0.15rem" }}>{note}</p> : null}
    </div>
  );
}

const summaryStyle: CSSProperties = { cursor: "pointer", listStylePosition: "outside" };
const hintStyle: CSSProperties = {
  color: "var(--ink-soft)",
  fontSize: "0.78rem",
  fontWeight: 500,
  marginLeft: "0.5rem",
};

/**
 * One report section.
 *
 * Loading is its OWN state: `undefined` from `useQuery` is "not answered yet", never "nothing".
 *
 * **COLLAPSIBLE SECTIONS ARE `<details>`/`<summary>`, not a `useState` toggle** (owner UAT,
 * 2026-08-22: the governance and deployment cards were taking the whole page). The native element
 * brings keyboard operation, the disclosure triangle, correct AT semantics and the open/closed
 * state for free — a hand-rolled toggle would be re-implementing all four and getting the third
 * one wrong. `open` is deliberately absent, so a collapsible section starts CLOSED.
 *
 * A collapsed card still says whether it has anything in it, via `hint`. Hiding the content is
 * fine; hiding the *existence* of content would make an empty governance record and a full one
 * look identical, which is the same class of lie this page exists to avoid.
 */
export function Section({
  title,
  children,
  loading,
  collapsible = false,
  hint,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  loading: boolean;
  collapsible?: boolean;
  hint?: string;
  testId?: string;
}) {
  const body = (
    <div style={{ marginTop: "0.7rem" }}>
      {loading ? <p style={muted}>Loading {title.toLowerCase()}…</p> : children}
    </div>
  );

  if (!collapsible) {
    return (
      <section style={card} aria-busy={loading} data-testid={testId}>
        <p style={caps}>{title}</p>
        {body}
      </section>
    );
  }

  return (
    <details style={card} aria-busy={loading} data-testid={testId}>
      <summary style={summaryStyle}>
        <span style={{ ...caps, display: "inline" }}>{title}</span>
        {hint ? <span style={hintStyle}>{hint}</span> : null}
      </summary>
      {body}
    </details>
  );
}

// ── sections ──────────────────────────────────────────────────────────────────────────

export function BusinessSection({ data, timeZone }: { data: Business; timeZone: string }) {
  const { blueprint, evaluation } = data;
  return (
    <div style={grid2}>
      <div>
        <p style={caps}>Business blueprint</p>
        {blueprint.state === "not-built" ? (
          <p style={muted}>
            No blueprint yet — nothing here is a zero, it is a page that has not been written.
          </p>
        ) : (
          <>
            <p style={{ margin: "0.3rem 0 0", fontSize: "1.35rem", fontWeight: 700 }}>
              {blueprint.facts.filled} of {blueprint.facts.total} facts
            </p>
            <ul style={{ ...muted, paddingLeft: "1.1rem", margin: "0.4rem 0 0" }}>
              {blueprint.segments.map((s) => (
                <li key={s.id}>
                  {s.label}: {s.filled}/{s.total}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div>
        <p style={caps}>Latest review</p>
        {evaluation.state === "no-review-run" ? (
          <p style={muted}>No review has run in this window.</p>
        ) : (
          <>
            <p style={{ margin: "0.3rem 0 0", fontSize: "1.05rem", fontWeight: 700 }}>
              {evaluation.framework} — {evaluation.verdict}
            </p>
            <p style={{ ...muted, marginTop: "0.2rem" }}>
              {evaluation.findingCount} findings · scorecard {evaluation.scorecard.filled}/
              {evaluation.scorecard.total} · {fmtDateTime(evaluation.createdAt, timeZone)}
            </p>
            {/* The comparison is a discriminated union on purpose: "not comparable" is a distinct
                answer from "no movement", and collapsing them is how a report starts lying. */}
            <p style={{ ...muted, marginTop: "0.2rem" }}>
              {evaluation.movement.state === "comparable"
                ? `Movement: ${evaluation.movement.gapsClosed.length} gaps closed, ${evaluation.movement.gapsOpened.length} opened, ${evaluation.movement.newFindings} new findings`
                : `Movement: not comparable — ${evaluation.movement.reason.replace(/-/g, " ")}`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export function OperationsSection({ data, timeZone }: { data: Operations; timeZone: string }) {
  const { delivery, review, latency, deadLetters, feedback, spend } = data;
  return (
    <>
      <div style={grid2}>
        <Metric
          label="Sent"
          value={countCell(delivery.sentCount, delivery.bound, delivery.coverage, timeZone)}
          note={coverageWord(delivery.coverage, timeZone)}
        />
        <Metric
          label="Review terminals"
          value={countCell(review.terminals, review.bound, review.coverage, timeZone)}
          note={Object.entries(review.decisions)
            .map(([k, n]) => `${k} ${n}`)
            .join(" · ")}
        />
        {/* ONE percentile, and it names its own population. `unknown` renders what it NEEDS
            rather than a number — a p95 over three samples is a number, not an estimate — and the
            excluded count travels with it so the reader can see the denominator shrink. */}
        <Metric
          label="Tool latency"
          value={
            latency.state === "known"
              ? `${Math.round(latency.value / 100) / 10}s`
              : `not measured — ${latency.needs}`
          }
          note={`${latency.population} · ${latency.included} measured, ${latency.excluded} excluded${
            latency.truncated ? " · sampled" : ""
          }`}
        />
        <Metric
          label="Dead letters open"
          value={floorCell(deadLetters.openNow, deadLetters.bound)}
          // `windowed: false` is a TYPE-level statement in the read plane. Saying so on screen is
          // the difference between "2 failures this week" and "2 open right now".
          note="open right now — not a count for this window"
        />
        <Metric
          label="Feedback"
          value={countCell(feedback.rated, feedback.bound, feedback.coverage, timeZone)}
          note={`👍 ${feedback.positive} · 👎 ${feedback.negative}`}
        />
        <Metric
          label="Spend coverage"
          value={coverageWord(spend.coverage, timeZone)}
          note={spend.readAt}
        />
      </div>
      {review.otherDecisions > 0 ? (
        <p style={{ ...muted, marginTop: "0.7rem", fontSize: "0.78rem" }}>
          {review.otherDecisions} decision(s) carried a literal this build does not recognise —
          counted, never dropped.
        </p>
      ) : null}
    </>
  );
}

export function GovernanceSection({
  page,
  timeZone,
  onMore,
  loadingMore,
}: {
  page: AuditPage;
  timeZone: string;
  onMore: () => void;
  loadingMore: boolean;
}) {
  if (page.rows.length === 0) {
    return <p style={muted}>No governance events in this window.</p>;
  }
  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={th}>When</th>
              <th style={th}>Event</th>
              <th style={th}>Actor</th>
              <th style={th}>Correlation</th>
              <th style={th}>Refs</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => (
              <tr key={`${row.ts}-${row.correlationRef}-${row.eventType}`}>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDateTime(row.ts, timeZone)}</td>
                <td style={td}>
                  <b>{row.eventType}</b>
                  {/* An unknown event is rendered as a SHELL, never hidden. A governance record
                      with holes in it is worse than one with rows that say "no detail". */}
                  {row.known ? null : (
                    <span style={{ ...muted, display: "block", fontSize: "0.75rem" }}>
                      no detail — this build does not describe this event
                    </span>
                  )}
                </td>
                <td style={td}>{row.actor}</td>
                <td style={{ ...td, fontFamily: "var(--mono, ui-monospace, monospace)" }}>
                  {row.correlationRef}
                </td>
                <td style={td}>
                  {Object.entries(row.refs)
                    .map(([k, val]) => `${k}: ${Array.isArray(val) ? val.join(", ") : String(val)}`)
                    .join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ ...muted, marginTop: "0.7rem", fontSize: "0.78rem" }}>
        Rows carry refs, hashes, ids and counts only. That is enforced by a server-side projection —
        allowlisted keys per event, then a shape check — not by the schema.
      </p>
      {page.nextCursor === null ? null : (
        <button
          type="button"
          style={{ ...button, marginTop: "0.6rem" }}
          onClick={onMore}
          disabled={loadingMore}
        >
          {loadingMore ? "Loading…" : "Show older"}
        </button>
      )}
    </>
  );
}

export function OwnerSection({
  worm,
  skills,
  timeZone,
}: {
  worm: Worm;
  skills: Skills;
  timeZone: string;
}) {
  return (
    <div style={grid2}>
      <div>
        <p style={caps}>WORM export</p>
        {/* NO HEALTH PILL. `exportCursors` holds one number — the ts the exporter last SAID it had
            written. Nothing reads an S3 object back, so a run that died mid-upload after advancing
            looks identical. The mockup's green "Healthy" was corrected in 26-15; rendering one here
            would put the same claim back on the screen the backend refuses to make. */}
        <p style={{ margin: "0.3rem 0 0", fontSize: "1.05rem", fontWeight: 700 }}>
          {worm.lastCursorAdvanceMs === null
            ? "never advanced"
            : fmtDateTime(worm.lastCursorAdvanceMs, timeZone)}
        </p>
        <p style={{ ...muted, marginTop: "0.2rem" }}>
          Last cursor advance — a position, not a durability receipt.
        </p>
        <p style={{ ...muted, marginTop: "0.2rem" }}>
          {worm.rowsAwaitingExport}
          {worm.awaitingPartial ? "+" : ""} rows awaiting export
          {worm.oldestAwaitingMs === null
            ? ""
            : ` · oldest ${fmtDateTime(worm.oldestAwaitingMs, timeZone)}`}
        </p>
      </div>
      <div>
        <p style={caps}>Active skill versions</p>
        {skills.length === 0 ? (
          <p style={muted}>No active registry rows.</p>
        ) : (
          <table style={tableStyle}>
            <tbody>
              {skills.map((s) => (
                <tr key={s.name}>
                  <td style={td}>{s.name}</td>
                  <td style={{ ...td, textAlign: "right" }}>v{s.version}</td>
                  <td style={td}>{s.gated ? "gated" : "ungated"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── the page ──────────────────────────────────────────────────────────────────────────

type PackState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done"; vaultDocId: string; replayed: boolean; asOf: number; bytes: number }
  | { kind: "refused"; reason: string };

export function ReportsView() {
  // PINNED AT MOUNT — see the file header. This is the whole synchronization contract.
  const [anchorMs] = useState(() => Date.now());
  const [days, setDays] = useState<PeriodDays>(30);
  const [auditLimit, setAuditLimit] = useState(25);
  const [pack, setPack] = useState<PackState>({ kind: "idle" });

  const browserTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );
  // ONE window object, passed to every subscription by identity. Recomputed only when the period
  // changes, so switching periods moves all four sections in one step.
  const win = useMemo(() => windowFor(anchorMs, days), [anchorMs, days]);
  const args = useMemo(() => ({ ...win, browserTimeZone }), [win, browserTimeZone]);

  const viewer = useQuery(api.owner.viewer, {});
  const isOwner = viewer?.isOwner === true;

  const business = useQuery(api.reportsBusiness.business, args);
  const operations = useQuery(api.reportsBusiness.operations, args);
  const audit = useQuery(api.reportsGovernance.auditPage, { ...args, limit: auditLimit });
  // `"skip"` rather than a conditional hook: a non-owner must never CALL an ownerQuery, because the
  // refusal is the boundary and an error toast is not a design. Hiding a control is presentation;
  // not making the call is the actual behaviour.
  const worm = useQuery(api.reportsGovernance.wormExport, isOwner ? {} : "skip");
  const skills = useQuery(api.reportsGovernance.activeSkills, isOwner ? {} : "skip");

  const generate = useAction(api.reportPack.generateBoardPack);
  const downloadUrl = useQuery(
    api.vault.vaultDownloadUrl,
    pack.kind === "done" ? { vaultDocId: pack.vaultDocId as never } : "skip",
  );

  // The server echoes the window it RESOLVED. Displaying that rather than the one we asked for is
  // what makes "every section shows the same resolved window" checkable instead of assumed.
  const resolved = audit?.window ?? null;
  const timeZone = resolved?.timeZone ?? browserTimeZone;

  const onGenerate = useCallback(async () => {
    setPack({ kind: "busy" });
    const result = await generate(args);
    setPack(
      result.ok
        ? {
            kind: "done",
            vaultDocId: result.vaultDocId,
            replayed: result.replayed,
            asOf: result.asOf,
            bytes: result.bytes,
          }
        : { kind: "refused", reason: result.reason },
    );
  }, [generate, args]);

  return (
    <div style={{ ...stack, padding: "1rem", maxWidth: "72rem", margin: "0 auto" }}>
      <header>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Reports</h1>
        <p style={{ ...muted, marginTop: "0.3rem" }} data-testid="reports-window">
          {resolved === null
            ? "Resolving the window…"
            : `${fmtDate(resolved.sinceMs, timeZone)} → ${fmtDate(resolved.untilMs, timeZone)} · ${timeZone}${
                resolved.timeZoneSource === "browser-fallback" ? " (from your browser)" : ""
              }`}
        </p>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.7rem", flexWrap: "wrap" }}>
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              style={p.days === days ? activeButton : button}
              aria-pressed={p.days === days}
              onClick={() => {
                setDays(p.days);
                setAuditLimit(25); // a new window is a new record; keep paging honest
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      <Section title="Business" loading={business === undefined}>
        {business ? <BusinessSection data={business} timeZone={timeZone} /> : null}
      </Section>

      <Section title="Operations" loading={operations === undefined}>
        {operations ? <OperationsSection data={operations} timeZone={timeZone} /> : null}
      </Section>

      {/* COLLAPSED BY DEFAULT (owner UAT). The hint is what stops a closed card from hiding
          whether there is anything inside it — "0 shown" and "25 shown, more available" are
          different facts and a bare title states neither. */}
      <Section
        title="Governance record"
        loading={audit === undefined}
        collapsible
        testId="section-governance"
        hint={
          audit === undefined
            ? undefined
            : `${audit.rows.length} shown${audit.nextCursor === null ? "" : ", more available"}`
        }
      >
        {audit ? (
          <GovernanceSection
            page={audit}
            timeZone={timeZone}
            onMore={() => setAuditLimit((n) => n + 25)}
            loadingMore={false}
          />
        ) : null}
      </Section>

      {isOwner ? (
        <Section
          title="Deployment (owner only)"
          loading={worm === undefined || skills === undefined}
          collapsible
          testId="section-deployment"
          hint={skills === undefined ? undefined : `${skills.length} active skills`}
        >
          {worm && skills ? <OwnerSection worm={worm} skills={skills} timeZone={timeZone} /> : null}
        </Section>
      ) : null}

      <section style={card}>
        <p style={caps}>Board pack</p>
        <p style={{ ...muted, marginTop: "0.4rem" }}>
          One PDF rendered from a single snapshot of the window above. Generating twice for the same
          window returns the same file.
        </p>
        <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.7rem", flexWrap: "wrap" }}>
          <button
            type="button"
            style={activeButton}
            onClick={onGenerate}
            disabled={pack.kind === "busy"}
          >
            {pack.kind === "busy" ? "Generating…" : "Generate board pack"}
          </button>
          {pack.kind === "done" && downloadUrl ? (
            <a style={button} href={downloadUrl} download>
              Download PDF
            </a>
          ) : null}
        </div>
        {pack.kind === "done" ? (
          <p style={{ ...muted, marginTop: "0.6rem" }} data-testid="pack-result">
            {pack.replayed ? "Already generated for this window — " : "Generated — "}
            as of {fmtDateTime(pack.asOf, timeZone)} · {pack.bytes} bytes
          </p>
        ) : null}
        {pack.kind === "refused" ? (
          <p style={{ ...muted, marginTop: "0.6rem" }} data-testid="pack-result">
            {pack.reason === "window_invalid"
              ? "That period is outside what a report can cover."
              : "Rendering the pack failed, and nothing was saved. Try again."}
          </p>
        ) : null}
      </section>
    </div>
  );
}

export type { CoverageLabel };
