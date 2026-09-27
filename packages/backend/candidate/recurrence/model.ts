import type { DataModelFromSchemaDefinition, GenericDatabaseWriter } from "convex/server";
import {
  type LocalRecurrenceRule,
  nextOccurrence,
  occurrenceKey,
} from "../../../core/src/routineSchedule";
import type schema from "./schema";

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export type CandidateDb = GenericDatabaseWriter<DataModel>;
type Routine = DataModel["candidateRoutines"]["document"];
type Run = DataModel["candidateRuns"]["document"];
type Progress = DataModel["candidateSweepProgress"]["document"];
export type RoutineId = Routine["_id"];
export type RunId = Run["_id"];

export const MISSED_GRACE_MS = 5 * 60_000;
export const MAX_ATTEMPTS = 3;
export const ROUTINE_RUN_ENVELOPE_CENTS = 25;
export const DAILY_SPEND_CENTS = 100;
export const DEPLOYMENT_SPEND_CENTS = 500;
export const SWEEP_PAGE_LIMIT = 16;
const CADENCE_HORIZON_MS = 15 * 24 * 60 * 60_000;

export type Material = Pick<
  Routine,
  "promptVersion" | "promptHash" | "recipients" | "accountRef" | "envelopeCents" | "rule"
>;
export type FailureClass =
  | "provider_5xx"
  | "provider_timeout"
  | "internal"
  | "auth"
  | "validation"
  | "budget"
  | "paused"
  | "provider_refusal";

const retryable = new Set<FailureClass>(["provider_5xx", "provider_timeout", "internal"]);
const safeRef = (value: string) => /^[A-Za-z0-9._:/|+=~-]{1,160}$/.test(value);

function assertTenant(routine: Routine | null, tenantId: string): asserts routine is Routine {
  if (!routine || routine.tenantId !== tenantId) throw new Error("candidate: routine unavailable");
}

function sortedRecipients(values: readonly string[]) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function materiallyChanged(before: Material, after: Material): boolean {
  return (
    before.promptVersion !== after.promptVersion ||
    before.promptHash !== after.promptHash ||
    before.accountRef !== after.accountRef ||
    before.envelopeCents !== after.envelopeCents ||
    before.rule.timeZone !== after.rule.timeZone ||
    before.rule.hour !== after.rule.hour ||
    before.rule.minute !== after.rule.minute ||
    before.rule.cadence.frequency !== after.rule.cadence.frequency ||
    (before.rule.cadence.frequency === "weekly" &&
      after.rule.cadence.frequency === "weekly" &&
      before.rule.cadence.weekday !== after.rule.cadence.weekday) ||
    JSON.stringify(sortedRecipients(before.recipients)) !==
      JSON.stringify(sortedRecipients(after.recipients))
  );
}

function assertMaterial(input: Material) {
  if (
    !safeRef(input.accountRef) ||
    !safeRef(input.promptHash) ||
    !Number.isInteger(input.promptVersion) ||
    input.promptVersion < 1 ||
    input.envelopeCents !== ROUTINE_RUN_ENVELOPE_CENTS ||
    input.recipients.some((recipient) => !safeRef(recipient))
  ) {
    throw new Error("candidate: invalid material");
  }
}

async function progressFor(db: CandidateDb, tenantId: string): Promise<Progress> {
  const existing = await db
    .query("candidateSweepProgress")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();
  if (existing) return existing;
  const id = await db.insert("candidateSweepProgress", {
    tenantId,
    routineOrdinal: 0,
    runOrdinal: 0,
    due: { cursor: 0, highWater: 0, epoch: 0 },
    recovery: { cursor: 0, highWater: 0, epoch: 0 },
  });
  const created = await db.get(id);
  if (!created) throw new Error("candidate: progress absent");
  return created;
}

async function nextOrdinal(db: CandidateDb, tenantId: string, kind: "routine" | "run") {
  const progress = await progressFor(db, tenantId);
  const field = kind === "routine" ? "routineOrdinal" : "runOrdinal";
  const ordinal = progress[field] + 1;
  await db.patch(progress._id, { [field]: ordinal });
  return ordinal;
}

function latestEligible(routine: Routine, nowUtcMs: number) {
  if (routine.activatedAtUtcMs === undefined || nowUtcMs <= routine.activatedAtUtcMs) return null;
  let after = Math.max(routine.activatedAtUtcMs, nowUtcMs - CADENCE_HORIZON_MS);
  let latest: ReturnType<typeof nextOccurrence> | null = null;
  // Daily/weekly cadence has at most sixteen occurrences in this bounded horizon.
  for (let i = 0; i < 18; i++) {
    const occurrence = nextOccurrence(after, routine.rule as LocalRecurrenceRule);
    if (occurrence.utcMs > nowUtcMs) return latest;
    latest = occurrence;
    after = occurrence.utcMs;
  }
  throw new Error("candidate: cadence horizon exceeded");
}

