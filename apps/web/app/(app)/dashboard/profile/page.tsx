"use client";

import { api } from "@pikar/backend/api";
import {
  BEHAVIOR_PRESETS,
  type BehaviorPreset,
  type BusinessProfile,
  FUNDING_STATES,
  type Funding,
  missingSlots,
  REVENUE_STAGES,
  type RevenueStage,
  type SlotName,
  TIER_REASON,
  type Tier,
  type TierSource,
} from "@pikar/core";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useEffect, useRef, useState } from "react";
import { BlueprintPanel } from "./BlueprintPanel";
import { card, field, label, primaryButton } from "./styles";

// ONBD-02 dedicated profile page — the post-onboarding EDIT surface. Editability is a locked
// decision: a user (especially an idea-stage one who onboarded sparse — only oneLineDescription)
// returns here to enrich name/offering/target-customer as the idea matures, and to correct
// anything, WITHOUT re-onboarding. It reuses the onboarding review-card shape + BRAND §5 tokens (no
// new component library, §10).
//
// Phase 15.1 (design §9) — TWO surfaces, TWO writers, and the difference is the whole point:
//
//   • The BUSINESS SHAPE card writes the tier FACTS through `api.tenantProfile.saveFacts`, which
//     RE-DERIVES the tier from them. **There is no tier argument to send and there never will be.**
//     Editing headcount to 12 moves the tier; nothing sets it directly. That is the entire
//     anti-manipulation mechanism, and it is mostly a subtraction (design §9): the three persona
//     pills were DELETED in plan 03 and a source scan in `businessProfile.test.ts` keeps them gone.
//   • The NARRATIVE card writes the Lean-core fields through `api.onboarding.updateProfile`, which
//     RE-EMBEDS the vault doc in place so grounding always reads the current profile.
//
// The tier itself is rendered READ-ONLY with `TIER_REASON` and an honest `tierSource` — deliberately
// as TEXT, never as a disabled picker, because a greyed-out control still reads as "there is a
// control here". A tier MOVE is surfaced as an EVENT (design §9: "tier change is a moment, not a
// setting"), driven off `saveFacts`'s `changed` flag.
//
// Design §10: a legacy tenant (tier carried over from markdown, no facts) sees a NON-BLOCKING
// invitation to complete the facts. Never a modal, never a redirect, never a gate —
// `onboarding.status` deliberately still returns `needsOnboarding: false` for them.

const page: React.CSSProperties = {
  maxWidth: "44rem",
  margin: "0 auto",
  padding: "2rem 1.25rem",
  display: "grid",
  gap: "1.5rem",
};

/** How the tier reads in a sentence. The tier VALUE itself is still rendered verbatim above it. */
const TIER_NAME = {
  solopreneur: "a solo operation",
  startup: "a startup",
  sme: "an established business",
  enterprise: "an enterprise",
} as const satisfies Record<Tier, string>;

/** `tierSource`, in plain words. Honest about the admin grant and about the §10 carry-over. */
const SOURCE_WORDS = {
  derived: "Worked out from the facts above.",
  confirmed: "Worked out from your facts, and you confirmed it when we set up.",
  admin: "Granted by Pikar AI — not derived from your answers.",
  legacy: "Carried over from your earlier profile, before we started asking these questions.",
} as const satisfies Record<TierSource, string>;

const REVENUE_LABEL = {
  "pre-revenue": "Not earning yet",
  "early-revenue": "Some revenue, still finding the pattern",
  "steady-revenue": "Steady, repeatable revenue",
} as const satisfies Record<RevenueStage, string>;

const FUNDING_LABEL = {
  bootstrapped: "Bootstrapped — no outside money",
  seeking: "Raising, or looking to",
  funded: "Funded by outside investors",
} as const satisfies Record<Funding, string>;

/** The three behaviour presets (15.1-05), each a versioned style directive in the registry (§5). */
const PRESET_TITLE = {
  direct: "Direct",
  coaching: "Coaching",
  concise: "Concise",
} as const satisfies Record<BehaviorPreset, string>;

const PRESET_COPY = {
  direct:
    "Blunt. Names the binding constraint in the first sentence, no preamble, and never softens into “you might consider”.",
  coaching:
    "Opens with the tradeoff and asks the one question that would change the recommendation — then still lands a concrete next step.",
  concise: "Minimum words. The step, the proof metric, the risk. No framing prose.",
} as const satisfies Record<BehaviorPreset, string>;

