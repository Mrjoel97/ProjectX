"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useState } from "react";

// `@pikar/backend` exports only `./api`, so ids are reached through the function's own return
// type rather than `dataModel` — the same route ApprovalsView takes.
type PendingRow = FunctionReturnType<typeof api.invites.pending>[number];

/**
 * BETA-01 owner admin: the waitlist queue and invite issuance.
 *
 * DELIBERATELY NOT A CONSOLIDATION OF `/ops`. The plan said "consolidate or link"; `/ops` is the
 * 800-line Compliance surface calling eleven backend APIs (dead letters, eval signals, the
 * optimizer controls, and the whole tenant-skill overlay review flow), and folding a three-control
 * caricature of it into here would orphan shipped UI. It gets a link.
 *
 * Mounting is gated by the server component; this view assumes the caller is an owner and every
 * endpoint it calls is `ownerQuery`/`ownerMutation` anyway. Hiding a control is cosmetic — the
 * wrappers are the boundary.
 */
/**
 * 25-10 hosted readiness. NAMES ONLY — never a value, not even a masked one. A readiness screen
 * that echoed a secret to prove it was set would be a worse leak than the misconfiguration it
 * reports.
 *
 * `ready` turns on REQUIRED names alone: a dark feature is a product decision, a missing required
 * name is a broken deployment, and collapsing the two makes this unactionable.
 */
function EnvReadiness() {
  const env = useQuery(api.ops.envCheck, {});
  if (env === undefined) return null;

  return (
    <section style={{ display: "grid", gap: "0.5rem" }}>
      <p className="caps-label" style={{ margin: 0 }}>
        Hosted configuration
      </p>
      <p style={{ margin: 0, color: env.ready ? "var(--ink)" : "#92400e", fontWeight: 600 }}>
        {/* `ready` now turns on three things, so the headline may not name only one of them. It
            used to say "Every required name is set." while the skill registry was unseeded and a
            whole feature threw on contact. */}
        {env.ready
          ? "Every required name is set and every agent has its prompt."
          : [
              env.missingRequired.length > 0 &&
                `${env.missingRequired.length} required name(s) missing — delivery or sign-in is broken.`,
              env.unseededSkills.length > 0 &&
                `${env.unseededSkills.length} agent(s) have no prompt row — those surfaces throw when used.`,
              env.nonDurableOrigins.length > 0 && "An origin will stop resolving.",
            ]
              .filter(Boolean)
              .join(" ")}
      </p>
      {env.missingRequired.length > 0 && (
        <p style={{ margin: 0, color: "#92400e" }}>
          <code>{env.missingRequired.join(", ")}</code>
        </p>
      )}
      {env.unseededSkills.length > 0 && (
        <p style={{ margin: 0, color: "#92400e" }}>
          {/* §5 puts every agent prompt in the `skills` table and `loadSkill` fails CLOSED, so an
              unseeded name is not a dark feature — it is a surface that throws when a user touches
              it. Nothing reported this until 2026-08-30, when unified knowledge search shipped
              INERT on a deployment nobody had re-seeded. The remedy is one command, so it is on
              screen rather than in a runbook nobody opens. */}
          Agents with no active prompt row: <code>{env.unseededSkills.join(", ")}</code>
          <br />
          Fix with <code>npx convex run skills:seedSkills &apos;&#123;&#125;&apos;</code> from{" "}
          <code>packages/backend</code>.
        </p>
      )}
      {env.nonDurableOrigins.length > 0 && (
        <p style={{ margin: 0, color: "#92400e" }}>
          {/* ADR-022. The name is SET, so nothing reads as missing — but the URL stops resolving,
              which an unsubscribe link in an already-sent email cannot survive. */}
          Origins that will stop resolving (preview build, localhost or plain http):{" "}
          <code>{env.nonDurableOrigins.join(", ")}</code>
        </p>
      )}
      {env.missingFeature.length > 0 && (
        <p style={{ margin: 0, color: "var(--ink-2)", fontSize: "0.9rem" }}>
          Features dark: <code>{env.missingFeature.join(", ")}</code>
        </p>
      )}
      {env.fixturesActive.length > 0 && (
        <p style={{ margin: 0, color: "#92400e", fontSize: "0.9rem" }}>
          {/* The dangerous one: a fixture seam left on FAKES a provider, so it looks like success. */}
          Fixture seams ACTIVE — these fake real providers:{" "}
          <code>{env.fixturesActive.join(", ")}</code>
        </p>
      )}
    </section>
  );
}