export async function createCandidate(
  db: CandidateDb,
  tenantId: string,
  material: Material,
  afterUtcMs: number,
) {
  if (!safeRef(tenantId)) throw new Error("candidate: invalid tenant ref");
  assertMaterial(material);
  const scanOrdinal = await nextOrdinal(db, tenantId, "routine");
  return db.insert("candidateRoutines", {
    tenantId,
    status: "awaiting_approval",
    version: 1,
    ...material,
    scanOrdinal,
  });
}

export async function approveCandidate(
  db: CandidateDb,
  tenantId: string,
  routineId: RoutineId,
  nowUtcMs: number,
) {
  const routine = await db.get(routineId);
  assertTenant(routine, tenantId);
  if (routine.status !== "awaiting_approval") throw new Error("candidate: approval not pending");
  if (!Number.isFinite(nowUtcMs)) throw new Error("candidate: invalid approval time");
  await db.patch(routineId, {
    status: "approved",
    activatedAtUtcMs: nowUtcMs,
    lastOccurrenceKey: undefined,
  });
}

export async function changeCandidate(
  db: CandidateDb,
  tenantId: string,
  routineId: RoutineId,
  material: Material,
  nowUtcMs: number,
) {
  const routine = await db.get(routineId);
  assertTenant(routine, tenantId);
  assertMaterial(material);
  const changed = materiallyChanged(routine, material);
  await db.patch(routineId, {
    ...material,
    ...(changed
      ? {
          status: "awaiting_approval" as const,
          version: routine.version + 1,
          activatedAtUtcMs: undefined,
          lastOccurrenceKey: undefined,
        }
      : {}),
  });
  if (changed) await stopUnstartedActiveRun(db, routine, "stopped_changed");
  return changed;
}

export async function pauseCandidate(db: CandidateDb, tenantId: string, routineId: RoutineId) {
  const routine = await db.get(routineId);
  assertTenant(routine, tenantId);
  await db.patch(routineId, { status: "paused", version: routine.version + 1 });
  await stopUnstartedActiveRun(db, routine, "stopped_paused");
  // No pending per-routine scheduled function exists in this sweep-only candidate. D6 is open.
}

async function stopUnstartedActiveRun(
  db: CandidateDb,
  routine: Routine,
  status: "stopped_paused" | "stopped_changed",
) {
  if (!routine.activeRunId) return;
  const run = await db.get(routine.activeRunId);
  if (!run || run.tenantId !== routine.tenantId || run.routineId !== routine._id) {
    throw new Error("candidate: active run identity mismatch");
  }
  if (
    run.status === "claimed" ||
    run.status === "retry_pending" ||
    (run.status === "running" && !run.paidStep)
  ) {
    await commitTerminal(db, run, status);
  }
}

async function audit(db: CandidateDb, run: Run, outcome: Run["status"]) {
  await db.insert("candidateAudit", {
    tenantId: run.tenantId,
    routineId: run.routineId,
    runId: run._id,
    occurrenceKey: run.occurrenceKey,
    outcome,
  });
}

export async function claimTick(
  db: CandidateDb,
  tenantId: string,
  routineId: RoutineId,
  expectedOccurrenceKey: string,
  expectedVersion: number,
  nowUtcMs: number,
) {
  const routine = await db.get(routineId);
  assertTenant(routine, tenantId);
  if (routine.version !== expectedVersion) return { outcome: "stale_version" as const };
  if (routine.status !== "approved") return { outcome: "not_approved" as const };
  const due = latestEligible(routine, nowUtcMs);
  if (!due) return { outcome: "not_due" as const };
  const dueKey = occurrenceKey({
    routineId,
    localDate: due.localDate,
    localTime: due.localTime,
    templateVersion: routine.promptVersion,
  });
  if (dueKey !== expectedOccurrenceKey) return { outcome: "not_due" as const };
  const existing = await db
    .query("candidateRuns")
    .withIndex("by_tenant_occurrence", (q) =>
      q.eq("tenantId", tenantId).eq("occurrenceKey", dueKey),
    )
    .first();
  if (existing) return { outcome: "duplicate" as const, runId: existing._id };
  if (routine.lastOccurrenceKey === dueKey) return { outcome: "duplicate" as const };
  const status =
    nowUtcMs - due.utcMs > MISSED_GRACE_MS
      ? "skipped_missed"
      : routine.activeRunId
        ? "skipped_overlap"
        : "claimed";
  const scanOrdinal = await nextOrdinal(db, tenantId, "run");
  const runId = await db.insert("candidateRuns", {
    tenantId,
    scanOrdinal,
    routineId,
    routineVersion: routine.version,
    occurrenceKey: dueKey,
    status,
    attempts: 0,
  });
  const run = await db.get(runId);
  if (!run) throw new Error("candidate: inserted run absent");
  if (status !== "claimed") await audit(db, run, status);
  // Skip every stale occurrence after an outage; never queue-and-drain.
  await db.patch(routineId, {
    lastOccurrenceKey: dueKey,
    ...(status === "claimed" ? { activeRunId: runId } : {}),
  });
  return { outcome: status, runId };
}

