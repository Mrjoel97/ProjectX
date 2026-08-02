"use client";

import { api } from "@pikar/backend/api";
import type { BusinessProfile } from "@pikar/core";
import { useMutation } from "convex/react";
import { useState } from "react";
import { LabeledField, readMissing, SLOT_LABEL } from "./ShapePanel";
import { card, field, label, primaryButton } from "./styles";

export function NarrativePanel({
  profile,
  setProfile,
}: {
  profile: BusinessProfile;
  setProfile: React.Dispatch<React.SetStateAction<BusinessProfile | null>>;
}) {
  const update = useMutation(api.onboarding.updateProfile);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      // Built field-by-field, deliberately NOT by spreading `profile`: the loaded object carries the
      // read-only `persona` projection, and a spread would send it back as an argument. The arg
      // validator would reject that (SC#1b), so the spread is not merely untidy — it would break
      // Save. Listing the editable fields also means a future addition to BusinessProfile cannot
      // leak into the write by accident.
      await update({
        profile: {
          name: profile.name,
          oneLineDescription: profile.oneLineDescription,
          stage: profile.stage,
          offering: profile.offering,
          targetCustomer: profile.targetCustomer,
          primaryGoals: profile.primaryGoals.map((s) => s.trim()).filter(Boolean),
          knownConstraints: profile.knownConstraints.map((s) => s.trim()).filter(Boolean),
        },
      });
      setSaved(true);
    } catch (err) {
      const missing = readMissing(err);
      setError(
        missing
          ? `I need a bit more about the business first — ${missing.map((s) => SLOT_LABEL[s]).join(", ")}. Fill that in above and save the business shape.`
          : "Couldn't save your profile. Please check the fields and try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={card}>
      <span style={label}>What the business is</span>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(17rem, 1fr))",
          gap: "1rem",
        }}
      >
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
          <input
            style={field}
            value={profile.stage}
            onChange={(e) => set("stage", e.target.value)}
          />
        </LabeledField>
      </div>

      {/* The long-form answers get the full width, one per row. They were columned with the short
            inputs, which squeezed a paragraph into ~17rem and made the user lean in to read what
            they had just typed. Short facts tile; prose does not. */}
      <div style={{ display: "grid", gap: "1rem" }}>
        <LabeledField label="Offering (optional)">
          <textarea
            style={field}
            rows={3}
            value={profile.offering}
            onChange={(e) => set("offering", e.target.value)}
          />
        </LabeledField>
        <LabeledField label="Target customer (optional)">
          <textarea
            style={field}
            rows={3}
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
      </div>

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
          style={primaryButton(saving || !requiredFilled)}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {saved && !saving && (
          <span
            role="status"
            aria-live="polite"
            style={{ color: "var(--released)", fontWeight: 600, fontSize: "0.9rem" }}
          >
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
  );
}
