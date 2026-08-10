"use client";

// The Pipeline page (SC#8 / PIPE-01) — a narrow CONNECTED view over the Phase-19 substrate.
//
// THIS PAGE HAS NO STATE OF ITS OWN. Every number on it is derived from `contacts`, `followUps`,
// `suppressions` and the delivery spine's existing `requests` rows, read through the three
// `convex/contacts.ts` read models. There is no opportunity concept, no deal state and no monetary
// value here, and there never will be inside Phase 19: PIPE-01's whole worry is a SECOND CRM data
// plane, and "Pipeline value" is how one starts. Real money arrives with Phase 28's
// connector-backed Cash surface, from observed provider data rather than typed guesses.
//
// THE FOUR TILES ARE ALWAYS-KNOWN COUNTS (docs/playbooks/contacts-crm.md invariant 3). Contacts and
// follow-ups have NO coverage-start concept — the substrate is created by the user, so "we weren't
// watching then" cannot apply. A real zero therefore renders as `0`: never `—`, never `Unknown`.
// That is the 26-10 UAT defect (commit 1a63992) stated from the other side; there the fix was to
// stop printing a number the system did not know, here it is to stop hedging one it does.
//
// The nav item stays `soon: true`. `apps/web/app/(app)/layout.tsx` keys off `href`, not `soon`, so
// ADDING THE HREF IS THE ACTIVATION and 26-18 owns it — this route is reachable by URL only.
//
// Styling is inline `CSSProperties` over the `globals.css` tokens (the ApprovalsView/FinanceView
// idiom) plus the five REAL shared classes (`stat-grid`, `stat-tile`, `stat-head`, `stat-value`,
// `caps-label`). `.card`, `.pill`, `.btn`, `.note` are mockup-only, and `.ledger` IS defined but is
// the DARK marketing audit block from the landing page — applying it to this table would render it
// on a navy panel. Zero `--held` amber: BRAND §2 reserves it for the approval gate.
import { api } from "@pikar/backend/api";
import { DASHBOARD_STATE_COPY } from "@pikar/core";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { type CSSProperties, type ReactNode, useState } from "react";

type ContactsResult = FunctionReturnType<typeof api.contacts.listContacts>;
type ContactRow = ContactsResult["contacts"][number];
type UnassignedResult = FunctionReturnType<typeof api.contacts.listUnassignedFollowUps>;
type UnassignedRow = UnassignedResult["followUps"][number];
type Tiles = FunctionReturnType<typeof api.contacts.pipelineTiles>;

/** Every row action this page offers. Read + mark suppressed + add follow-up, and that is all —
 *  full inline contact editing is deliberately deferred (playbook "Known gaps"). */
export type PipelineActions = {
  suppress: (email: string) => void;
  arm: (email: string) => void;
  cancelArm: () => void;
  unsuppress: (email: string) => void;
  toggleFollowUp: (contactId: string) => void;
  createFollowUp: (contactId: string, note: string, dueDate: string) => void;
};

// ── styles ────────────────────────────────────────────────────────────────────
const stack: CSSProperties = { display: "grid", gap: "0.75rem" };
const muted: CSSProperties = { color: "var(--ink-soft)", margin: 0, lineHeight: 1.55 };
const cardTitle: CSSProperties = {
  margin: 0,
  fontSize: "1.05rem",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: "var(--ink)",
};
const caps: CSSProperties = {
  color: "var(--ink-soft)",
  fontSize: "0.7rem",
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  margin: 0,
};
const card: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: "1rem",
  padding: "1rem",
  boxShadow: "0 10px 30px color-mix(in srgb, var(--ink) 7%, transparent)",
};
const button: CSSProperties = {
  minHeight: "2.5rem",
  borderRadius: "999px",
  padding: "0.45rem 1rem",
  border: "1px solid var(--rule)",
  background: "var(--card)",
  color: "var(--ink)",
  font: "inherit",
  fontSize: "0.86rem",
  fontWeight: 600,
  cursor: "pointer",
};
const primary: CSSProperties = {
  ...button,
  borderColor: "var(--teal-600)",
  background: "var(--teal-600)",
  color: "var(--card)",
};
/** BRAND §5's executive report card: aligned columns, ruled sections, card-native whitespace, and
 *  no gridlines. Never a dense spreadsheet, and never the dark `.ledger` panel. */