export async function beginAttempt(db: CandidateDb, tenantId: string, runId: RunId) {
  const run = await db.get(runId);
  if (!run || run.tenantId !== tenantId) throw new Error("candidate: run unavailable");
  if (run.status !== "claimed" && run.status !== "retry_pending")
    return { outcome: "not_claimed" as const };
  if (run.paidStep || run.reservation?.state === "reconciliation_required") {
    return { outcome: "reconciliation_required" as const };
  }
  const routine = await db.get(run.routineId);
  assertTenant(routine, tenantId);
  if (routine.status !== "approved" || routine.version !== run.routineVersion) {
    const status = routine.status === "paused" ? "stopped_paused" : "stopped_changed";
    return { outcome: await commitTerminal(db, run, status) };
  }
  await db.patch(runId, { status: "running", attempts: run.attempts + 1 });
  return { outcome: "running" as const };
}

async function commitTerminal(db: CandidateDb, run: Run, status: Run["status"], planRef?: string) {
  if (run.reservation && run.reservation.state !== "released") {
    await db.patch(run._id, {
      status: "reconciliation_required",
      pendingTerminal: status,
      pendingPlanRef: planRef,
    });
    return "reconciliation_required" as const;
  }
  await db.patch(run._id, {
    status,
    planRef,
    pendingTerminal: undefined,
    pendingPlanRef: undefined,
    lastStepOutcome: run.lastStepId ? status : run.lastStepOutcome,
  });
  await db.patch(run.routineId, { activeRunId: undefined });
  await audit(db, run, status);
  if (status.startsWith("failed_"))
    await db.insert("candidateDeadLetters", {
      tenantId: run.tenantId,
      routineId: run.routineId,
      runId: run._id,
      occurrenceKey: run.occurrenceKey,
      failureClass: status.slice("failed_".length) as Exclude<FailureClass, "paused">,
    });
  return status;
}

async function finishAttempt(
  db: CandidateDb,
  tenantId: string,
  runId: RunId,
  result: { kind: "prepared"; planRef: string } | { kind: "failure"; failureClass: FailureClass },
) {
  const run = await db.get(runId);
  if (!run || run.tenantId !== tenantId || run.status !== "running" || run.paidStep) {
    throw new Error("candidate: run not open for finish");
  }
  const routine = await db.get(run.routineId);
  assertTenant(routine, tenantId);
  // Re-read after the claim and paid-call boundary. A moved approval never prepares a plan.
  let status: Run["status"];
  if (routine.status !== "approved" || routine.version !== run.routineVersion) {
    status = routine.status === "paused" ? "stopped_paused" : "stopped_changed";
  } else if (result.kind === "prepared") {
    if (!/^plan:[A-Za-z0-9_-]{1,80}$/.test(result.planRef))
      throw new Error("candidate: invalid plan ref");
    status = "prepared";
  } else {
    status =
      result.failureClass === "paused"
        ? "stopped_paused"
        : retryable.has(result.failureClass) && run.attempts < MAX_ATTEMPTS
          ? "retry_pending"
          : (`failed_${result.failureClass}` as Run["status"]);
  }
  if (status === "retry_pending") {
    await db.patch(runId, { status });
    return status;
  }
  return commitTerminal(
    db,
    run,
    status,
    status === "prepared" && result.kind === "prepared" ? result.planRef : undefined,
  );
}

export type CandidateTransaction = <T>(work: (db: CandidateDb) => Promise<T>) => Promise<T>;
export type Rail = "daily" | "deployment";
export type RailLookup = "held" | "released" | "absent" | "uncertain";
export type SyntheticRails = {
  // Every effect is keyed. A throw is ambiguous until lookup proves its outcome.
  reserve: (
    rail: Rail,
    key: string,
    tenantId: string,
    cents: number,
    cap: number,
  ) => Promise<boolean>;
  lookup: (rail: Rail, key: string, tenantId: string) => Promise<RailLookup>;
  release: (rail: Rail, key: string, tenantId: string) => Promise<void>;
};

