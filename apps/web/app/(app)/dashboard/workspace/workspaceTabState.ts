import { parseWorkspaceArtifactKey } from "@pikar/core/workspaceArtifacts";

/** Browser view preferences only. Artifact data and download capabilities stay on the server. */
export const WORK_TAB = "work";
export const MAX_OPEN_ARTIFACTS = 30;
export type WorkspaceTabState = {
  version: 1;
  open: string[];
  active: string;
  closed: string[];
  seen: string[];
  unread: string[];
  latestAt: number;
  followLatest: boolean;
};
export type ArtifactIdentity = { key: string; createdAt: number };

export const emptyWorkspaceTabs = (): WorkspaceTabState => ({
  version: 1,
  open: [],
  active: WORK_TAB,
  closed: [],
  seen: [],
  unread: [],
  latestAt: 0,
  followLatest: true,
});

/** This is a storage namespace, never an authentication or ownership decision. */
export function workspaceStorageOwner(token: string | null): string {
  try {
    const encoded = (token?.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(encoded));
    const subject = typeof payload.sub === "string" ? payload.sub.split("|")[0] : "";
    return subject && subject.length < 200 ? subject : "anonymous";
  } catch {
    return "anonymous";
  }
}

const validKey = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length < 256 &&
  parseWorkspaceArtifactKey(value) !== null;
const keys = (value: unknown, limit = 250): string[] =>
  Array.isArray(value) ? [...new Set(value.filter(validKey))].slice(-limit) : [];

export function restoreWorkspaceTabs(raw: string | null): WorkspaceTabState {
  if (!raw || raw.length > 160_000) return emptyWorkspaceTabs();
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1) return emptyWorkspaceTabs();
    const open = keys(value.open, MAX_OPEN_ARTIFACTS);
    return {
      version: 1,
      open,
      active: value.active === WORK_TAB || open.includes(value.active) ? value.active : WORK_TAB,
      closed: keys(value.closed),
      seen: keys(value.seen),
      unread: keys(value.unread),
      latestAt: Number.isFinite(value.latestAt) && value.latestAt >= 0 ? value.latestAt : 0,
      followLatest: value.followLatest === true,
    };
  } catch {
    return emptyWorkspaceTabs();
  }
}

/** Loading older history must never masquerade as a newly generated output. */
export function reconcileWorkspaceTabs(
  current: WorkspaceTabState,
  artifacts: readonly ArtifactIdentity[],
): WorkspaceTabState {
  const ordered = [...artifacts].sort(
    (a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key),
  );
  const available = new Set(ordered.map((item) => item.key));
  const open = current.open.filter((key) => available.has(key));
  const closed = current.closed.filter((key) => available.has(key));
  const firstVisit = current.seen.length === 0;
  const newItems = ordered.filter(
    (item) =>
      !item.key.startsWith("source:") &&
      !current.seen.includes(item.key) &&
      !closed.includes(item.key) &&
      (firstVisit || item.createdAt >= current.latestAt),
  );
  const additions = firstVisit ? newItems.slice(0, 1) : newItems;
  const nextOpen = [...new Set([...open, ...additions.map((item) => item.key).reverse()])];
  // Keep a deliberate selection open even when many agents complete work together.
  let uniqueOpen = nextOpen.slice(-MAX_OPEN_ARTIFACTS);
  if (nextOpen.includes(current.active) && !uniqueOpen.includes(current.active))
    uniqueOpen = [current.active, ...uniqueOpen.slice(1)];
  const newest = additions[0]?.key;
  const active =
    current.followLatest && newest
      ? newest
      : current.active === WORK_TAB || uniqueOpen.includes(current.active)
        ? current.active
        : WORK_TAB;
  return {
    ...current,
    open: uniqueOpen,
    active,
    closed,
    seen: [...new Set([...current.seen, ...ordered.map((item) => item.key)])].slice(-250),
    unread: [
      ...new Set([
        ...current.unread.filter((key) => available.has(key)),
        ...(!firstVisit ? additions.map((item) => item.key) : []),
      ]),
    ].filter((key) => key !== active),
    latestAt: Math.max(
      current.latestAt,
      ...ordered.filter((item) => !item.key.startsWith("source:")).map((item) => item.createdAt),
      0,
    ),
  };
}

export function selectWorkspaceTab(state: WorkspaceTabState, key: string): WorkspaceTabState {
  if (key !== WORK_TAB && !validKey(key)) return state;
  return {
    ...state,
    open:
      key === WORK_TAB ? state.open : [...new Set([...state.open, key])].slice(-MAX_OPEN_ARTIFACTS),
    active: key,
    closed: state.closed.filter((item) => item !== key),
    unread: state.unread.filter((item) => item !== key),
    followLatest: false,
  };
}

export function closeWorkspaceTab(state: WorkspaceTabState, key: string): WorkspaceTabState {
  if (key === WORK_TAB) return state;
  const index = state.open.indexOf(key);
  const open = state.open.filter((item) => item !== key);
  return {
    ...state,
    open,
    active: state.active === key ? (open[index] ?? open[index - 1] ?? WORK_TAB) : state.active,
    closed: [...new Set([...state.closed, key])].slice(-250),
    unread: state.unread.filter((item) => item !== key),
    followLatest: false,
  };
}
