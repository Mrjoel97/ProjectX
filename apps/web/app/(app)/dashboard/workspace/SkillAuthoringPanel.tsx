"use client";

import { api } from "@pikar/backend/api";
// The CLOSED three-name set, its user-facing copy and the byte cap — imported, never re-listed.
// A duplicated literal here is exactly how a UI and a registry drift apart (21-01 skill.ts).
import {
  USER_AUTHORABLE_SKILL_METADATA,
  USER_AUTHORABLE_SKILLS,
  USER_SKILL_ADAPTATION_MAX_BYTES,
} from "@pikar/contracts/skill";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

// SKILL-01: the user's ONE authoring surface. It publishes a bounded business adaptation as an
// immutable tenant CANDIDATE and shows honest state. It is deliberately NOT a prompt editor:
//
//  - there is no Activate control, and no import of an activation API. Evaluation is a governed,
//    paid operator run (21-03) and activation is an owner mutation (21-04). A control here would
//    be a lie even if the server refused it.
//  - the base/composed body is NEVER rendered. Raw registry bodies are an owner-only disclosure
//    boundary; the server composes and the user only ever sees their own words back.
//  - no tool selector, schedule, trigger or routine builder. Capability is code-owned (ADR-007),
//    and prompt text is not a capability grant.
//  - no eval-fixture content: the golden corpus is held out from the authoring actor.
//
// Rendered inline in the chat pane from the existing "Chat options" menu — no new route and no nav
// entry (BRAND §4: the cockpit is two panes, and this is a card on one of them).

const card = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: "0.75rem",
  padding: "1rem",
  display: "flex",
  flexDirection: "column" as const,
  gap: "0.6rem",
};
const dim = { margin: 0, fontSize: "0.8rem", color: "var(--ink-soft)" } as const;

/**
 * Honest state copy, in WORDS. Never colour alone (BRAND §6), and never a word that implies an
 * evaluation or an activation that has not happened. `gatePassed` is a boolean the server derived
 * from recorded evidence; the evidence itself never reaches this component.
 */
export function skillStateLabel(state: { status: string; gatePassed: boolean }): string {
  if (state.status === "active") return "Live — this is what your agent uses now";
  if (state.status === "archived") return "Replaced by a newer version";
  if (state.status === "rolled_back") return "Rolled back — no longer in use";
  return state.gatePassed
    ? "Evaluation passed — waiting for Pikar to approve it"
    : "Draft saved — waiting to be evaluated. Nothing has changed yet.";
}

/** Closed author copy only; identity/source refs remain on the owner surface. */
export function skillAuthorLabel(author: "user" | "agent"): string {
  return author === "agent" ? "Authored with Executive" : "Authored by you";
}

/** UTF-8 bytes, matching the server's cap exactly — a character count would under-report a paste. */
export const adaptationBytes = (text: string) => new TextEncoder().encode(text.trim()).length;

export function SkillAuthoringPanel({ onClose }: { onClose: () => void }) {
  const mine = useQuery(api.skills.myUserSkills);
  const publish = useMutation(api.skills.publishUserCandidate);
  const [name, setName] = useState<string>(USER_AUTHORABLE_SKILLS[0]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const bytes = adaptationBytes(text);
  const overCap = bytes > USER_SKILL_ADAPTATION_MAX_BYTES;
  const empty = bytes === 0;

  const submit = async () => {
    setError(null);
    setSaved(null);
    setBusy(true);
    try {
      const res = await publish({ name, authoredBody: text });
      setSaved(
        res.inserted
          ? `Saved as version ${res.version}. It is a draft — nothing your agent does has changed yet.`
          : "You have already saved exactly this adaptation, so nothing new was created.",
      );
      setText("");
    } catch {
      // The caller's own words never reach an error string or a log (CLAUDE.md §4). The refusals
      // this surface can actually produce are "too long" and "empty", both already shown live
      // above the button, so a generic sentence loses the user nothing.
      setError("That could not be saved. Check the length and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={card} aria-label="Adapt a business skill">
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="caps-label" style={{ margin: 0 }}>
            Adapt a business skill
          </p>
          <p style={dim}>
            Pikar keeps the core of each skill and adds your notes to it. Your draft is reviewed
            before it can go live, so saving one changes nothing straight away.
          </p>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close skill authoring"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Which skill</span>
        <select
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          style={{
            padding: "0.5rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--rule)",
            background: "var(--card)",
            color: "var(--ink)",
            fontFamily: "inherit",
            fontSize: "0.9rem",
          }}
        >
          {USER_AUTHORABLE_SKILLS.map((n) => (
            <option key={n} value={n}>
              {USER_AUTHORABLE_SKILL_METADATA[n].label}
            </option>
          ))}
        </select>
      </label>
      <p style={dim}>
        {
          USER_AUTHORABLE_SKILL_METADATA[name as keyof typeof USER_AUTHORABLE_SKILL_METADATA]
            ?.description
        }
      </p>

      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
          What should it do differently for your business?
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          rows={6}
          placeholder="e.g. Always quote in AUD, and never propose a discount over 20%."
          style={{
            padding: "0.5rem",
            borderRadius: "0.375rem",
            border: `1px solid ${overCap ? "var(--ink)" : "var(--rule)"}`,
            background: "var(--card)",
            color: "var(--ink)",
            fontFamily: "inherit",
            fontSize: "0.9rem",
            resize: "vertical",
          }}
        />
      </label>
      {/* The count is stated in words as well as numbers, and the over-cap case says what to do. */}
      <p style={dim}>
        {bytes} of {USER_SKILL_ADAPTATION_MAX_BYTES} characters used
        {overCap ? " — too long to save. Shorten it and try again." : ""}
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <button
          type="button"
          className="cta-dark"
          style={{
            margin: 0,
            padding: "0.55rem 1rem",
            fontSize: "0.85rem",
            border: "none",
            cursor: busy || empty || overCap ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            opacity: busy || empty || overCap ? 0.5 : 1,
          }}
          disabled={busy || empty || overCap}
          onClick={() => void submit()}
        >
          {busy ? "Saving…" : "Save as draft"}
        </button>
        {saved !== null && <p style={dim}>{saved}</p>}
        {error !== null && (
          <p role="alert" style={{ ...dim, color: "var(--ink)" }}>
            {error}
          </p>
        )}
      </div>

      <div>
        <p className="caps-label" style={{ margin: "0.4rem 0 0.3rem" }}>
          Your adaptations
        </p>
        {mine === undefined ? (
          <p style={dim}>Loading…</p>
        ) : mine.length === 0 ? (
          <p style={dim}>You have not adapted a skill yet.</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.5rem" }}>
            {mine.map((s) => (
              <li
                key={`${s.name}-${s.version}`}
                style={{ borderTop: "1px solid var(--rule)", paddingTop: "0.5rem" }}
              >
                <p style={{ margin: 0, fontSize: "0.85rem", fontWeight: 600 }}>
                  {s.label} · version {s.version}
                </p>
                <p style={dim}>{skillAuthorLabel(s.author)}</p>
                <p style={dim}>{skillStateLabel(s)}</p>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>{s.authoredBody}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
