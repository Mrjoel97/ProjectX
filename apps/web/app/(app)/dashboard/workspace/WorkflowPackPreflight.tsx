"use client";

// 27-09 (PACK-04): what a workflow pack can and cannot see, shown BEFORE it is started.
//
// This component is the honest-partial contract's first half. Every pack in the pilot has at least
// one source no agent-reachable read serves (owner decision A, 2026-08-23), so a quick start that
// showed only a title would be advertising work while hiding the thing the user most needs to know
// about it — and the apology afterwards would land as a surprise instead of a reminder.
//
// TWO KINDS OF GAP, AND THEY ARE NOT THE SAME THING:
//
//   a RUNTIME gap   the pack can read this plane, this account has not connected it. The user can
//                   fix it, so it reads as a connection prompt.
//   a MATRIX gap    nothing in Pikar can read this plane yet. The user cannot fix it, so it reads
//                   as a limit with the thing that would lift it named — a gap stated without its
//                   unlock leaves someone with a complaint instead of a next step.
//
// The two are distinguished by `unlock`, which the server sets ONLY for a matrix gap. Deciding it
// here from the state would be a second copy of a rule `packPreflight` already owns.
//
// BRAND: `--ink-soft` for the quiet text, `--released` for a plane that answered, `--rule` for the
// hairline. NEVER `--held` — BRAND §2 spends amber on the approval gate alone, and an unreadable
// source is not held, it is absent.

export type PackSourceView = {
  source: string;
  label: string;
  state: "available" | "partial" | "unavailable";
  unlock: string | null;
};

/** The dot's colour and its screen-reader word, in one place so they can never disagree. */
const STATE_MARK: Record<PackSourceView["state"], { color: string; word: string }> = {
  available: { color: "var(--released)", word: "can read" },
  partial: { color: "var(--ink-soft)", word: "partly readable" },
  unavailable: { color: "var(--rule)", word: "cannot read" },
};

export function WorkflowPackPreflight({ sources }: { sources: readonly PackSourceView[] }) {
  // An empty list is a real state (a pack whose sources the server could not resolve) and it must
  // not render as a confident blank — silence here would read as "nothing is missing".
  if (sources.length === 0) {
    return (
      <p className="pack-preflight-empty" style={{ color: "var(--ink-soft)", margin: 0 }}>
        I could not check what this workflow can see. Start it and it will tell you.
      </p>
    );
  }

  const readable = sources.filter((s) => s.state !== "unavailable");
  const gaps = sources.filter((s) => s.state === "unavailable");

  return (
    <div className="pack-preflight">
      <ul
        className="pack-preflight-list"
        style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.15rem" }}
      >
        {sources.map((s) => (
          <li
            key={s.source}
            className="pack-preflight-source"
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "0.4rem",
              color: "var(--ink-soft)",
              fontSize: "0.85rem",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                flex: "none",
                width: "0.45rem",
                height: "0.45rem",
                borderRadius: "50%",
                background: STATE_MARK[s.state].color,
              }}
            />
            {/* The state is CARRIED IN TEXT, not only in the dot. A colour-only status is invisible
                to a screen reader and to anyone who cannot separate the two greys (BRAND §7). */}
            <span>
              {s.label} — {STATE_MARK[s.state].word}
            </span>
          </li>
        ))}
      </ul>

      {/* THE UNLOCKS. Rendered from the server's `unlock`, never inferred from the state: a runtime
          gap is a connection the user can make and must not be told it needs a product change. */}
      {gaps.some((s) => s.unlock !== null) && (
        <p
          className="pack-preflight-unlocks"
          style={{ color: "var(--ink-soft)", fontSize: "0.8rem", margin: "0.35rem 0 0" }}
        >
          Not readable in this workflow at all:{" "}
          {gaps
            .filter((s) => s.unlock !== null)
            .map((s) => `${s.label} (would need ${s.unlock})`)
            .join("; ")}
          .
        </p>
      )}

      {/* A count, so the summary cannot silently disagree with the list above it. */}
      <p
        className="pack-preflight-summary"
        style={{ display: "none" }}
        data-testid="preflight-count"
      >
        {readable.length} of {sources.length} readable
      </p>
    </div>
  );
}
