"use client";

import { api } from "@pikar/backend/api";
import {
  BEHAVIOR_PRESETS,
  type BehaviorPreset,
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
import { card, field, label, primaryButton } from "./styles";

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
export const SLOT_LABEL = {
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
export function readMissing(err: unknown): SlotName[] | null {
  if (!(err instanceof ConvexError)) return null;
  const data = err.data as { code?: unknown; missing?: unknown } | undefined;
  if (!data || !Array.isArray(data.missing)) return null;
  if (data.code !== "INCOMPLETE_FACTS" && data.code !== "INCOMPLETE_ONBOARDING") return null;
  return data.missing as SlotName[];
}

export function ShapePanel({ oneLineDescription }: { oneLineDescription: string }) {
  const tierRow = useQuery(api.tenantProfile.get);
  const saveFacts = useMutation(api.tenantProfile.saveFacts);

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
        oneLineDescription: oneLineDescription || "—",
      })
    : [];
  // Design §10: an INVITATION, never a gate. No modal, no redirect, no blocked route.
  const invite = !tierRow || tierRow.tierSource === "legacy" || rowGaps.length > 0;

  return (
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

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(17rem, 1fr))",
            gap: "1rem",
          }}
        >
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
        </div>

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

export function LabeledField({
  label: text,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    // The control IS the `children` this wraps: the implicit-association pattern
    // (<label><input/></label>), valid and accessible. The rule cannot see through a ReactNode
    // prop, and every call site passes exactly one form control.
    // biome-ignore lint/a11y/noLabelWithoutControl: implicit association via children
    <label style={{ display: "grid", gap: "0.35rem" }}>
      <span style={label}>{text}</span>
      {children}
    </label>
  );
}
