"use client";

import { api } from "@pikar/backend/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { card, field, primaryButton } from "./styles";

/** Approval always names the exact saved revision, never a mutable local preview. */
export function BrandKitPanel() {
  const state = useQuery(api.brandKits.state, {});
  const generate = useAction(api.brandKits.generate);
  const approve = useMutation(api.brandKits.approve);
  const discard = useMutation(api.brandKits.discard);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch {
      setMessage("This change could not be saved. Refresh the review and try again.");
    } finally {
      setBusy(false);
    }
  }
  if (state === undefined) return <p role="status">Loading your brand kit…</p>;
  const draft = state.draft;
  const shown = draft ?? state.active;
  const kit = shown?.kit;
  return (
    <section style={card} aria-label="Brand kit">
      <header>
        <h2 style={{ margin: 0 }}>Your brand kit</h2>
        <p style={{ color: "var(--ink-soft)" }}>
          Describe your business and the feeling you want to create. Review the proposed identity,
          then approve it for your agents to use across images, films and documents.
        </p>
        {state.active && (
          <p>
            Approved: {state.active.kit.name} · revision {state.active.revision}
          </p>
        )}
      </header>
      <label style={{ display: "grid", gap: "0.5rem" }}>
        Brand direction or changes
        <textarea
          style={field}
          rows={3}
          maxLength={4000}
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          disabled={busy}
          placeholder="Your product, audience, preferred colors and personality…"
        />
      </label>
      <div>
        <button
          type="button"
          style={{ ...primaryButton(busy || !brief.trim()), minHeight: 44 }}
          disabled={busy || !brief.trim()}
          onClick={() => run(() => generate({ brief }), "Your proposal is ready to review.")}
        >
          {busy
            ? "Working…"
            : draft || state.active
              ? "Create revised proposal"
              : "Create brand proposal"}
        </button>
      </div>
      {kit && shown && (
        <article style={{ border: "1px solid var(--rule)", borderRadius: 16, padding: "1.25rem" }}>
          <p style={{ color: draft ? "var(--held-text)" : "var(--ink-soft)" }}>
            {draft ? "Proposed · awaiting your approval" : "Approved · saved in Knowledge Vault"} ·
            revision {shown.revision}
          </p>
          <h3 style={{ fontSize: "1.75rem", margin: "0.5rem 0" }}>{kit.name}</h3>
          <p>{kit.tagline}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", margin: "1.5rem 0" }}>
            {kit.palette.map((color) => (
              <div key={`${color.name}-${color.hex}`}>
                <div
                  aria-hidden="true"
                  style={{
                    background: color.hex,
                    width: 76,
                    height: 58,
                    borderRadius: 12,
                    border: "1px solid var(--rule)",
                  }}
                />
                <div>{color.name}</div>
                <small>{color.hex}</small>
              </div>
            ))}
          </div>
          <dl style={{ display: "grid", gap: "0.5rem" }}>
            {[
              ["Audience", kit.audience],
              ["Positioning", kit.positioning],
              ["Voice", kit.voice.join(" · ")],
              ["Typography", `${kit.typography.heading} / ${kit.typography.body}`],
              ["Logo direction", kit.logoDirection],
              ["Imagery", kit.imagery],
              ["Motion", kit.motion],
              ["Example copy", kit.examples.join("\n")],
              [
                "Claims to avoid",
                kit.prohibitedClaims.join(" · ") || "No additional restrictions proposed",
              ],
            ].map(([name, value]) => (
              <div key={name}>
                <dt style={{ fontWeight: 600 }}>{name}</dt>
                <dd
                  style={{
                    margin: "0.25rem 0 0.75rem",
                    whiteSpace: "pre-wrap",
                    color: "var(--ink-soft)",
                  }}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          {draft && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
              <button
                type="button"
                disabled={busy}
                style={{ ...primaryButton(busy), minHeight: 44 }}
                onClick={() =>
                  run(
                    () => approve({ revision: draft.revision, reviewHash: draft.reviewHash }),
                    "Brand approved and saved to Knowledge Vault.",
                  )
                }
              >
                Approve this brand kit
              </button>
              <button
                type="button"
                disabled={busy}
                style={{ ...field, width: "auto", minHeight: 44 }}
                onClick={() =>
                  run(
                    () => discard({ revision: draft.revision }),
                    "Proposal discarded. Your approved brand is unchanged.",
                  )
                }
              >
                Discard proposal
              </button>
            </div>
          )}
        </article>
      )}
      <p role="status" aria-live="polite" style={{ margin: 0 }}>
        {message}
      </p>
    </section>
  );
}