function getRun(run: Run | null, tenantId: string): asserts run is Run {
  if (!run || run.tenantId !== tenantId) throw new Error("candidate: run unavailable");
}

function fenced(routine: Routine, run: Run) {
  return routine.status === "approved" && routine.version === run.routineVersion;
}

function railKey(run: Run, rail: Rail) {
  return `${run._id}:envelope:${rail}`;
}

/** The committed admission, not a prior read, orders reservation against pause. */
export async function admitReservation(db: CandidateDb, tenantId: string, runId: RunId) {
  const run = await db.get(runId);
  getRun(run, tenantId);
  if (run.status !== "running") return { outcome: "not_running" as const };
  const routine = await db.get(run.routineId);
  assertTenant(routine, tenantId);
  if (!fenced(routine, run)) return { outcome: "fenced" as const };
  if (run.reservation) return { outcome: "existing" as const, reservation: run.reservation };
  const reservation = {
    admissionId: `${runId}:reservation`,
    state: "admitted" as const,
    dailyKey: railKey(run, "daily"),
    deploymentKey: railKey(run, "deployment"),
    daily: "pending" as const,
    deployment: "pending" as const,
  };
  await db.patch(runId, { reservation });
  return { outcome: "admitted" as const, reservation };
}

type RailState = NonNullable<Run["reservation"]>[Rail];
async function setRail(
  db: CandidateDb,
  tenantId: string,
  runId: RunId,
  admissionId: string,
  rail: Rail,
  key: string,
  state: RailState,
) {
  const run = await db.get(runId);
  getRun(run, tenantId);
  const reservation = run.reservation;
  if (
    !reservation ||
    reservation.admissionId !== admissionId ||
    reservation[rail === "daily" ? "dailyKey" : "deploymentKey"] !== key
  ) {
    throw new Error("candidate: reservation identity mismatch");
  }
  if (reservation[rail] === "released" || reservation[rail] === "denied") return;
  const next = { ...reservation, [rail]: state };
  await db.patch(runId, {
    reservation: {
      ...next,
      state:
        next.daily === "held" && next.deployment === "held"
          ? ("held" as const)
          : next.daily === "uncertain" || next.deployment === "uncertain"
            ? ("reconciliation_required" as const)
            : reservation.state,
    },
  });
}

async function lookupSafe(
  rails: SyntheticRails,
  rail: Rail,
  key: string,
  tenantId: string,
): Promise<RailLookup> {
  try {
    return await rails.lookup(rail, key, tenantId);
  } catch {
    return "uncertain";
  }
}

async function reserveRail(
  transaction: CandidateTransaction,
  tenantId: string,
  runId: RunId,
  rails: SyntheticRails,
  rail: Rail,
) {
  const run = await transaction((db) => db.get(runId));
  getRun(run, tenantId);
  const reservation = run.reservation;
  if (!reservation) throw new Error("candidate: reservation absent");
  if (reservation[rail] !== "pending") return reservation[rail];
  if (run.status !== "running") return "uncertain";
  const key = reservation[rail === "daily" ? "dailyKey" : "deploymentKey"];
  let state: RailState;
  const prior = await lookupSafe(rails, rail, key, tenantId);
  if (prior === "held") state = "held";
  else if (prior !== "absent") state = "uncertain";
  else {
    try {
      state = (await rails.reserve(
        rail,
        key,
        tenantId,
        ROUTINE_RUN_ENVELOPE_CENTS,
        rail === "daily" ? DAILY_SPEND_CENTS : DEPLOYMENT_SPEND_CENTS,
      ))
        ? "held"
        : "denied";
    } catch {
      const found = await lookupSafe(rails, rail, key, tenantId);
      state = found === "held" ? "held" : found === "absent" ? "pending" : "uncertain";
    }
  }
  await transaction((db) =>
    setRail(db, tenantId, runId, reservation.admissionId, rail, key, state),
  );
  return state;
}

