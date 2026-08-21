// The pure calendar-MANAGEMENT domain (17-05, the ACTN-02 gap closure). Pure TS, Convex-free,
// network-free (CLAUDE.md §1). Sibling of `calendar.ts`, which owns the CREATE half; nothing here
// touches a provider, a token, or the clock.
//
// WHY A SECOND MODULE RATHER THAN MORE OF `calendar.ts`. `calendar.ts` is the shipped Google
// create path and 17-VERIFICATION.md uses it as the positive regression anchor for the whole gap
// closure. Management is a different governed act with a different failure vocabulary (a stale
// etag, an event someone else already moved, a meeting that grew attendees), and putting it in the
// same file would make "did the shipped create path change?" un-answerable by a diff.
//
// The two gaps this substrate exists for, verbatim from 17-VERIFICATION.md:
//   G1 — "No Microsoft Graph Calendar endpoint, OAuth grant/token path, adapter, action type, or
//         completion terminal exists."
//   G2 — "No update, move, cancel, delete, ETag, `If-Match`, or 412-concurrency path exists."
// This plan closes NEITHER. It only makes them additive: the closed unions, the desired-state
// contract and the failure vocabulary land here so 17-06..17-09 can bolt providers onto a shape
// that already compiles.

/** The two calendar providers ACTN-02 names. CLOSED: a third provider is a deliberate edit here,
 *  never a string that arrived from a model or a stored row. */
export const CALENDAR_PROVIDERS = ["google", "microsoft"] as const;
export type CalendarProvider = (typeof CALENDAR_PROVIDERS)[number];

/** Rows written before 17-05 carry no `calendarProvider`, and ABSENT MEANS GOOGLE — the shipped
 *  Phase-17 slice was Google-only, so every historical create plan is a Google plan. That is what
 *  makes this a no-migration, no-backfill widening (the `plans.sendAt`/`kind` precedent). */
export const DEFAULT_CALENDAR_PROVIDER: CalendarProvider = "google";

/**
 * Parse a stored/received provider. `undefined` is the LEGACY row and resolves to Google; anything
 * else must be one of the two literals.
 *
 * Deliberately THROWS on an unknown value rather than falling back to Google: a silent fallback
 * would send a Microsoft-shaped operation at a Google calendar, and the first symptom would be a
 * write against the wrong account.
 */
export function parseCalendarProvider(raw: string | undefined | null): CalendarProvider {
  if (raw === undefined || raw === null) return DEFAULT_CALENDAR_PROVIDER;
  const found = CALENDAR_PROVIDERS.find((p) => p === raw);
  if (!found) throw new Error(`CALENDAR_PROVIDER_UNKNOWN:${raw}`);
  return found;
}

/**
 * The CLOSED management operation union. TWO members, not four.
 *
 * "Move"/"reschedule" are an UPDATE of the start instant, and "cancel"/"remove" are a DELETE — they
 * are user words, not operations. Modelling them as separate operations would have produced four
 * provider paths where two exist, and a `move` that forgot `If-Match` while `update` had it.
 *
 * **`delete` means delete, NOT the provider's cancellation flow.** Google's `sendUpdates` and
 * Graph's `/cancel` action EMAIL THE ATTENDEES on the app's behalf — an outbound external
 * communication with no plan row, no audit event, no dead letter and no redaction pass. That is
 * the single sharpest way this phase could falsify the system's central claim, so the cancellation
 * endpoints are out of the vocabulary entirely rather than guarded by a parameter default.
 */
export const CALENDAR_MANAGE_OPERATIONS = ["update", "delete"] as const;
export type CalendarManageOperation = (typeof CALENDAR_MANAGE_OPERATIONS)[number];

/** The user words each operation answers to. The MAP is the closed surface — a verb that is not a
 *  key here is refused, so "postpone indefinitely" does not quietly become a delete. */
const OPERATION_ALIASES: Readonly<Record<string, CalendarManageOperation>> = {
  update: "update",
  change: "update",
  edit: "update",
  move: "update",
  reschedule: "update",
  delete: "delete",
  cancel: "delete",
  remove: "delete",
};

/** Parse an operation word into the closed union. Case- and whitespace-tolerant, meaning-strict. */
export function parseCalendarManageOperation(
  raw: string | undefined | null,
): CalendarManageOperation {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase();
  const op = OPERATION_ALIASES[key];
  if (!op) throw new Error(`CALENDAR_OPERATION_UNKNOWN:${key}`);
  return op;
}

/** What the registry knows about a Pikar-created event, as the pure layer sees it. Times are ONE
 *  absolute epoch ms plus a duration — never a wall-clock string, never an end string (the
 *  `plans.sendAt` rule verbatim). */
export type ManagedEventSnapshot = {
  title: string;
  startMs: number;
  durationMs: number;
  tz: string;
};

/** The subset of the snapshot an update may move. Every key optional; an absent key means "leave
 *  it alone", which is why the diff below compares rather than overwrites. */
export type CalendarDesiredState = Partial<ManagedEventSnapshot>;