const table: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" };
const th: CSSProperties = {
  ...caps,
  textAlign: "left",
  padding: "0.45rem 0.55rem",
  borderBottom: "1px solid var(--rule)",
  whiteSpace: "nowrap",
};
const td: CSSProperties = {
  padding: "0.6rem 0.55rem",
  borderBottom: "1px solid color-mix(in srgb, var(--rule) 55%, transparent)",
  verticalAlign: "top",
  color: "var(--ink)",
};
/** A data table must never make the PAGE scroll sideways. */
const scroller: CSSProperties = { overflowX: "auto" };
/** Teal lives in the FILL, `--ink` carries the label: BRAND §6 bans `--teal-600` as small text
 *  (~2.9:1 on white). No amber anywhere — that is the approval gate's alone (BRAND §2). */
const chip: CSSProperties = {
  display: "inline-block",
  borderRadius: "999px",
  padding: "0.15rem 0.6rem",
  fontSize: "0.78rem",
  fontWeight: 600,
  color: "var(--ink)",
  background: "color-mix(in srgb, var(--teal-400) 30%, var(--card))",
  border: "1px solid color-mix(in srgb, var(--teal-400) 45%, var(--rule))",
  whiteSpace: "nowrap",
};
const quietChip: CSSProperties = {
  ...chip,
  color: "var(--ink-soft)",
  background: "color-mix(in srgb, var(--rule) 30%, var(--card))",
  borderColor: "var(--rule)",
};

// ── pure helpers ──────────────────────────────────────────────────────────────

/**
 * Where the DATA on a contact row came from — provenance, not who triggered the write.
 *
 * `satisfies Record<ContactRow["origin"], string>` is a COMPILE-TIME BIND to the read model, added
 * by 19.1-02. Before it, widening `contacts.origin` in the schema left this map silently short and
 * `ORIGIN_LABELS[row.origin]` resolved to `undefined` inside the JSX — a BLANK chip, no error, and
 * nothing for tsc to say. The next new origin now fails HERE, at the declaration. Keep the
 * `satisfies` (not an annotation): the annotation would widen the values back to `string`.
 */
export const ORIGIN_LABELS = {
  "mailbox-resolved": "From your mail",
  "user-entered": "You added them",
  inbound: "Inbound",
  imported: "Imported from a file",
} as const satisfies Record<ContactRow["origin"], string>;

/** An absolute day. No relative "3 days ago": this column is a fact, not a feeling. */
export function formatDay(epochMs: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(epochMs),
  );
}

/** A `<input type="date">` value in the browser's own calendar, parsed as UTC noon so a timezone
 *  west of UTC cannot silently move the due date to the previous day. */
