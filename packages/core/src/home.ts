/**
 * The Command Center's one deterministic definition of "what should I do next" and
 * "is anything broken". Pure: no clock, no framework, no persistence, no formatting —
 * the same rule as `dashboard.ts`, whose state vocabulary this module reuses rather than
 * growing a parallel one.
 *
 * Two invariants carry the whole module:
 *  1. Every rendered string is CODE-OWNED. A `HomeSignal` may carry a count and a
 *     timestamp as supporting evidence and nothing else — no row text, no model prose, no
 *     recipient, no subject ever reaches `label`/`reason`/`route`.
 *  2. Health is fail-closed. "healthy" is only ever claimed over a COMPLETE set of ok
 *     reports; a missing, malformed or not-yet-loaded source makes the verdict "unknown".
 */

/** The locked total order. Lower index = higher priority. Ties are impossible by construction. */
export type HomePriorityCode =
  | "connection-failure"
  | "unresolved-dead-letters"
  | "stale-approval"
  | "scheduled-risk"
  | "diagnostic-blocker"
  | "binding-constraint"
  | "workspace";

export type HomeSignalState = "ok" | "unknown" | "triggered";

/** One narrow, code-owned fact per candidate. NO user/model prose may enter this object. */
export type HomeSignal = {
  code: HomePriorityCode;
  state: HomeSignalState;
  /** supporting evidence only: a count and/or an epoch-ms timestamp. Never a string from a row. */
  count?: number;
  at?: number | null;
};

export type HomeRecommendation = {
  code: HomePriorityCode;
  label: string;
  reason: string;
  route: string;
  count: number | null;
  at: number | null;
  /**
   * False when any REQUIRED_HOME_SIGNALS entry is absent or not reporting ok/triggered —
   * i.e. exactly when `rollUpHealth` says "unknown". "Nothing triggered" is an all-clear
   * ONLY when everything reported, so an uncertain fallback never renders all-clear copy.
   */
  certain: boolean;
};

/**
 * BUSINESS WORK OUTRANKS THE EMAIL CHANNEL, and that ordering is the product decision this list
 * exists to encode — not an implementation detail to be tidied.
 *
 * `connection-failure` shipped FIRST (26-19/26-20) and went live on 2026-08-23, which put
 * "Connect your mailbox" above every pending decision, blocked job and imminent send. That
 * contradicted the invariant the cockpit has held since the legacy home: the workspace is always
 * the next-move surface, and email is ONE optional execution channel that is reported honestly but
 * never outranks the work. Owner ruled on it the same day.
 *
 * TWO tests fail if this list is reordered, and they are the ONLY two — verified by reverting this
 * array and watching exactly them go red: `cockpitAccess.test.ts` → "a triggered business signal
 * OUTRANKS a broken mailbox", and the ladder walk in `commandCenter.test.ts`. Every OTHER
 * render-layer test holds the five business signals at `ok` and varies only the mailbox, so it
 * passes under either order — which is precisely how the wrong order shipped green in 26-19/26-20.
 * Any new test of this ordering must trigger a business signal AND the mailbox together, or it is
 * asserting nothing.
 *
 * A disconnected mailbox is still a REAL blocker and still leads — just only once no business
 * signal is triggered. It sits immediately above the always-satisfiable `workspace` fallback, so
 * "nothing to decide, but your channel is down" surfaces rather than resolving to an all-clear.
 *
 * Deliberately NOT special-cased: a scheduled send due soon while the mailbox is down. The hero
 * says "Check the scheduled sends" and the health card says "Mailbox connection — Needs attention"
 * in the same view, which is two true facts rather than one clever ranking rule. Add the coupling
 * only if a real tenant is observed missing it.
 */
export const HOME_PRIORITY_ORDER: readonly HomePriorityCode[] = [
  "unresolved-dead-letters",
  "stale-approval",
  "scheduled-risk",
  "diagnostic-blocker",
  "binding-constraint",
  "connection-failure",
  "workspace",
];

/**
 * The codes a health roll-up requires a report for. `workspace` is deliberately absent:
 * it is the always-satisfiable fallback, not a source, so it can never contribute health.
 */
export const REQUIRED_HOME_SIGNALS: readonly HomePriorityCode[] = HOME_PRIORITY_ORDER.filter(
  (code) => code !== "workspace",
);

/** The only strings this surface may render. Never interpolated, never sourced from a row. */
export const HOME_PRIORITY_COPY: Record<
  HomePriorityCode,
  { label: string; reason: string; route: string }