/** One outstanding paid step per run; the transaction is the pause/step linearization point. */
export async function admitPaidStep(
  db: CandidateDb,
  tenantId: string,
  runId: RunId,
  stepId: string,
) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(stepId)) throw new Error("candidate: invalid step ID");
  const run = await db.get(runId);
  getRun(run, tenantId);
  if (run.paidStep)
    return {
      outcome:
        run.paidStep.stepId === stepId ? ("already_admitted" as const) : ("outstanding" as const),
      token: run.paidStep.stepId === stepId ? run.paidStep.token : undefined,
    };
  if (run.lastStepId === stepId || run.settledStepIds?.includes(stepId)) {
    return { outcome: "already_settled" as const };
  }
  if (
    run.status !== "running" ||
    run.reservation?.state !== "held" ||
    run.reservation.daily !== "held" ||
    run.reservation.deployment !== "held"
  ) {
    return { outcome: "not_ready" as const };
  }
  const routine = await db.get(run.routineId);
  assertTenant(routine, tenantId);
  if (!fenced(routine, run)) return { outcome: "fenced" as const };
  const token = `${runId}:step:${stepId}`;
  await db.patch(runId, { paidStep: { stepId, token, state: "admitted" } });
  return { outcome: "admitted" as const, token };
}

/** The single winner may invoke the mock call. A claimed start is never dispatchable again. */
export async function claimPaidStepStart(
  db: CandidateDb,
  tenantId: string,
  runId: RunId,
  stepId: string,
  token: string,
) {
  const run = await db.get(runId);
  getRun(run, tenantId);
  if (
    run.paidStep?.stepId !== stepId ||
    run.paidStep.token !== token ||
    run.paidStep.state !== "admitted"
  )
    return false;
  await db.patch(runId, { paidStep: { stepId, token, state: "start_claimed" } });
  return true;
}

export async function landPaidStep(
  db: CandidateDb,
  tenantId: string,
  runId: RunId,
  stepId: string,
  token: string,
  result: { kind: "prepared"; planRef: string } | { kind: "failure"; failureClass: FailureClass },
) {
  const run = await db.get(runId);
  getRun(run, tenantId);
  if (!run.paidStep && run.lastStepId === stepId) return run.lastStepOutcome;
  if (!run.paidStep && run.settledStepIds?.includes(stepId)) return "already_settled";
  if (
    run.paidStep?.stepId !== stepId ||
    run.paidStep.token !== token ||
    run.paidStep.state !== "start_claimed"
  )
    throw new Error("candidate: paid step identity mismatch");
  await db.patch(runId, {
    paidStep: undefined,
    lastStepId: stepId,
    settledStepIds: [...(run.settledStepIds ?? []), stepId].slice(-MAX_ATTEMPTS),
  });
  const outcome = await finishAttempt(db, tenantId, runId, result);
  await db.patch(runId, { lastStepOutcome: outcome });
  return outcome;
}

/** Explicit closure after a lost worker; never guesses that the physical call did not happen. */
export async function closeUnknownPaidStep(
  db: CandidateDb,
  tenantId: string,
  runId: RunId,
  stepId: string,
  token: string,
) {
  const run = await db.get(runId);
  getRun(run, tenantId);
  if (
    run.paidStep?.stepId !== stepId ||
    run.paidStep.token !== token ||
    run.paidStep.state !== "start_claimed"
  )
    throw new Error("candidate: unknown step identity mismatch");
  await db.patch(runId, {
    paidStep: undefined,
    lastStepId: stepId,
    settledStepIds: [...(run.settledStepIds ?? []), stepId].slice(-MAX_ATTEMPTS),
  });
  const updated = await db.get(runId);
  getRun(updated, tenantId);
  // An unknown physical outcome never enters retry_pending. The terminal result is
  // durable but cannot clear activeRunId or audit until the two rails are reconciled.
  return commitTerminal(db, updated, "failed_internal");
}

async function releaseTerminal(
  transaction: CandidateTransaction,
  tenantId: string,
  runId: RunId,
  rails: SyntheticRails,
) {
  for (const rail of ["daily", "deployment"] as const) {
    const run = await transaction((db) => db.get(runId));
    getRun(run, tenantId);
    const reservation = run.reservation;
    if (!reservation || reservation[rail] === "released" || reservation[rail] === "denied")
      continue;
    const key = reservation[rail === "daily" ? "dailyKey" : "deploymentKey"];
    // Keyed release is a tombstone: even an absent key cannot allocate later.
    // The synthetic stub must prove this; a real limiter needs separate proof.
    try {
      await rails.release(rail, key, tenantId);
    } catch {
      /* outcome resolved below */
    }
    const found = await lookupSafe(rails, rail, key, tenantId);
    await transaction((db) =>
      setRail(
        db,
        tenantId,
        runId,
        reservation.admissionId,
        rail,
        key,
        found === "released" || found === "absent" ? "released" : "uncertain",
      ),
    );
  }
  const run = await transaction((db) => db.get(runId));
  getRun(run, tenantId);
  if (!run.reservation) return true;
  const done = [run.reservation.daily, run.reservation.deployment].every(
    (state) => state === "released" || state === "denied",
  );
  await transaction(async (db) => {
    const current = await db.get(runId);
    getRun(current, tenantId);
    if (!current.reservation || current.reservation.admissionId !== run.reservation?.admissionId) {
      throw new Error("candidate: reservation changed during release");
    }
    await db.patch(runId, {
      reservation: { ...current.reservation, state: done ? "released" : "reconciliation_required" },
    });
  });
  return done;
}