export function parseDueDate(value: string): number | null {
  const parsed = Date.parse(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Page-state prose is CODE-OWNED (`DASHBOARD_STATE_COPY`); backends return typed facts, never
 *  display strings. Page-specific detail sits beside the shared label, never replacing it. */
export function PipelineStateNotice({
  state,
  children,
}: {
  state: keyof typeof DASHBOARD_STATE_COPY;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-pipeline-state={state}
      style={{
        border: "1px dashed var(--rule)",
        borderRadius: "0.75rem",
        padding: "0.85rem 1rem",
        color: "var(--ink-soft)",
        background: "color-mix(in srgb, var(--card) 70%, transparent)",
      }}
    >
      {children ?? DASHBOARD_STATE_COPY[state].label}
    </div>
  );
}

// ── the four tiles ────────────────────────────────────────────────────────────

// EXACTLY the four COUNT keys. `pipelineTiles` also returns `partial`, which is a bound signal and
// not a tile — adding it here would render the word "row-cap" in a stat cell.
const TILES = [
  { id: "needing-attention", key: "needingAttention", label: "Contacts needing attention" },
  { id: "followups-due", key: "followUpsDue", label: "Follow-ups due" },
  { id: "consent", key: "consentOnRecord", label: "Consent on record" },
  { id: "suppressed", key: "suppressed", label: "Suppressed contacts" },
] as const satisfies ReadonlyArray<{ id: string; key: TileCountKey; label: string }>;

/** The keys of `Tiles` whose value is a `number` — i.e. everything except `partial`. Derived, so a
 *  new count on the backend is usable here and a new NON-count can never become a tile. */
type TileCountKey = {
  [K in keyof Tiles]: Tiles[K] extends number ? K : never;
}[keyof Tiles];

/**
 * The four headline counts, in the mockup's order.
 *
 * "Needing attention" means UNOWNED (no open follow-up), deliberately complementary to
 * "Follow-ups due" rather than a near-duplicate of it — the playbook's "adding a tile" rule.
 * There is no window and no coverage clamp here, so `resolveDashboardWindow` is not imported.
 */
export function PipelineTiles({ tiles }: { tiles: Tiles }) {
  return (
    <section className="stat-grid" aria-label="Pipeline summary" data-testid="pipeline-tiles">
      {TILES.map((tile) => (
        <div className="stat-tile" key={tile.id} data-testid={`pipeline-tile-${tile.id}`}>
          <div className="stat-head">
            <p className="caps-label">{tile.label}</p>
          </div>
          {/* A real zero is `0`. There is no Unknown state on this page.
              `1000+` past the backend's scan bound is a FLOOR STATED HONESTLY, which is NOT the
              hedge invariant 3 bans: the page still knows a number, it just knows there are at
              least that many. `Number.parseInt("1000+", 10)` is still `1000`, so the e2e
              integer-parse assertion keeps working. One template literal, so the value stays ONE
              text node and the `">0<"` count assertion still sees it. */}
          <div className="stat-value">{`${tiles[tile.key]}${tiles.partial === "row-cap" ? "+" : ""}`}</div>
        </div>
      ))}
    </section>
  );
}

// ── the contact table ─────────────────────────────────────────────────────────

/**
 * ONE row per person, five columns: Contact · Origin · Last touch · Next step · Consent.
 *
 * Every cell states a fact or states its absence in words. A blank cell and a `0` both read as
 * data when they are not: "No contact yet" is not zero contact, and "none on record" is not
 * "not consented by policy" — it is the truth that no consent event was ever recorded.
 */
export function ContactTable({
  rows,
  armed,
  followUpFor,
  busy,
  on,
}: {
  rows: ContactRow[];
  armed: string | null;
  followUpFor: string | null;
  busy: boolean;
  on: PipelineActions;
}) {
  return (
    <div style={scroller}>
      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Contact</th>
            <th style={th}>Origin</th>
            <th style={th}>Last touch</th>
            <th style={th}>Next step</th>
            <th style={th}>Consent</th>
            <th style={th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.contactId)} data-testid="pipeline-contact-row">
              <td style={td}>
                {/* A nameless contact shows its ADDRESS. Never a blank, never "Unknown" — the
                    address is the identity, and the name is the optional extra. */}
                <span data-testid="contact-name" style={{ fontWeight: 600 }}>
                  {row.name ?? row.email}
                </span>
                {row.name === null ? null : (
                  <div style={{ ...muted, fontSize: "0.8rem" }}>{row.email}</div>
                )}
              </td>
              <td style={td}>
                <span style={quietChip}>{ORIGIN_LABELS[row.origin]}</span>
              </td>
              <td style={td}>
                {row.lastTouchAt === null ? "No contact yet" : formatDay(row.lastTouchAt)}
              </td>
              <td style={td}>
                {row.nextStep === null ? (
                  <span style={muted}>Nothing scheduled</span>
                ) : (
                  <>
                    <div>{row.nextStep.note}</div>
                    <div style={{ ...muted, fontSize: "0.8rem" }}>
                      due {formatDay(row.nextStep.dueAt)}
                    </div>
                  </>
                )}
              </td>
              <td style={td}>
                {row.consent === null ? (
                  <span style={quietChip}>none on record</span>
                ) : (
                  // The chip renders its SOURCE, not just its date (owner decision 2026-08-10).
                  // The schema keeps `imported-attested` DISTINCT from `asserted-by-user` because
                  // one attestation over a whole file is weaker evidence than consent recorded for
                  // one person — and this cell, the only surface anyone looks at, was throwing
                  // that distinction away invisibly to tsc. Still `chip`/`quietChip`: teal is a
                  // FILL and amber belongs to the approval gate alone (BRAND §2/§6).
                  <span style={chip}>
                    Consented {formatDay(row.consent.at)}
                    {row.consent.source === "imported-attested" ? " · imported" : ""}
                  </span>
                )}
              </td>
              <td style={td}>
                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={button}
                    disabled={busy}
                    data-testid="contact-add-followup"
                    onClick={() => on.toggleFollowUp(String(row.contactId))}
                  >
                    Add follow-up
                  </button>
                  {row.suppressed ? (
                    <UnsuppressControl
                      email={row.email}
                      armed={armed === row.email}
                      busy={busy}
                      on={on}
                    />
                  ) : (
                    <button
                      type="button"
                      style={button}
                      disabled={busy}
                      data-testid="contact-suppress"
                      onClick={() => on.suppress(row.email)}
                    >
                      Mark suppressed
                    </button>
                  )}
                </div>
                {followUpFor === String(row.contactId) ? (
                  <FollowUpForm contactId={String(row.contactId)} busy={busy} on={on} />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Un-suppressing is a two-step arm/commit, never a plain toggle and NEVER `window.confirm` — a
 * browser modal blocks the page and cannot be driven by the Playwright spec that has to prove this
 * boundary (the 26-10 `requiresConfirmation` precedent).
 *
 * The armed state says out loud whose responsibility this is, because `contacts.unsuppress` refuses
 * unless `acknowledged === true`, and that flag means exactly this sentence.
 */
function UnsuppressControl({
  email,
  armed,
  busy,
  on,
}: {
  email: string;
  armed: boolean;
  busy: boolean;
  on: PipelineActions;
}) {
  if (!armed) {
    return (
      <button
        type="button"
        style={button}
        disabled={busy}
        data-testid="contact-unsuppress-arm"
        onClick={() => on.arm(email)}
      >
        Allow emails again
      </button>
    );
  }
  return (
    <div style={{ display: "grid", gap: "0.4rem" }}>
      <p style={{ ...muted, fontSize: "0.8rem", maxWidth: "22rem" }}>
        This person asked to stop hearing from you. Re-subscribing them without fresh consent is
        your responsibility, not Pikar&rsquo;s.
      </p>
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
        <button
          type="button"
          style={primary}
          disabled={busy}
          data-testid="contact-unsuppress-confirm"
          onClick={() => on.unsuppress(email)}
        >
          {busy ? DASHBOARD_STATE_COPY.busy.label : "Confirm, allow emails again"}
        </button>
        <button type="button" style={button} disabled={busy} onClick={on.cancelArm}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * The inline add-follow-up form.
 *
 * ponytail: an uncontrolled `<form>` read through `FormData`, plus a native `<input type="date">`.
 * No component state, no date-picker dependency, and `required` is the browser's own validation.
 */
function FollowUpForm({
  contactId,
  busy,
  on,
}: {
  contactId: string;
  busy: boolean;
  on: PipelineActions;
}) {
  return (
    <form
      style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.5rem" }}
      data-testid="contact-followup-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        on.createFollowUp(
          contactId,
          String(data.get("note") ?? ""),
          String(data.get("dueAt") ?? ""),
        );
      }}
    >
      <input
        name="note"
        required
        maxLength={500}
        placeholder="What is owed?"
        aria-label="Follow-up note"
        style={{ ...button, cursor: "text", minWidth: "12rem", fontWeight: 400 }}
      />
      <input
        name="dueAt"
        type="date"
        required
        aria-label="Due date"
        style={{ ...button, cursor: "text", fontWeight: 400 }}
      />
      <button type="submit" style={primary} disabled={busy}>
        Save follow-up
      </button>
    </form>
  );
}

/**
 * The zero-contacts state.
 *
 * EXACTLY ONE action. Seeded suggestions from recent mail are deliberately absent: proposing
 * contacts by reading the mailbox is how a contacts CACHE starts, and invariant 1 says a row exists
 * only because a human deliberately made it.
 */
export function ContactsEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div style={{ ...stack, textAlign: "left" }} data-testid="pipeline-empty">
      <h3 style={cardTitle}>No contacts yet</h3>
      <p style={muted}>
        Pikar records only the people you deliberately add. Nothing is collected in the background,
        so this list starts empty and stays exactly as long as you make it.
      </p>
      <div>
        <button type="button" style={primary} data-testid="add-first-contact" onClick={onAdd}>
          Add your first contact
        </button>
      </div>
    </div>
  );
}

/** Add or update ONE contact. The same uncontrolled-form idiom as the follow-up form. */
function AddContactForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (email: string, name: string) => void;
  onCancel: () => void;
}) {
  return (
    <form
      style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}
      data-testid="add-contact-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSubmit(String(data.get("email") ?? ""), String(data.get("name") ?? ""));
      }}
    >
      <input
        name="email"
        type="email"
        required
        aria-label="Email address"
        placeholder="name@company.com"
        style={{ ...button, cursor: "text", minWidth: "14rem", fontWeight: 400 }}
      />
      <input
        name="name"
        aria-label="Name (optional)"
        placeholder="Name (optional)"
        style={{ ...button, cursor: "text", minWidth: "10rem", fontWeight: 400 }}
      />
      <button type="submit" style={primary} disabled={busy} data-testid="add-contact-save">
        Save contact
      </button>
      <button type="button" style={button} disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