/** A parsed, executable management intent. A discriminated union so `delete` structurally cannot
 *  carry desired content — there is nowhere to put it. */
export type CalendarManageIntent =
  | { operation: "update"; changed: CalendarDesiredState }
  | { operation: "delete" };

/** The fields of `desired` that actually DIFFER from the current snapshot. An update whose every
 *  field already matches is not a small write, it is a provider round-trip and an etag bump for
 *  nothing — and a card that says "we changed it" over an unchanged event is a lie. */
export function changedFields(
  current: ManagedEventSnapshot,
  desired: CalendarDesiredState,
): CalendarDesiredState {
  const out: CalendarDesiredState = {};
  if (desired.title !== undefined && desired.title !== current.title) out.title = desired.title;
  if (desired.startMs !== undefined && desired.startMs !== current.startMs)
    out.startMs = desired.startMs;
  if (desired.durationMs !== undefined && desired.durationMs !== current.durationMs)
    out.durationMs = desired.durationMs;
  if (desired.tz !== undefined && desired.tz !== current.tz) out.tz = desired.tz;
  return out;
}

/**
 * Build the intent a later plan will execute. THROWS rather than returning a degenerate intent:
 *
 * - `update` with no changed field  → `CALENDAR_UPDATE_EMPTY`. Nothing to do is not an update.
 * - `delete` carrying desired state → `CALENDAR_DELETE_HAS_DESIRED`. A delete that also claims to
 *   set a title is two different acts wearing one operation name.
 */
export function buildManageIntent(args: {
  operation: CalendarManageOperation;
  current: ManagedEventSnapshot;
  desired?: CalendarDesiredState;
}): CalendarManageIntent {
  const { operation, current, desired } = args;
  if (operation === "delete") {
    if (desired !== undefined && Object.keys(desired).length > 0) {
      throw new Error("CALENDAR_DELETE_HAS_DESIRED");
    }
    return { operation: "delete" };
  }
  const changed = changedFields(current, desired ?? {});
  if (Object.keys(changed).length === 0) throw new Error("CALENDAR_UPDATE_EMPTY");
  return { operation: "update", changed };
}

/**
 * The CLOSED failure vocabulary. CODES ONLY — never a provider message, never a response body.
 * CLAUDE.md §4: a Google 400 or a Graph 412 can echo the event `summary` straight back, so the
 * code is what reaches the plan row, the audit payload and the dead letter.
 */
export const CALENDAR_FAILURE_CODES = [
  /** The provider's etag moved under us (Google/Graph 412). Refuse; never force-overwrite. */
  "conflict",
  /** The provider no longer has the event (404/410). */
  "not_found",
  /** Grant missing the scope, or a dead refresh token. A reconnect fixes it; a retry does not. */
  "reauth",
  /** The event grew guests, so touching it could email them outside the governance spine. */
  "attendees_present",
  /** A registry row with no etag: legacy/backfilled, not manageable until provider inspection. */
  "needs_inspection",
  /** Not a Pikar-created row — arbitrary mailbox events stay out of reach. */
  "not_managed",
  /**
   * The provider cannot do this operation SAFELY AT ALL, so we never ask (ADR-023: Graph ignores
   * `If-Match` on event DELETE). Deliberately its own code rather than `provider_error`: that one
   * means "the provider said no this time" and invites a retry, while this one means "we will never
   * send this request", and rendering them the same way would promise the user a retry that cannot
   * exist. This is the code behind the ONE product surface ADR-023 requires to be visible.
   */
  "provider_unsupported",
  /** Bounded catch-all. A CODE, deliberately without the provider's words. */
  "provider_error",
] as const;
export type CalendarFailureCode = (typeof CALENDAR_FAILURE_CODES)[number];

/** The result contract every provider adapter (17-07/17-08) must return. Refs on success, a CODE on
 *  failure — there is nowhere in either branch to put provider prose or attendee data. */
export type CalendarManageResult =
  | { ok: true; operation: CalendarManageOperation; externalEventId: string; etag?: string }
  | { ok: false; code: CalendarFailureCode };

/** The registry facts that decide whether a row may be managed AT ALL, independent of provider. */
export type ManageabilityInput = {
  status: "active" | "deleted";
  attendeeFree: boolean;
  etag?: string;
};

/**
 * The pre-provider gate: is this row even a candidate? Ordered most-fundamental first, so a deleted
 * row reports `not_found` rather than complaining about its missing etag.
 *
 * Scope decision recorded in the plan's `<context>`: management is limited to Pikar-created,
 * attendee-free events recorded in `calendarEvents`. Arbitrary mailbox event discovery and
 * attendee-bearing meetings remain refused — this function is where that refusal lives.
 */
export function manageability(
  row: ManageabilityInput,
): { ok: true } | { ok: false; code: CalendarFailureCode } {
  if (row.status !== "active") return { ok: false, code: "not_found" };
  if (!row.attendeeFree) return { ok: false, code: "attendees_present" };
  if (!row.etag) return { ok: false, code: "needs_inspection" };
  return { ok: true };
}