/** A missing fact in the user's own language — a raw slot name is never shown. */
const SLOT_LABEL = {
  oneLineDescription: "what your business does",
  headcount: "how many people work on this",
  paidStaff: "how many are paid staff",
  revenueStage: "where you are on revenue",
  funding: "how it's funded",
  yearsOperating: "how long it's been running",
} as const satisfies Record<SlotName, string>;

/** Digits only — the three fact numbers are non-negative integers, rejected at the keystroke. */
const digits = (s: string): string => s.replace(/[^0-9]/g, "");
const toNumber = (s: string): number | undefined => (s === "" ? undefined : Number(s));

/** `{code, missing}` off a ConvexError, or null. Both refusal codes share the shape by design. */
function readMissing(err: unknown): SlotName[] | null {
  if (!(err instanceof ConvexError)) return null;
  const data = err.data as { code?: unknown; missing?: unknown } | undefined;
  if (!data || !Array.isArray(data.missing)) return null;
  if (data.code !== "INCOMPLETE_FACTS" && data.code !== "INCOMPLETE_ONBOARDING") return null;
  return data.missing as SlotName[];
}

export default function ProfilePage() {
  const current = useQuery(api.onboarding.getProfile);
  const tierRow = useQuery(api.tenantProfile.get);
  const update = useMutation(api.onboarding.updateProfile);
  const saveFacts = useMutation(api.tenantProfile.saveFacts);

  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Business-shape form state. The three numbers are held as STRINGS so the fields can be empty
  // (a legacy tenant has no facts at all) without coercing an empty box to 0 — `0` is an ANSWER.
  const [headcount, setHeadcount] = useState("");
  const [paidStaff, setPaidStaff] = useState("");
  const [yearsOperating, setYearsOperating] = useState("");
  const [revenueStage, setRevenueStage] = useState<RevenueStage | "">("");
  const [funding, setFunding] = useState<Funding | "">("");
  const [agentName, setAgentName] = useState("");
  const [behaviorPreset, setBehaviorPreset] = useState<BehaviorPreset | "">("");

  const [savingFacts, setSavingFacts] = useState(false);
  const [factsSaved, setFactsSaved] = useState(false);
  const [factsError, setFactsError] = useState<string | null>(null);
  const [factGaps, setFactGaps] = useState<SlotName[] | null>(null);
  const [tierMove, setTierMove] = useState<{ from: Tier | null; to: Tier } | null>(null);

  // Seed the editable state once the committed profile loads.
  useEffect(() => {
    if (current) setProfile(current);
  }, [current]);

  // Seed the facts form ONCE. Re-seeding on every query update would clobber an in-progress edit
  // the moment any other write touched the row.
  const factsSeeded = useRef(false);
  useEffect(() => {
    if (tierRow === undefined || factsSeeded.current) return;
    factsSeeded.current = true;
    if (!tierRow) return;
    setHeadcount(tierRow.headcount === undefined ? "" : String(tierRow.headcount));
    setPaidStaff(tierRow.paidStaff === undefined ? "" : String(tierRow.paidStaff));
    setYearsOperating(tierRow.yearsOperating === undefined ? "" : String(tierRow.yearsOperating));
    setRevenueStage(tierRow.revenueStage ?? "");
    setFunding(tierRow.funding ?? "");
    setAgentName(tierRow.agentName ?? "");
    setBehaviorPreset(tierRow.behaviorPreset ?? "");
  }, [tierRow]);

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

  /**
   * The facts write. **There is no tier field to send** — `saveFacts` re-derives the tier from what
   * lands here, which is the only way a tier moves.
   */
  async function onSaveFacts() {
    if (savingFacts) return;
    setSavingFacts(true);
    setFactsError(null);
    setFactGaps(null);
    setTierMove(null);
    const before = tierRow?.tier ?? null;
    try {
      const result = await saveFacts({
        headcount: toNumber(headcount),
        paidStaff: toNumber(paidStaff),
        yearsOperating: toNumber(yearsOperating),
        revenueStage: revenueStage === "" ? undefined : revenueStage,
        funding: funding === "" ? undefined : funding,
        agentName: agentName.trim() === "" ? undefined : agentName,
        behaviorPreset: behaviorPreset === "" ? undefined : behaviorPreset,
      });
      setFactsSaved(true);
      // Design §9 — a tier change is a MOMENT, not a silent field update. `changed` is the server's
      // own comparison; the page never infers it by diffing what it happens to be rendering.
      if (result.changed) setTierMove({ from: before, to: result.tier });
    } catch (err) {
      const missing = readMissing(err);
      if (missing) setFactGaps(missing);
      else setFactsError("Couldn't save that. Check the numbers and try again.");
    } finally {
      setSavingFacts(false);
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
          <h1
            style={{
              fontSize: "clamp(1.5rem, 4vw, 2rem)",
              fontWeight: 700,
              color: "var(--ink)",
              margin: 0,
            }}
          >
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

  // Which facts the SAVED row is still missing. `oneLineDescription` lives on the vault doc, not the
  // row, so it is supplied here exactly as the server supplies its own placeholder — otherwise every
  // tenant would look like they were missing it.
  const rowGaps: SlotName[] = tierRow
    ? missingSlots({
        headcount: tierRow.headcount,
        paidStaff: tierRow.paidStaff,
        revenueStage: tierRow.revenueStage,
        funding: tierRow.funding,
        yearsOperating: tierRow.yearsOperating,
        oneLineDescription: profile.oneLineDescription || "—",
      })
    : [];
  // Design §10: an INVITATION, never a gate. No modal, no redirect, no blocked route.
  const invite = !tierRow || tierRow.tierSource === "legacy" || rowGaps.length > 0;

  return (
    <div style={page}>
      <header style={{ display: "grid", gap: "0.5rem" }}>
        <span style={label}>Business profile</span>
        <h1
          style={{
            fontSize: "clamp(1.5rem, 4vw, 2rem)",
            fontWeight: 700,
            color: "var(--ink)",
            margin: 0,
          }}
        >
          Your business profile
        </h1>
        <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
          Every agent turn reads this. Keep it current — saving updates what Pikar AI knows about
          your business.
        </p>
      </header>

      {/* ── Business shape: the FACTS the tier is derived from, plus the agent's identity ── */}
      <div style={card}>
        <div style={{ display: "grid", gap: "0.35rem" }}>
          <span style={label}>Business shape</span>
          <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
            These are the facts I work from. Change them whenever the business changes.
          </p>
        </div>

        {invite && (
          <p
            style={{
              margin: 0,
              padding: "0.7rem 0.9rem",
              borderRadius: "0.9rem",
              border: "1px solid var(--rule)",
              background: "color-mix(in srgb, var(--teal-400) 8%, transparent)",
              color: "var(--ink)",
              fontSize: "0.88rem",
            }}
          >
            {tierRow?.tierSource === "legacy"
              ? "Your tier was carried over from your earlier profile, before I started asking these questions."
              : "I don't have the full picture of your operation yet."}{" "}
            Filling these in lets me work it out properly, so advice fits the operation you actually
            have. Nothing here is required — you can come back to it.
          </p>
        )}

        <LabeledField label="How many people work on this, including you?">
          <input
            style={field}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={headcount}
            onChange={(e) => setHeadcount(digits(e.target.value))}
          />
        </LabeledField>
        <LabeledField label="How many of them are paid staff?">
          <input
            style={field}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={paidStaff}
            onChange={(e) => setPaidStaff(digits(e.target.value))}
          />
        </LabeledField>
        <LabeledField label="Where are you on revenue?">
          <select
            style={field}
            value={revenueStage}
            onChange={(e) => setRevenueStage(e.target.value as RevenueStage | "")}
          >
            <option value="">Not said yet</option>
            {REVENUE_STAGES.map((r) => (
              <option key={r} value={r}>
                {REVENUE_LABEL[r]}
              </option>
            ))}
          </select>
        </LabeledField>
        <LabeledField label="How is it funded?">
          <select
            style={field}
            value={funding}
            onChange={(e) => setFunding(e.target.value as Funding | "")}
          >
            <option value="">Not said yet</option>
            {FUNDING_STATES.map((f) => (
              <option key={f} value={f}>
                {FUNDING_LABEL[f]}
              </option>
            ))}
          </select>
        </LabeledField>
        <LabeledField label="How many full years has it been running?">
          <input
            style={field}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={yearsOperating}
            onChange={(e) => setYearsOperating(digits(e.target.value))}
          />
        </LabeledField>

        {/* Business tier — READ-ONLY (design §9). Text, never a control: a disabled picker still
            reads as "there is a control here". The reason and the source make it legible; editing
            the facts above is the ONLY thing that moves it. */}
        <div
          style={{
            display: "grid",
            gap: "0.25rem",
            paddingTop: "0.5rem",
            borderTop: "1px solid var(--rule)",
          }}
        >
          <span style={label}>Business tier</span>
          <p
            style={{
              margin: 0,
              color: "var(--ink)",
              fontWeight: 600,
              fontSize: "1rem",
              textTransform: "capitalize",
            }}
          >
            {tierRow ? tierRow.tier : "—"}
          </p>
          <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.85rem" }}>
            {tierRow ? TIER_REASON[tierRow.tier] : "Not worked out yet."}
          </p>
          <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.85rem" }}>
            {tierRow
              ? SOURCE_WORDS[tierRow.tierSource]
              : "Fill in the facts above and I'll work it out."}
          </p>
          <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.85rem" }}>
            This follows the facts — there is no setting for it. Change the numbers above and it
            moves with them.
          </p>
        </div>

        {/* Agent identity (D4, design §7) */}
        <div
          style={{
            display: "grid",
            gap: "0.75rem",
            paddingTop: "0.5rem",
            borderTop: "1px solid var(--rule)",
          }}
        >
          <span style={label}>Your agent</span>
          <LabeledField label="What should I go by?">
            <input
              style={field}
              value={agentName}
              maxLength={40}
              placeholder="Atlas"
              onChange={(e) => setAgentName(e.target.value)}
            />
          </LabeledField>
          <PresetGroup value={behaviorPreset} onChange={setBehaviorPreset} />
        </div>

        {factGaps && factGaps.length > 0 && (
          <p role="alert" style={{ color: "var(--held-text)", fontSize: "0.85rem", margin: 0 }}>
            I still need {factGaps.map((s) => SLOT_LABEL[s]).join(", ")} before I can work out your
            tier. Fill those in and save again.
          </p>
        )}
        {factsError && (
          <p role="alert" style={{ color: "#dc2626", fontSize: "0.85rem", margin: 0 }}>
            {factsError}
          </p>
        )}
        {tierMove && (
          <p
            role="status"
            aria-live="polite"
            style={{ color: "var(--released)", fontWeight: 600, fontSize: "0.9rem", margin: 0 }}
          >
            {tierMove.from
              ? `You've moved from ${TIER_NAME[tierMove.from]} to ${TIER_NAME[tierMove.to]} — I'll adjust how I work with you.`
              : `I've got you as ${TIER_NAME[tierMove.to]} — that shapes how I'll work with you.`}
          </p>
        )}

        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            disabled={savingFacts}
            onClick={() => void onSaveFacts()}
            style={primaryButton(savingFacts)}
          >
            {savingFacts ? "Saving…" : "Save business shape"}
          </button>
          {factsSaved && !savingFacts && !tierMove && !factGaps && !factsError && (
            <span
              role="status"
              aria-live="polite"
              style={{ color: "var(--released)", fontWeight: 600, fontSize: "0.9rem" }}
            >
              Saved.
            </span>
          )}
        </div>
      </div>

      {/* ── The narrative profile (Lean core) — re-embedded on save so grounding stays current ── */}
      <div style={card}>
        <span style={label}>What the business is</span>

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

      <BlueprintPanel />
    </div>
  );
}

/**
 * The ONE place a choice set is correct on this page.
 *
 * These are NOT the persona pills returning. A behaviour preset is a genuine user PREFERENCE — how
 * the user wants to be spoken to — and `BEHAVIOR_PRESETS` is a closed enum mapping to a versioned
 * style directive in the skill registry (design §7, §5). The TIER is the opposite: a derived fact
 * about the business that no control may set (design §9, D2), which is why it is rendered as text a
 * few lines above and not as a group like this one.
 *
 * A real `fieldset`/`legend` + `input[type=radio]` group, not `role="radio"` buttons: the native
 * element carries the checked state, the group semantics AND arrow-key navigation for free.
 */
function PresetGroup({
  value,
  onChange,
}: {
  value: BehaviorPreset | "";
  onChange: (p: BehaviorPreset) => void;
}) {
  return (
    <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: "0.4rem" }}>
      <legend style={{ ...label, padding: 0 }}>How should I talk to you?</legend>
      {BEHAVIOR_PRESETS.map((p) => {
        const selected = value === p;
        return (
          <label
            key={p}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "0.6rem",
              alignItems: "start",
              padding: "0.7rem 0.9rem",
              borderRadius: "0.9rem",
              border: `1px solid ${selected ? "var(--teal-600)" : "var(--rule)"}`,
              background: selected
                ? "color-mix(in srgb, var(--teal-400) 12%, transparent)"
                : "var(--card)",
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="behaviorPreset"
              value={p}
              checked={selected}
              onChange={() => onChange(p)}
              style={{ marginTop: "0.2rem", accentColor: "var(--teal-600)" }}
            />
            <span style={{ display: "grid", gap: "0.2rem" }}>
              <span style={{ fontWeight: 700, color: "var(--ink)", fontSize: "0.9rem" }}>
                {PRESET_TITLE[p]}
              </span>
              <span style={{ color: "var(--ink-soft)", fontSize: "0.82rem" }}>
                {PRESET_COPY[p]}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
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