> = {
  // The signal's only evidence is `gmailStatus.connected`, which is `!!row` — so a tenant who
  // NEVER connected a mailbox is indistinguishable from one whose connection broke. "Reconnect"
  // and "restored" asserted a connection that may never have existed. This copy is true of BOTH
  // cases and needs no new query. ponytail: split into two codes only if/when `gmailAuth` grows
  // a real "was connected, now broken" probe to distinguish them.
  "connection-failure": {
    label: "Connect your mailbox",
    reason:
      "Pikar cannot reach a mailbox for you. Nothing can be sent or briefed until one is connected.",
    route: "/connect-gmail",
  },
  "unresolved-dead-letters": {
    label: "Finish the work that stopped",
    reason:
      "A piece of work stopped part-way and is waiting for you. Nothing retries on its own until you look.",
    route: "/ops",
  },
  "stale-approval": {
    label: "Answer the waiting approval",
    reason: "A plan is waiting on your decision. Nothing goes out until you approve or reject it.",
    route: "/dashboard/approvals",
  },
  "scheduled-risk": {
    label: "Check the scheduled sends",
    reason: "A scheduled send is due soon or has no confirmed send time. Review it before it goes.",
    route: "/dashboard/approvals",
  },
  "diagnostic-blocker": {
    label: "Fix the first thing blocking growth",
    reason:
      "Your weekly review found the one thing holding revenue back. Fixing that first is what moves the business.",
    route: "/dashboard/reports",
  },
  "binding-constraint": {
    label: "Name what is holding you back",
    reason:
      "Your business profile does not yet say what is holding you back, so nothing here can be ranked against your real bottleneck.",
    route: "/dashboard/profile",
  },
  workspace: {
    label: "Open the workspace",
    reason:
      "Nothing needs your decision right now. Pick up the next piece of work in the workspace.",
    route: "/dashboard/workspace",
  },
};

/**
 * The workspace fallback's copy when the signal set is INCOMPLETE. Same shape as a
 * `HOME_PRIORITY_COPY` entry, deliberately NOT a seventh-and-a-half priority code:
 * `REQUIRED_HOME_SIGNALS` is derived by filtering `HOME_PRIORITY_ORDER`, so anything that is
 * not in that order can never become a required signal, and the seven codes stay seven.
 */
export const HOME_UNCERTAIN_COPY: { label: string; reason: string; route: string } = {
  label: "Some checks did not report",
  reason:
    "Pikar could not read at least one source, so it cannot tell you whether anything needs your decision. The workspace still shows what is on record.",
  route: "/dashboard/workspace",
};

/**
 * NEUTRAL noun phrases for status ROWS (the health card lists one row per required signal).
 * `HOME_PRIORITY_COPY.label` is the imperative NEXT-MOVE headline and must never be reused
 * as a row label — a status list that reads "Connect your mailbox — Clear" commands six
 * actions while claiming nothing is blocked. Two jobs, two maps.
 */
export const HOME_SIGNAL_LABEL: Record<HomePriorityCode, string> = {
  "connection-failure": "Mailbox connection",
  "unresolved-dead-letters": "Work that stopped",
  "stale-approval": "Approvals waiting",
  "scheduled-risk": "Scheduled sends",
  "diagnostic-blocker": "Weekly review",
  "binding-constraint": "What is holding you back",
  workspace: "Workspace",
};

/** One word per signal state. Colour never carries this meaning on its own. */
export const SIGNAL_STATE_WORD: Record<HomeSignalState, string> = {
  ok: "Clear",
  triggered: "Needs attention",
  unknown: "Unknown",
};

/** Evidence is numbers or nothing. A string that slipped over the wire is dropped, not rendered. */
const evidence = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function recommend(
  code: HomePriorityCode,
  certain: boolean,
  signal?: HomeSignal,
): HomeRecommendation {
  const copy = HOME_PRIORITY_COPY[code];
  return {
    code,
    label: copy.label,
    reason: copy.reason,
    route: copy.route,
    count: evidence(signal?.count),
    at: evidence(signal?.at),
    certain,
  };
}

/**
 * First triggered signal in `HOME_PRIORITY_ORDER` wins; input order cannot change the answer.
 * Nothing triggered resolves to the `workspace` fallback — but that fallback only carries
 * ALL-CLEAR copy when every required signal actually reported. An incomplete set (a source
 * that threw, is still loading, or never reported) is `certain: false` and renders
 * `HOME_UNCERTAIN_COPY` instead: nothing triggered out of six unread sources is not an
 * all-clear. Fail-closed here is the same rule `rollUpHealth` already owns, so it is REUSED
 * rather than restated — one definition of "the set is complete", not two that can drift.
 */
export function recommendNextMove(signals: readonly HomeSignal[]): HomeRecommendation {
  const list = Array.isArray(signals) ? signals : [];
  const certain = rollUpHealth(list) !== "unknown";
  for (const code of HOME_PRIORITY_ORDER) {
    const hit = list.find((signal) => signal?.code === code && signal.state === "triggered");
    if (hit) return recommend(code, certain, hit);
  }
  // Reached ONLY when nothing triggered — the one all-clear on this surface, so the one
  // place an incomplete set has to override. A triggered move above is reported verbatim.
  if (certain) return recommend("workspace", true);
  return { ...recommend("workspace", false), ...HOME_UNCERTAIN_COPY };
}

export type HomeHealthState = "healthy" | "unknown" | "degraded";

/**
 * "healthy" ONLY when every required signal reported and every report is ok.
 * Anything else — a source that never reported, one still loading, one that threw, one
 * carrying an off-contract state — is "unknown". An unknown report outranks a triggered one:
 * a verdict computed over an incomplete set is not a verdict.
 */
export function rollUpHealth(signals: readonly HomeSignal[]): HomeHealthState {
  const list = Array.isArray(signals) ? signals : [];
  if (!list.every((signal) => signal?.state === "ok" || signal?.state === "triggered")) {
    return "unknown";
  }
  let degraded = false;
  for (const code of REQUIRED_HOME_SIGNALS) {
    const reported = list.filter((signal) => signal.code === code);
    if (reported.length === 0) return "unknown";
    if (reported.some((signal) => signal.state === "triggered")) degraded = true;
  }
  return degraded ? "degraded" : "healthy";
}