export function AdminView() {
  const pending = useQuery(api.invites.pending, {});
  const approve = useMutation(api.invites.approve);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The live code is held in memory for THIS session only, so the owner can copy the link. It is
  // never written to a log, an audit payload, or anywhere else (CLAUDE.md §4). `approve` is
  // replay-safe, so re-approving is how you get it back rather than persisting it here.
  const [issued, setIssued] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  async function onApprove(waitlistId: PendingRow["waitlistId"]) {
    setBusy(waitlistId);
    setError(null);
    try {
      const invite = await approve({ waitlistId });
      setIssued((prior) => ({ ...prior, [waitlistId]: invite.code }));
    } catch {
      setError("Could not approve that request. Reload and try again.");
    }
    setBusy(null);
  }

  async function onCopy(code: string) {
    const link = `${window.location.origin}/signup?invite=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(code);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard is permission-gated and can simply refuse. The link is on screen either way,
      // so say so rather than pretending the copy worked.
      setError("Couldn't reach the clipboard — select the link and copy it by hand.");
    }
  }

  return (
    <div style={{ display: "grid", gap: "1.5rem", alignContent: "start" }}>
      <h1
        style={{
          margin: 0,
          fontFamily: "var(--font-display), system-ui, sans-serif",
          fontWeight: 800,
          fontSize: "clamp(1.9rem, 1.4rem + 1.8vw, 2.75rem)",
          letterSpacing: "-0.03em",
          color: "var(--ink)",
        }}
      >
        Admin
      </h1>

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      <section style={{ display: "grid", gap: "0.9rem" }}>
        <p className="caps-label" style={{ margin: 0 }}>
          Beta waitlist
        </p>

        {pending === undefined && <p style={{ margin: 0, color: "var(--ink-2)" }}>Loading…</p>}

        {pending?.length === 0 && (
          <p style={{ margin: 0, color: "var(--ink-2)" }}>
            No one is waiting. Requests from <code>/signup</code> appear here.
          </p>
        )}

        {pending?.map((row) => {
          const code = issued[row.waitlistId];
          return (
            <div
              key={row.waitlistId}
              style={{
                display: "grid",
                gap: "0.5rem",
                padding: "0.9rem 1rem",
                border: "1px solid var(--line)",
                borderRadius: "0.7rem",
              }}
            >
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                <strong style={{ color: "var(--ink)" }}>{row.email}</strong>
                {row.name && <span style={{ color: "var(--ink-2)" }}>{row.name}</span>}
              </div>
              {row.referral && (
                <p style={{ margin: 0, color: "var(--ink-2)", fontSize: "0.9rem" }}>
                  “{row.referral}”
                </p>
              )}

              {code ? (
                <div style={{ display: "grid", gap: "0.4rem" }}>
                  <code style={{ wordBreak: "break-all", color: "var(--ink)" }}>
                    /signup?invite={code}
                  </code>
                  <div>
                    <button
                      type="button"
                      className="vault-button"
                      onClick={() => void onCopy(code)}
                    >
                      {copied === code ? "Copied" : "Copy invite link"}
                    </button>
                  </div>
                  <p style={{ margin: 0, color: "var(--ink-2)", fontSize: "0.85rem" }}>
                    Send this to {row.email}. It only works for that address, and only once.
                  </p>
                </div>
              ) : (
                <div>
                  <button
                    type="button"
                    className="vault-button"
                    disabled={busy === row.waitlistId}
                    onClick={() => void onApprove(row.waitlistId)}
                  >
                    {busy === row.waitlistId ? "Approving…" : "Approve & mint invite"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <EnvReadiness />

      <section style={{ display: "grid", gap: "0.5rem" }}>
        <p className="caps-label" style={{ margin: 0 }}>
          Other operator surfaces
        </p>
        <p style={{ margin: 0, color: "var(--ink-2)" }}>
          Dead letters, eval signals, the optimizer controls and tenant-skill review live on{" "}
          <Link href="/ops">Compliance</Link>. They are not duplicated here — one implementation of
          each control.
        </p>
      </section>
    </div>
  );
}