// ── 17-08: which (provider, operation) pairs may be ATTEMPTED, and the Graph probe gate ────────

/**
 * Is this operation attemptable on this provider AT ALL?
 *
 * **Microsoft + delete is the single refusal, and it is NOT probe-gated (ADR-023).** The 17-07 probe
 * measured `staleDeleteStatus: 204` with `staleDeletePreserved: false` — Graph IGNORES `If-Match` on
 * event DELETE and the stale delete destroyed the event anyway. There is no optimistic-concurrency
 * protection of any kind on that path, so two racing cancels destroy an event whose state the caller
 * never saw.
 *
 * NOTE THE SIGNATURE: `(provider, operation)` and nothing else. A probe cannot widen this because
 * there is nowhere to pass one. That is deliberate and load-bearing — ADR-023 records that a later
 * work/school-account probe showing a 412 on DELETE would justify a SUPERSEDING ADR, never an
 * automatic widening, and an argument that does not exist cannot be threaded through by accident.
 */
export function providerSupports(
  provider: CalendarProvider,
  operation: CalendarManageOperation,
): { ok: true } | { ok: false; code: CalendarFailureCode } {
  if (provider === "microsoft" && operation === "delete") {
    return { ok: false, code: "provider_unsupported" };
  }
  return { ok: true };
}

/** The exact schema string 17-07's probe stamps. A different version is a different measurement. */
export const GRAPH_PROBE_SCHEMA = "phase17-graph-concurrency-probe.v1";

/** The probe fields the UPDATE gate reads. The other measured fields stay in the artifact; nothing
 *  here may read `staleDelete*` or the collapsed `supported` boolean. */
export type GraphConcurrencyProbe = {
  schema: string;
  deploymentUrlHash: string;
  accountIdHash: string;
  stalePatchStatus: number;
  stalePatchPreserved: boolean;
};

/**
 * Parse a stored probe artifact. Returns `null` for missing, blank, malformed, wrong-schema, or
 * wrong-typed input — every unusable state collapses to the same "no evidence" value, because the
 * ONLY safe reading of an unparseable probe is that no measurement exists.
 *
 * Deliberately returns null rather than throwing: an operator pasting a truncated JSON blob should
 * darken the Microsoft update branch, not crash a governed action mid-delivery.
 */
export function parseGraphProbe(raw: string | undefined | null): GraphConcurrencyProbe | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  if (p.schema !== GRAPH_PROBE_SCHEMA) return null;
  if (typeof p.deploymentUrlHash !== "string" || typeof p.accountIdHash !== "string") return null;
  if (typeof p.stalePatchStatus !== "number" || typeof p.stalePatchPreserved !== "boolean") {
    return null;
  }
  return {
    schema: p.schema,
    deploymentUrlHash: p.deploymentUrlHash,
    accountIdHash: p.accountIdHash,
    stalePatchStatus: p.stalePatchStatus,
    stalePatchPreserved: p.stalePatchPreserved,
  };
}

/**
 * May Microsoft event UPDATE run, here, for this account?
 *
 * THE PAIR, READ APART FROM `supported`. 17-07 shipped a single `supported` boolean that ANDed the
 * patch and delete results together, so it could only ever report the worse of them — which is why a
 * PATCH that provably refuses stale writes sat unreachable behind a DELETE that does not. This reads
 * `stalePatchStatus === 412` (Graph enforced `If-Match`) AND `stalePatchPreserved` (the refused
 * write changed nothing) and never consults `supported`. A 412 that still wrote is worse than no 412
 * at all, which is why both halves are required.
 *
 * THE BINDING is the other half of the gate. A measurement is evidence about the deployment and the
 * grant it ran against, and nothing else: a passing dev probe pasted into production, or one
 * tenant's probe vouching for another's grant, are exactly the transplants this refuses.
 */
export function microsoftUpdateEnabled(args: {
  probe: GraphConcurrencyProbe | null;
  deploymentUrlHash: string;
  accountIdHash: string;
}): boolean {
  const { probe, deploymentUrlHash, accountIdHash } = args;
  if (!probe) return false;
  if (probe.deploymentUrlHash !== deploymentUrlHash) return false;
  if (probe.accountIdHash !== accountIdHash) return false;
  return probe.stalePatchStatus === 412 && probe.stalePatchPreserved;
}

/**
 * What a provider GET may hand back to the governed layer, and the whole of it.
 *
 * Location, organizer, body, attendee IDENTITIES and the raw response have no home in this type, so
 * an adapter that wanted to leak one would have to widen the contract in this file first. The
 * attendee count is a COUNT (§4) — enough to refuse the write, never enough to name a guest.
 */
export type CalendarInspection =
  | { exists: false }
  | {
      exists: true;
      externalEventId: string;
      /** ABSENT means "unknown version", never "no concurrency check needed". */
      etag?: string;
      title: string;
      startMs: number;
      durationMs: number;
      attendeeCount: number;
    };