async function settlePendingTerminal(
  transaction: CandidateTransaction,
  tenantId: string,
  runId: RunId,
  rails: SyntheticRails,
) {
  if (!(await releaseTerminal(transaction, tenantId, runId, rails)))
    return "reconciliation_required" as const;
  return transaction(async (db) => {
    const run = await db.get(runId);
    getRun(run, tenantId);
    if (run.status !== "reconciliation_required") return run.status;
    const routine = await db.get(run.routineId);
    assertTenant(routine, tenantId);
    const status =
      routine.status === "paused"
        ? ("stopped_paused" as const)
        : !fenced(routine, run)
          ? ("stopped_changed" as const)
          : (run.pendingTerminal ?? ("failed_internal" as const));
    return commitTerminal(db, run, status, status === "prepared" ? run.pendingPlanRef : undefined);
  });
}

type Lane = "due" | "recovery";
async function sweepPass(db: CandidateDb, tenantId: string, lane: Lane) {
  const progress = await progressFor(db, tenantId);
  const previous = progress[lane];
  if (previous.highWater > 0 && previous.cursor < previous.highWater) return previous;
  const next = {
    cursor: 0,
    highWater: lane === "due" ? progress.routineOrdinal : progress.runOrdinal,
    epoch: previous.epoch + 1,
  };
  await db.patch(progress._id, { [lane]: next });
  return next;
}

async function advanceSweep(
  db: CandidateDb,
  tenantId: string,
  lane: Lane,
  epoch: number,
  ordinal: number,
) {
  const progress = await progressFor(db, tenantId);
  const state = progress[lane];
  // A stale page may still attempt an idempotent row; it must not rewind a newer pass.
  if (state.epoch !== epoch || ordinal <= state.cursor || ordinal > state.highWater) return;
  await db.patch(progress._id, { [lane]: { ...state, cursor: ordinal } });
}

function assertSweep(tenantId: string, limit: number) {
  if (!safeRef(tenantId) || !Number.isInteger(limit) || limit < 1 || limit > SWEEP_PAGE_LIMIT) {
    throw new Error("candidate: invalid synthetic sweep");
  }
}

/** A caller-invoked, bounded due pass. Selection is only a hint; claimTick rechecks the fence. */
export async function syntheticDueSweep(
  transaction: CandidateTransaction,
  tenantId: string,
  nowUtcMs: number,
  limit = SWEEP_PAGE_LIMIT,
) {
  assertSweep(tenantId, limit);
  if (!Number.isFinite(nowUtcMs)) throw new Error("candidate: invalid sweep time");
  const selected = await transaction(async (db) => {
    const pass = await sweepPass(db, tenantId, "due");
    const rows =
      pass.highWater === 0
        ? []
        : await db
            .query("candidateRoutines")
            .withIndex("by_tenant_and_scanOrdinal", (q) =>
              q
                .eq("tenantId", tenantId)
                .gt("scanOrdinal", pass.cursor)
                .lte("scanOrdinal", pass.highWater),
            )
            .take(limit);
    if (rows.length === 0 && pass.highWater > pass.cursor) {
      await advanceSweep(db, tenantId, "due", pass.epoch, pass.highWater);
    }
    return { pass, rows };
  });
  const outcomes: string[] = [];
  for (const selectedRoutine of selected.rows) {
    const outcome = await transaction(async (db) => {
      const current = await db.get(selectedRoutine._id);
      let result: string = "gone";
      if (current && current.tenantId === tenantId) {
        if (current.status === "approved") {
          const due = latestEligible(current, nowUtcMs);
          if (due) {
            const key = occurrenceKey({
              routineId: current._id,
              localDate: due.localDate,
              localTime: due.localTime,
              templateVersion: current.promptVersion,
            });
            result = (
              await claimTick(db, tenantId, current._id, key, selectedRoutine.version, nowUtcMs)
            ).outcome;
          } else result = "not_due";
        } else result = "not_approved";
      }
      await advanceSweep(db, tenantId, "due", selected.pass.epoch, selectedRoutine.scanOrdinal);
      return result;
    });
    outcomes.push(outcome);
  }
  const progress = await transaction((db) => progressFor(db, tenantId));
  return { outcomes, scanned: selected.rows.length, ...progress.due };
}

