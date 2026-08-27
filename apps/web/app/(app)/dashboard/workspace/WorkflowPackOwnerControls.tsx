"use client";

// 27-11: THE OWNER'S TURN-OFF CONTROL, and it is the undo path for the whole pilot.
//
// WHY IT IS A CONTROL AND NOT A COMMAND. The registry's only other dark path is
// `npx convex run skills:archiveSkill`, and on this stack one `convex run` against the local
// deployment KILLS the browser's saved session — the next navigation lands on /signin. That makes
// it unusable mid-incident and unusable mid-drill: an owner watching a pack misbehave should not
// have to choose between turning it off and staying signed in. `skills.deactivatePack` exists for
// exactly this, and until now nothing in the product called it, so rollback-to-dark was proven by
// nothing at all.
//
// WHY IT IS A SEPARATE COMPONENT. `WorkflowPackQuickStarts` is what every user sees and its own
// header rules out an enable/disable toggle there — correctly, because a capability control next to
// a pack would be describing something the runtime cannot do. This is not that: it is the OWNER's
// incident switch, rendered only for the owner, in its own region.
//
// IT TURNS OFF; IT DOES NOT DELETE. `deactivatePack` patches `status` and nothing else — the body
// stays immutable and the archived row keeps its provenance and evidence, so the decision stays
// auditable and the version can be re-activated later.

export type LivePack = { packId: string; title: string; version: number };

/** Per pack, the newest version that WAS live and is now archived — the rollback target. */
export type PriorVersion = { packId: string; version: number };

export function WorkflowPackOwnerControls({
  packs,
  priorVersions,
  onTurnOff,
  onRollBack,
  busy,
  turningOff,
}: {
  /** ACTIVE packs, and ONLY passed when the viewer is the owner — `undefined` renders nothing. */
  packs: readonly LivePack[] | undefined;
  /** Rollback targets. A pack with none simply has no roll-back control — it has never had a
   *  second live version, and offering one that cannot work is worse than offering none. */
  priorVersions: readonly PriorVersion[] | undefined;
  onTurnOff: (packId: string, title: string) => void;
  onRollBack: (packId: string, title: string, version: number) => void;
  busy: boolean;
  turningOff?: string | null;
}) {
  if (packs === undefined || packs.length === 0) return null;

  return (
    <section className="pack-owner-controls" aria-labelledby="pack-owner-controls-label">
      {/* BRAND §3: tracked caps is the signature section-label pattern. */}
      <h2
        id="pack-owner-controls-label"
        className="pack-owner-controls-label"
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontSize: "0.7rem",
          color: "var(--ink-soft)",
          margin: "0.9rem 0 0.5rem",
        }}
      >
        Live workflows — owner controls
      </h2>

      <p style={{ margin: "0 0 0.6rem", fontSize: "0.8rem", color: "var(--ink-soft)" }}>
        Only you see this. Turning one off hides it from everyone immediately; nothing is deleted
        and you can turn it back on.
      </p>

      <ul
        className="pack-owner-control-list"
        style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.4rem" }}
      >
        {packs.map((pack) => {
          const isOff = turningOff === pack.packId;
          const prior = priorVersions?.find((p) => p.packId === pack.packId);
          return (
            <li
              key={pack.packId}
              className="pack-owner-control"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.6rem",
                flexWrap: "wrap",
                background: "var(--card)",
                border: "1px solid var(--rule)",
                borderRadius: "0.5rem",
                padding: "0.45rem 0.6rem",
              }}
            >
              <span style={{ fontSize: "0.85rem", color: "var(--ink)" }}>
                {pack.title}
                <span style={{ color: "var(--ink-soft)" }}>{` · live v${pack.version}`}</span>
              </span>
              <span style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                {prior !== undefined && (
                  <button
                    type="button"
                    className="pack-owner-roll-back"
                    // The VERSION is in the label, not just "Roll back": an owner mid-incident needs
                    // to know what they are going back TO before they commit to it.
                    aria-label={`Roll back ${pack.title} to v${prior.version}`}
                    disabled={busy || isOff}
                    onClick={() => onRollBack(pack.packId, pack.title, prior.version)}
                    style={{
                      background: "transparent",
                      color: "var(--ink)",
                      border: "1px solid var(--rule)",
                      borderRadius: "0.4rem",
                      padding: "0.25rem 0.6rem",
                      fontSize: "0.8rem",
                      cursor: busy || isOff ? "default" : "pointer",
                    }}
                  >
                    {`Roll back to v${prior.version}`}
                  </button>
                )}
                <button
                  type="button"
                  className="pack-owner-turn-off"
                  // Named per pack: an owner reaching for this during an incident must not have to
                  // count rows to know which one they are about to darken.
                  aria-label={`Turn off ${pack.title}`}
                  aria-busy={isOff}
                  disabled={busy || isOff}
                  onClick={() => onTurnOff(pack.packId, pack.title)}
                  style={{
                    background: "transparent",
                    color: "var(--ink)",
                    border: "1px solid var(--rule)",
                    borderRadius: "0.4rem",
                    padding: "0.25rem 0.6rem",
                    fontSize: "0.8rem",
                    cursor: busy || isOff ? "default" : "pointer",
                  }}
                >
                  {isOff ? "Turning off…" : "Turn off"}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