/** The contactless follow-ups, in their OWN section BENEATH the table — not em-dash rows inside
 *  it. The table is one row per PERSON; a follow-up with no person is a different fact. */
export function UnassignedFollowUps({ followUps }: { followUps: UnassignedRow[] }) {
  return (
    <ul
      data-testid="pipeline-unassigned"
      style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.5rem" }}
    >
      {followUps.map((item) => (
        <li
          key={String(item.followUpId)}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "0.75rem",
            flexWrap: "wrap",
            paddingBottom: "0.5rem",
            borderBottom: "1px solid color-mix(in srgb, var(--rule) 55%, transparent)",
          }}
        >
          <span>{item.note}</span>
          <span style={{ ...muted, fontSize: "0.82rem" }}>due {formatDay(item.dueAt)}</span>
        </li>
      ))}
    </ul>
  );
}

// ── connected sections ────────────────────────────────────────────────────────
// Each owns its own `useQuery`, so a single failing read cannot erase the rest of the page
// (the 26-10 / ApprovalsView idiom).

function ConnectedTiles() {
  const tiles = useQuery(api.contacts.pipelineTiles, {});
  if (tiles === undefined) {
    return <PipelineStateNotice state="loading">Counting your pipeline…</PipelineStateNotice>;
  }
  return <PipelineTiles tiles={tiles} />;
}