/** Bounded test-only reconciliation entry point; no scheduler or production caller. */
export async function syntheticReconciliationSweep(
  transaction: CandidateTransaction,
  tenantId: string,
  rails: SyntheticRails,
  limit = SWEEP_PAGE_LIMIT,
) {
  assertSweep(tenantId, limit);
  const selected = await transaction(async (db) => {
    const pass = await sweepPass(db, tenantId, "recovery");
    const rows =
      pass.highWater === 0
        ? []
        : await db
            .query("candidateRuns")
            .withIndex("by_tenant_and_scanOrdinal", (q) =>
              q
                .eq("tenantId", tenantId)
                .gt("scanOrdinal", pass.cursor)
                .lte("scanOrdinal", pass.highWater),
            )
            .take(limit);
    if (rows.length === 0 && pass.highWater > pass.cursor) {
      await advanceSweep(db, tenantId, "recovery", pass.epoch, pass.highWater);
    }
    return { pass, rows };
  });
  const outcomes: string[] = [];
  for (const selectedRun of selected.rows) {
    const before = await transaction((db) => db.get(selectedRun._id));
    let outcome: string = "inactive";
    if (before?.tenantId === tenantId) {
      if (before.status === "reconciliation_required") {
        outcome =
          before.paidStep?.state === "start_claimed"
            ? "blocked_unknown_paid_step"
            : await settlePendingTerminal(transaction, tenantId, before._id, rails);
      } else if (before.status === "running") {
        if (before.paidStep?.state === "start_claimed") outcome = "blocked_unknown_paid_step";
        else {
          const stopped = await transaction(async (db) => {
            const current = await db.get(before._id);
            getRun(current, tenantId);
            if (current.status !== "running") return current.status;
            if (current.paidStep?.state === "start_claimed") return "blocked_unknown_paid_step";
            if (current.paidStep) await db.patch(current._id, { paidStep: undefined });
            return commitTerminal(db, current, "failed_internal");
          });
          outcome =
            stopped === "reconciliation_required"
              ? await settlePendingTerminal(transaction, tenantId, before._id, rails)
              : stopped;
        }
      } else if (before.status === "retry_pending") {
        const stopped = await transaction(async (db) => {
          const current = await db.get(before._id);
          getRun(current, tenantId);
          if (current.status !== "retry_pending") return current.status;
          const routine = await db.get(current.routineId);
          assertTenant(routine, tenantId);
          if (fenced(routine, current)) return "held_retry_pending";
          return commitTerminal(
            db,
            current,
            routine.status === "paused" ? "stopped_paused" : "stopped_changed",
          );
        });
        outcome =
          stopped === "reconciliation_required"
            ? await settlePendingTerminal(transaction, tenantId, before._id, rails)
            : stopped;
      }
    }
    if (outcome !== "inactive") outcomes.push(outcome);
    await transaction((db) =>
      advanceSweep(db, tenantId, "recovery", selected.pass.epoch, selectedRun.scanOrdinal),
    );
  }
  const progress = await transaction((db) => progressFor(db, tenantId));
  return { outcomes, scanned: selected.rows.length, ...progress.recovery };
}

export async function actionablePlan(db: CandidateDb, tenantId: string, runId: RunId) {
  const run = await db.get(runId);
  getRun(run, tenantId);
  const routine = await db.get(run.routineId);
  assertTenant(routine, tenantId);
  return run.status === "prepared" && run.reservation?.state === "released" && fenced(routine, run)
    ? run.planRef
    : undefined;
}

/** A test-only stand-in for a distinct human approval; it never performs an external action. */
export async function grantSyntheticHumanApproval(
  db: CandidateDb,
  tenantId: string,
  runId: RunId,
  approvalRef: string,
) {
  if (!/^approval:[A-Za-z0-9_-]{1,80}$/.test(approvalRef))
    throw new Error("candidate: invalid approval ref");
  if (!(await actionablePlan(db, tenantId, runId))) return false;
  await db.patch(runId, { humanApprovalRef: approvalRef });
  return true;
}

export async function admitSyntheticExternalAction(
  db: CandidateDb,
  tenantId: string,
  runId: RunId,
) {
  const run = await db.get(runId);
  getRun(run, tenantId);
  return !!run.humanApprovalRef && !!(await actionablePlan(db, tenantId, runId));
}

