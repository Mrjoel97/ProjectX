"use client";

import { useAuthToken } from "@convex-dev/auth/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

// SC1: a two-pane resizable cockpit shell built on native CSS grid + Pointer Events —
// no react-resizable-panels (ponytail rung 4: the platform already resizes columns).
// Accessibility is NOT lazy (CLAUDE.md §8): the divider is a focusable role="separator"
// with arrow-key nudging, not a mouse-only drag target.
// ponytail: localStorage split, per-user-per-browser. Upgrade to a convex userPrefs row
// if cross-device sync is required.

const MIN = 20; // each pane clamped to >=20% of the container
const MAX = 80;
const DEFAULT = 30; // chat ~30% left / workspace ~70% right
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, n));

// 25.2 (G15): below this width the two-pane grid gave the chat ~110px. A phone gets ONE pane at a
// time — chat first, the work behind a toggle. Both panes stay MOUNTED (hidden, not unmounted), so
// a half-typed message and every open subscription survive the switch.
export const NARROW_QUERY = "(max-width: 48rem)";
export function paneLayout(
  narrow: boolean,
  showWork: boolean,
  pct: number,
): { showLeft: boolean; showRight: boolean; columns: string } {
  if (!narrow) return { showLeft: true, showRight: true, columns: `${pct}% 6px 1fr` };
  return showWork
    ? { showLeft: false, showRight: true, columns: "1fr" }
    : { showLeft: true, showRight: false, columns: "1fr" };
}

// Convex Auth's JWT `sub` is "<userId>|<sessionId>" — the userId half identifies the
// signed-in user client-side with no round-trip. Falls back to "anon" pre-auth (the page
// mounts inside <Authenticated>, so a real token is present by the time it matters).
function userKey(token: string | null): string {
  if (!token) return "anon";
  try {
    const payload = JSON.parse(atob(token.split(".")[1] ?? ""));
    return String(payload.sub ?? "anon").split("|")[0] ?? "anon";
  } catch {
    return "anon";
  }
}

function readSaved(key: string): number {
  if (typeof window === "undefined") return DEFAULT;
  const saved = Number(window.localStorage.getItem(key));
  return Number.isFinite(saved) && saved >= MIN && saved <= MAX ? saved : DEFAULT;
}

export function SplitPane({ left, right }: { left: ReactNode; right: ReactNode }) {
  const storageKey = `cockpit.split.${userKey(useAuthToken())}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [pct, setPct] = useState<number>(() => readSaved(storageKey));
  // SSR renders the desktop grid; the media query is read after mount and tracked live.
  const [narrow, setNarrow] = useState(false);
  const [showWork, setShowWork] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const layout = paneLayout(narrow, showWork, pct);

  const persist = (p: number) => {
    try {
      window.localStorage.setItem(storageKey, String(p));
    } catch {
      /* private mode / storage disabled — keep the live split, just don't persist */
    }
  };

  // Re-read once the auth token resolves (storageKey flips anon -> userId).
  useEffect(() => {
    setPct(readSaved(storageKey));
  }, [storageKey]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragging.current = true;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPct(clamp(((e.clientX - rect.left) / rect.width) * 100));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setPct((p) => {
      persist(p);
      return p;
    });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const delta = e.key === "ArrowLeft" ? -2 : e.key === "ArrowRight" ? 2 : 0;
    if (!delta) return;
    e.preventDefault();
    setPct((p) => {
      const n = clamp(p + delta);
      persist(n);
      return n;
    });
  };

  return (
    <div
      ref={containerRef}
      style={{
        display: "grid",
        gridTemplateColumns: layout.columns,
        gridTemplateRows: narrow ? "auto minmax(0, 1fr)" : undefined,
        height: "100%",
        minHeight: 0,
      }}
    >
      {narrow && (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "0.4rem 0.6rem 0" }}>
          <button
            type="button"
            className="composer-pill"
            aria-pressed={showWork}
            onClick={() => setShowWork((w) => !w)}
          >
            {showWork ? "Back to chat" : "Show work"}
          </button>
        </div>
      )}
      <div
        data-testid="split-left"
        hidden={!layout.showLeft}
        style={{ minWidth: 0, overflow: "auto" }}
      >
        {left}
      </div>
      <hr
        hidden={narrow}
        data-testid="split-handle"
        aria-orientation="vertical"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
        // Quiet seam (brand-024149): a 1px hairline centered in the 6px grab zone —
        // the panes read as one surface; the divider is felt, not seen.
        style={{
          border: 0,
          margin: 0,
          padding: 0,
          cursor: "col-resize",
          background:
            "linear-gradient(to right, transparent 2px, var(--rule) 2px, var(--rule) 3px, transparent 3px)",
          touchAction: "none",
        }}
      />
      <div
        data-testid="split-right"
        hidden={!layout.showRight}
        style={{ minWidth: 0, overflow: "auto" }}
      >
        {right}
      </div>
    </div>
  );
}
