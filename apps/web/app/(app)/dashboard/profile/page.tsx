"use client";

import { api } from "@pikar/backend/api";
import { type BusinessProfile, PERSONAS, type Persona } from "@pikar/core";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

// ONBD-02 dedicated profile page — the post-onboarding EDIT surface. Editability is a locked
// decision: a user (especially an idea-stage one who onboarded sparse — only oneLineDescription +
// persona) returns here to enrich name/offering/target-customer as the idea matures, and to correct
// anything, WITHOUT re-onboarding. It loads the committed profile via api.onboarding.getProfile (the
// vault doc parsed back to structured fields) and saves through api.onboarding.updateProfile, which
// RE-EMBEDS the doc in place — the stale rag entry is replaced so grounding (Phase 12 eval / Phase 14
// flagship) always reads the current profile. It reuses the onboarding review-card shape + BRAND §5
// tokens (no new component library, §10). Sparse-start: only oneLineDescription is required to save;
// name/stage/offering/target customer stay optional and never block Save.

const label: React.CSSProperties = {
  fontSize: "0.72rem",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--ink-soft)",
};

const field: React.CSSProperties = {
  width: "100%",
  padding: "0.6rem 0.75rem",
  borderRadius: "0.7rem",
  border: "1px solid var(--rule)",
  fontFamily: "inherit",
  fontSize: "0.95rem",
  background: "var(--card)",
  color: "var(--ink)",
  resize: "vertical",
};

const page: React.CSSProperties = {
  maxWidth: "44rem",
  margin: "0 auto",
  padding: "2rem 1.25rem",
  display: "grid",
  gap: "1.5rem",
};

export default function ProfilePage() {
  const current = useQuery(api.onboarding.getProfile);
  const update = useMutation(api.onboarding.updateProfile);

  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the editable state once the committed profile loads.
  useEffect(() => {
    if (current) setProfile(current);
  }, [current]);

  function set<K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]) {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
    setSaved(false);
  }

  // Sparse-start mirror (@pikar/core validateProfile): only a one-line description is required —
  // name/stage/offering/target customer are optional and never block Save.
  const requiredFilled = !!profile && profile.oneLineDescription.trim() !== "";

  async function onSave() {
    if (!profile || saving || !requiredFilled) return;
    setSaving(true);
    setError(null);
    try {
      await update({
        profile: {
          ...profile,
          primaryGoals: profile.primaryGoals.map((s) => s.trim()).filter(Boolean),
          knownConstraints: profile.knownConstraints.map((s) => s.trim()).filter(Boolean),
        },
      });
      setSaved(true);
    } catch {
      setError("Couldn't save your profile. Please check the fields and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (current === undefined || (current && !profile)) {
    return (
      <div style={page}>
        <p role="status" aria-live="polite" style={{ color: "var(--ink-soft)" }}>
          Loading your business profile…
        </p>
      </div>
    );
  }

  if (current === null || !profile) {
    return (
      <div style={page}>
        <header style={{ display: "grid", gap: "0.5rem" }}>
          <span style={label}>Business profile</span>
          <h1 style={{ fontSize: "clamp(1.5rem, 4vw, 2rem)", fontWeight: 700, color: "var(--ink)", margin: 0 }}>
            No profile yet
          </h1>
        </header>
        <p style={{ color: "var(--ink-soft)", margin: 0 }}>
          Set up your business first, then come back here to keep it current.{" "}
          <a href="/dashboard/onboarding" style={{ color: "var(--teal-600)", fontWeight: 600 }}>
            Start onboarding
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div style={page}>
      <header style={{ display: "grid", gap: "0.5rem" }}>
        <span style={label}>Business profile</span>
        <h1 style={{ fontSize: "clamp(1.5rem, 4vw, 2rem)", fontWeight: 700, color: "var(--ink)", margin: 0 }}>
          Your business profile
        </h1>
        <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
          Every agent turn reads this. Keep it current — saving updates what Pikar AI knows about your
          business.
        </p>
      </header>

      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--rule)",
          borderRadius: "1.1rem",
          padding: "1.25rem",
          boxShadow: "0 12px 32px -24px rgb(14 20 25 / 45%)",
          display: "grid",
          gap: "1rem",
        }}
      >
        {/* Persona — always editable/confirmable (SC#1: enterprise is never offered) */}
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <span style={label}>Persona</span>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {PERSONAS.map((p: Persona) => {
              const active = profile.persona === p;
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={active}
                  onClick={() => set("persona", p)}
                  style={{
                    padding: "0.45rem 1rem",
                    borderRadius: "999px",
                    border: active ? "1px solid var(--teal-600)" : "1px solid var(--rule)",
                    background: active ? "var(--teal-600)" : "transparent",
                    color: active ? "#fff" : "var(--ink-soft)",
                    fontWeight: 600,
                    fontSize: "0.9rem",
                    textTransform: "capitalize",
                    cursor: "pointer",
                  }}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>

        <LabeledField label="Business name (optional)">
          <input style={field} value={profile.name} onChange={(e) => set("name", e.target.value)} />
        </LabeledField>
        <LabeledField label="One-line description">
          <input
            style={field}
            value={profile.oneLineDescription}
            onChange={(e) => set("oneLineDescription", e.target.value)}
          />
        </LabeledField>
        <LabeledField label="Stage (optional)">
          <input style={field} value={profile.stage} onChange={(e) => set("stage", e.target.value)} />
        </LabeledField>
        <LabeledField label="Offering (optional)">
          <textarea
            style={field}
            rows={2}
            value={profile.offering}
            onChange={(e) => set("offering", e.target.value)}
          />
        </LabeledField>
        <LabeledField label="Target customer (optional)">
          <textarea
            style={field}
            rows={2}
            value={profile.targetCustomer}
            onChange={(e) => set("targetCustomer", e.target.value)}
          />
        </LabeledField>
        <LabeledField label="Primary goals (one per line)">
          <textarea
            style={field}
            rows={3}
            value={profile.primaryGoals.join("\n")}
            onChange={(e) => set("primaryGoals", e.target.value.split("\n"))}
          />
        </LabeledField>
        <LabeledField label="Known constraints (one per line)">
          <textarea
            style={field}
            rows={2}
            value={profile.knownConstraints.join("\n")}
            onChange={(e) => set("knownConstraints", e.target.value.split("\n"))}
          />
        </LabeledField>

        {error && (
          <p role="alert" style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={saving || !requiredFilled}
            onClick={() => void onSave()}
            style={{
              padding: "0.65rem 1.5rem",
              borderRadius: "999px",
              border: "none",
              background: "var(--teal-600)",
              color: "#fff",
              fontWeight: 700,
              fontSize: "0.95rem",
              cursor: saving || !requiredFilled ? "default" : "pointer",
              opacity: saving || !requiredFilled ? 0.5 : 1,
              boxShadow: "0 8px 18px -8px rgb(0 150 137 / 70%)",
            }}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          {saved && !saving && (
            <span role="status" aria-live="polite" style={{ color: "var(--released)", fontWeight: 600, fontSize: "0.9rem" }}>
              Saved — grounding updated.
            </span>
          )}
          {!requiredFilled && (
            <span style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>
              A one-line description is required — the rest is optional, fill it in as your business
              takes shape.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function LabeledField({ label: text, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: "0.35rem" }}>
      <span style={label}>{text}</span>
      {children}
    </label>
  );
}