async function dispatchAdmittedStep(
  transaction: CandidateTransaction,
  tenantId: string,
  runId: RunId,
  stepId: string,
  token: string,
  rails: SyntheticRails,
  prepare: () => Promise<{ planRef: string }>,
) {
  if (!(await transaction((db) => claimPaidStepStart(db, tenantId, runId, stepId, token)))) {
    return "already_started";
  }
  let result:
    | { kind: "prepared"; planRef: string }
    | { kind: "failure"; failureClass: FailureClass };
  try {
    result = { kind: "prepared", ...(await prepare()) };
  } catch (error) {
    result = {
      kind: "failure",
      failureClass: error instanceof SyntheticFailure ? error.failureClass : "internal",
    };
  }
  const status = await transaction((db) =>
    landPaidStep(db, tenantId, runId, stepId, token, result),
  );
  return status === "reconciliation_required"
    ? settlePendingTerminal(transaction, tenantId, runId, rails)
    : status;
}

/** Test-only orchestration; no real provider, limiter or model is imported. */
export async function syntheticAttempt(
  transaction: CandidateTransaction,
  tenantId: string,
  runId: RunId,
  rails: SyntheticRails,
  prepare: () => Promise<{ planRef: string }>,
) {
  const before = await transaction((db) => db.get(runId));
  getRun(before, tenantId);
  if (before.status === "reconciliation_required") {
    return settlePendingTerminal(transaction, tenantId, runId, rails);
  }
  if (
    before.status !== "claimed" &&
    before.status !== "retry_pending" &&
    before.status !== "running"
  ) {
    return "not_claimed";
  }
  if (before.status === "claimed" || before.status === "retry_pending") {
    const begun = await transaction((db) => beginAttempt(db, tenantId, runId));
    if (begun.outcome === "reconciliation_required") {
      return settlePendingTerminal(transaction, tenantId, runId, rails);
    }
    if (begun.outcome !== "running") {
      const current = await transaction((db) => db.get(runId));
      getRun(current, tenantId);
      if (current.status !== "running") return begun.outcome;
    }
  }
  const running = await transaction((db) => db.get(runId));
  getRun(running, tenantId);
  if (running.paidStep?.state === "start_claimed") return "reconciliation_required";
  if (running.paidStep?.state === "admitted") {
    // Its admission already committed before any later pause; only the one-winner
    // start claim may dispatch it, and landing rechecks the current fence.
    return dispatchAdmittedStep(
      transaction,
      tenantId,
      runId,
      running.paidStep.stepId,
      running.paidStep.token,
      rails,
      prepare,
    );
  }
  const admission = await transaction((db) => admitReservation(db, tenantId, runId));
  if (admission.outcome === "fenced") {
    const status = await transaction((db) =>
      finishAttempt(db, tenantId, runId, { kind: "failure", failureClass: "paused" }),
    );
    return status === "reconciliation_required"
      ? settlePendingTerminal(transaction, tenantId, runId, rails)
      : status;
  }
  if (admission.outcome !== "admitted" && admission.outcome !== "existing") {
    const current = await transaction((db) => db.get(runId));
    getRun(current, tenantId);
    return current.status === "reconciliation_required"
      ? settlePendingTerminal(transaction, tenantId, runId, rails)
      : "not_claimed";
  }
  for (const rail of ["daily", "deployment"] as const) {
    const state = await reserveRail(transaction, tenantId, runId, rails, rail);
    if (state === "denied" || state === "uncertain" || state === "pending") {
      if (state === "uncertain") {
        await transaction(async (db) => {
          const run = await db.get(runId);
          getRun(run, tenantId);
          await db.patch(runId, { status: "reconciliation_required" });
        });
        return settlePendingTerminal(transaction, tenantId, runId, rails);
      }
      const status = await transaction((db) =>
        finishAttempt(db, tenantId, runId, {
          kind: "failure",
          failureClass: state === "denied" ? "budget" : "internal",
        }),
      );
      return status === "reconciliation_required"
        ? settlePendingTerminal(transaction, tenantId, runId, rails)
        : status;
    }
  }
  const run = await transaction((db) => db.get(runId));
  getRun(run, tenantId);
  const stepId = `attempt_${run.attempts}`;
  const admitted = await transaction((db) => admitPaidStep(db, tenantId, runId, stepId));
  if (
    (admitted.outcome !== "admitted" && admitted.outcome !== "already_admitted") ||
    !admitted.token
  ) {
    if (admitted.outcome === "fenced") {
      const status = await transaction((db) =>
        finishAttempt(db, tenantId, runId, { kind: "failure", failureClass: "paused" }),
      );
      return status === "reconciliation_required"
        ? settlePendingTerminal(transaction, tenantId, runId, rails)
        : status;
    }
    return admitted.outcome;
  }
  return dispatchAdmittedStep(transaction, tenantId, runId, stepId, admitted.token, rails, prepare);
}

export class SyntheticFailure extends Error {
  constructor(readonly failureClass: FailureClass) {
    super("candidate synthetic failure");
  }
}