function ConnectedContacts() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [followUpFor, setFollowUpFor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const page = useQuery(api.contacts.listContacts, cursor === null ? {} : { cursor });
  const upsertContact = useMutation(api.contacts.upsertContact);
  const markSuppressed = useMutation(api.contacts.markSuppressed);
  const unsuppress = useMutation(api.contacts.unsuppress);
  const createFollowUp = useMutation(api.contacts.createFollowUp);

  // One place where a refused mutation becomes a sentence. An exception must never read as an
  // empty list, so the notice sits ABOVE the table and the table keeps its last good rows.
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setRefusal(null);
    try {
      await work();
    } catch {
      setRefusal(DASHBOARD_STATE_COPY.error.label);
    } finally {
      setBusy(false);
    }
  };

  const on: PipelineActions = {
    suppress: (email) => void run(() => markSuppressed({ address: email })),
    arm: (email) => setArmed(email),
    cancelArm: () => setArmed(null),
    unsuppress: (email) =>
      void run(async () => {
        // `acknowledged: true` is exactly the sentence the armed state showed. The backend refuses
        // anything else BEFORE it reads, so this flag is a claim the UI has to have earned.
        await unsuppress({ address: email, acknowledged: true });
        setArmed(null);
      }),
    toggleFollowUp: (contactId) =>
      setFollowUpFor((open) => (open === contactId ? null : contactId)),
    createFollowUp: (contactId, note, dueDate) => {
      const dueAt = parseDueDate(dueDate);
      if (dueAt === null) {
        setRefusal("That due date could not be read. Pick a date and try again.");
        return;
      }
      void run(async () => {
        await createFollowUp({
          contactId: contactId as ContactRow["contactId"],
          note,
          dueAt,
        });
        setFollowUpFor(null);
      });
    },
  };

  return (
    <section style={stack} aria-labelledby="pipeline-contacts-heading">
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "0.65rem",
          flexWrap: "wrap",
        }}
      >
        <h2 id="pipeline-contacts-heading" style={cardTitle}>
          The people you deal with
        </h2>
        {page !== undefined && page.contacts.length > 0 && !adding ? (
          <button
            type="button"
            style={button}
            data-testid="add-contact"
            onClick={() => setAdding(true)}
          >
            Add a contact
          </button>
        ) : null}
      </div>

      <div style={{ ...card, ...stack }} data-testid="pipeline-contacts">
        {refusal ? <PipelineStateNotice state="error">{refusal}</PipelineStateNotice> : null}
        {adding ? (
          <AddContactForm
            busy={busy}
            onCancel={() => setAdding(false)}
            onSubmit={(email, name) =>
              void run(async () => {
                await upsertContact({
                  email,
                  ...(name.trim() ? { name: name.trim() } : {}),
                  origin: "user-entered",
                });
                setAdding(false);
              })
            }
          />
        ) : null}

        {page === undefined ? (
          <PipelineStateNotice state="loading">Loading your contacts…</PipelineStateNotice>
        ) : page.contacts.length === 0 && !adding ? (
          <ContactsEmptyState onAdd={() => setAdding(true)} />
        ) : (
          <ContactTable
            rows={page.contacts}
            armed={armed}
            followUpFor={followUpFor}
            busy={busy}
            on={on}
          />
        )}

        {page?.bound.partial ? (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <PipelineStateNotice state="partial">
              More contacts exist than this page shows.
            </PipelineStateNotice>
            <button type="button" style={button} onClick={() => setCursor(null)}>
              First page
            </button>
            <button
              type="button"
              style={button}
              disabled={page.bound.nextCursor === null}
              onClick={() => setCursor(page.bound.nextCursor)}
            >
              Next page
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ConnectedUnassigned() {
  const page = useQuery(api.contacts.listUnassignedFollowUps, {});
  return (
    <section style={stack} aria-labelledby="pipeline-unassigned-heading">
      <h2 id="pipeline-unassigned-heading" style={cardTitle}>
        Follow-ups with nobody attached
      </h2>
      <p style={muted}>
        Work you owe that is not about one person, like chasing a supplier quote. Only you can file
        these; the agent must always name a contact.
      </p>
      <div style={card}>
        {page === undefined ? (
          <PipelineStateNotice state="loading">Loading follow-ups…</PipelineStateNotice>
        ) : page.followUps.length === 0 ? (
          <PipelineStateNotice state="empty">
            Nothing here yet. Every open follow-up is attached to someone.
          </PipelineStateNotice>
        ) : (
          <UnassignedFollowUps followUps={page.followUps} />
        )}
        {page?.bound.partial ? (
          <PipelineStateNotice state="partial">
            More follow-ups exist than this page shows.
          </PipelineStateNotice>
        ) : null}
      </div>
    </section>
  );
}

export function PipelineView() {
  return (
    <div style={{ display: "grid", gap: "1.5rem", padding: "1.5rem 0" }}>
      <header style={{ display: "grid", gap: "0.65rem" }}>
        <p style={caps}>Sales pipeline</p>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            fontSize: "clamp(1.9rem, 1.4rem + 1.8vw, 2.6rem)",
          }}
        >
          Who you owe, and what you owe them
        </h1>
        <p style={muted}>
          Everything here comes from the people you have added and the follow-ups you have filed.
          There are no deal values on this page, because Pikar has never observed one.
        </p>
      </header>
      <ConnectedTiles />
      <ConnectedContacts />
      <ConnectedUnassigned />
    </div>
  );
}
