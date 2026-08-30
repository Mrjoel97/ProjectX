"use client";

import { api } from "@pikar/backend/api";
import {
  type CustomizationField,
  type CustomizationRejection,
  type CustomizationSchema,
  type CustomizationValues,
  classifyCustomizationChange,
  PACK_SOURCE_LABEL,
  packCustomizationFields,
  resolveWorkflowPack,
  WORKFLOW_PACKS,
} from "@pikar/core";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { type CSSProperties, useId, useMemo, useState } from "react";
import { adaptationBytes } from "../workspace/SkillAuthoringPanel";
import { WorkflowPackPreflight } from "../workspace/WorkflowPackPreflight";

// ROUT-01: the tenant's ONE surface for adapting an approved workflow pack.
//
// EVERY CONTROL IS GENERATED FROM THE CLOSED SCHEMA. `packCustomizationFields` (@pikar/core) owns
// which fields exist per pack, their kinds, their option lists and their caps; this file renders
// them and sends the values back. There is no hand-written control, which is why there is no field
// here that carries a tool name, a URL, a secret, an MCP block or an assembled prompt body — not
// because a check rejects one, but because no such field is declared and the server's arg validator
// (`values: v.record(string, string|number|string[])`) has no shape for one to arrive in.
//
// TWO COMPONENTS, AND THE SPLIT IS THE TEST STORY. `WorkflowPackCustomizer` holds the hooks and the
// handlers; `CustomizerView` holds ALL of the JSX and every user-facing sentence, and takes its
// whole state as props. `WorkflowPackCustomizer.test.ts` RENDERS the view (react-dom/server) at each
// state and asserts the text a user would read. The previous revision exported its copy as pure
// functions and asserted those instead — a verifier stripped six of them out of the JSX at once and
// all 59 tests stayed green.
//
// THE CONTAINER IS DRIVEN AS AN INTERACTION, in `WorkflowPackCustomizer.container.test.ts`: jsdom,
// a real `createRoot`, real click and input events, `convex/react` stubbed. It exists because four
// mutations that made this route inert (`onChoose`, `onSet`, `onSubmit` cut to no-ops, and
// `setBaseline(values)` deleted from the success arm) left the SSR suite at 109/109 green.
//
// THE HONEST PART, AND IT IS THE HARD PART. A saved customization is a `tenantSkills` CANDIDATE:
//
//   - `planTenantActivation` (convex/skills.ts) throws `PACK_GATE` for every name in
//     `WORKFLOW_PACK_SKILL_NAMES`, ahead of its mode switch — so in this release there is no
//     activation path for one, with or without evidence.
//   - `cockpit.ts` is the only production caller of `runWorkflowPack` and it does not pass
//     `tenantSkillIds`, so no workflow a user starts reads what they saved here. That is an
//     absolute about ANOTHER module, so it is pinned by a test that reads that module:
//     "the sentence this route renders about cockpit.ts is still true of cockpit.ts".
//
// Copy that said "pending approval" or "awaiting review" would describe a queue that does not
// exist. `ACTIVATION_NOTE` says the true thing instead, once, at the top of the form.
//
// NO ACTIVATION OR ROLLBACK CONTROL, and none is possible from here: `activateTenantCandidate` and
// `rollbackTenantSkill` are `ownerMutation`s. A disabled button implying "not yet" would be the
// same lie in a different shape, so there is no button.
//
// BRAND: tokens only (`--card`, `--rule`, `--ink`, `--ink-soft`), the tracked-caps section label
// (§3), cards on canvas (§4), status carried in WORDS not colour (§6). Amber (`--held`) is the
// approval gate's alone and appears nowhere here.

type PackListing = FunctionReturnType<typeof api.workflowPackDiscovery.listPacks>[number];
type SavedRow = FunctionReturnType<typeof api.skills.myUserSkills>[number];
/** The mutation's OWN result type. A new refusal reason on the server makes `refusalMessage`'s
 *  switch non-exhaustive and `pnpm typecheck` fails — which is the point of not hand-writing it. */
type PublishResult = FunctionReturnType<typeof api.skills.publishPackCustomization>;
type PublishRefusal = Extract<PublishResult, { ok: false }>;
type PublishSuccess = Extract<PublishResult, { ok: true }>;

/** What the last save attempt did. One prop instead of three booleans that can contradict. */
export type PublishOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "saved"; readonly saved: PublishSuccess }
  | { readonly kind: "refused"; readonly refusal: PublishRefusal }
  /** A throw, not a refusal: every refusal this channel produces comes back as DATA. */
  | { readonly kind: "transport" };

// ── The copy. Deliberately module-private: it is proved by rendering the view, not by calling it. ──

/**
 * WHAT SAVING ACTUALLY DOES, stated once at the top of the form.
 *
 * REWRITTEN 2026-08-30, and the previous sentence is worth keeping in view because it was TRUE when
 * written: "Pikar cannot make a workflow customization live in this release. Saving one records
 * your settings; no workflow you start uses them yet." `runWorkflowPack` now reads the tenant's
 * saved VALUES and renders them into the run through the approved template's own schema, so that
 * sentence became a lie the moment the backend landed — which is why it is replaced in the same
 * change rather than left for a later sweep.
 *
 * WHAT IS STILL TRUE AND STILL SAID: the settings shape WORDING, not authority. The composed
 * `tenantSkills` body is still never activated (`planTenantActivation` refuses every `pack-*` with
 * `PACK_GATE`), the tool grant is still `toolsForWorkflowPack(packId)` derived from the operation
 * matrix, and no string a tenant types can widen either. The second sentence is that promise, and
 * `WorkflowPackCustomizer.test.ts` cites the code that keeps it.
 */
const ACTIVATION_NOTE =
  "Your saved settings are applied when you run this workflow: they shape its wording, tone and how much it reports. They never change which of your sources it can read, or what it may save or send.";

const TRANSPORT_ERROR = "That could not be saved. Check your connection and try again.";

/** Confirmation of a landed save. It names the VERSION, because that is the thing the next save is
 *  checked against and the thing `draftStateLine` will report on reload — a bare "Saved" would leave
 *  a `stale_base_version` refusal looking like it came from nowhere. It does NOT repeat
 *  `ACTIVATION_NOTE`'s "no workflow uses them yet": that sentence is already on screen, above the
 *  form, and saying it twice on success reads as a warning about the save rather than about the
 *  release. */
const SAVED_CONFIRMATION = (version: number) => `Saved. Your settings are version ${version}.`;

/** The approved template's own name. An unknown id is NAMED as unknown, never echoed as a title. */
function packTitle(packId: string): string {
  const resolved = resolveWorkflowPack(packId);
  return resolved.ok ? WORKFLOW_PACKS[resolved.packId].title : "Unknown workflow";
}

/**
 * What one saved row IS. Four statuses the `tenantSkills` row can carry, plus an honest fallback:
 * describing an unrecognised status as a draft is how a UI quietly reports the wrong state.
 */
function draftStateLine(row: { version: number; status: string }): string {
  switch (row.status) {
    case "candidate":
      return `Version ${row.version} is saved as a draft.`;
    case "active":
      return `Version ${row.version} is the active one.`;
    case "rolled_back":
      return `Version ${row.version} was rolled back.`;
    case "archived":
      return `Version ${row.version} was replaced by a newer one.`;
    default:
      return `Version ${row.version} is in an unrecognised state.`;
  }
}

/**
 * The eval half of a saved row's state, from the row's OWN `gatePassed` boolean rather than from an
 * assumption about what a pack row can carry. `myUserSkills` computes it with
 * `hasPassingTenantEvidence`, which fails closed on an absent or mismatched pin.
 */
function evaluationLine(row: { gatePassed: boolean }): string {
  return row.gatePassed
    ? "An evaluation has certified this version."
    : "No evaluation has certified this version.";
}

/** Which approved template this edit derives from, and which of the tenant's drafts it builds on. */
function lineageLine(
  packId: string,
  templateVersion: number,
  baseCandidateVersion: number | null,
): string {
  // "This edit is based on" rather than "your latest saved version is": the number is the one the
  // form OPENED from, frozen with the settings it prefilled. After a `stale_base_version` refusal
  // the server holds a newer one, and a sentence claiming this is the latest would be false in
  // exactly the state the refusal exists to report. The refusal names the newer version itself.
  const base =
    baseCandidateVersion === null
      ? "You have not customized this workflow before."
      : `This edit is based on your saved version ${baseCandidateVersion}.`;
  return `Based on the approved ${packTitle(packId)} template, version ${templateVersion}. ${base}`;
}

/**
 * THE REPLACEMENT WARNING, and it is not decoration.
 *
 * `renderCustomization` emits a section only for the keys present in the submitted map, and
 * `readTenantPublishState` composes that onto the GLOBAL pack body — never onto the tenant's own
 * previous `authoredBody`. So a save carries exactly what is on the form and nothing else. The form
 * therefore REOPENS with the settings the last save stored (`myCustomizationValues`), and says so.
 */
function prefillLine(baseCandidateVersion: number): string {
  return `These are the settings you saved in version ${baseCandidateVersion}. Saving replaces all of them with what is on this form.`;
}

/**
 * The before/after semantic diff, from the REAL classifier rather than a second comparison here.
 * The baseline is what the form OPENED with — the last saved settings, or the empty set on a first
 * customization, which is what absence means to the renderer ("use the template's default").
 * `material` is the classifier's own word for "this changes what the workflow does".
 */
function changeSummary(
  schema: CustomizationSchema,
  baseline: CustomizationValues,
  values: CustomizationValues,
): string {
  const diff = classifyCustomizationChange(schema, baseline, values);
  if (diff.changed.length === 0) return "You have not changed anything yet.";
  const labels = schema.fields
    .filter((f) => diff.changed.includes(f.key))
    .map((f) => f.label)
    .join(", ");
  const kind = diff.material
    ? "This changes what the workflow does."
    : "This changes how the result reads, not what the workflow does.";
  return `You changed ${diff.changed.length} of ${schema.fields.length} settings: ${labels}. ${kind}`;
}

/**
 * The server's own `customizationHash`, shortened and labelled as an id.
 *
 * ponytail: shortened, not recomputed. @pikar/core returns the canonical STRING and `lib/hash.ts`
 * hashes it server-side — hashing again in the browser would be a second implementation of an
 * identity two planes already agree on. Ceiling: the user cannot verify the full digest from this
 * screen; upgrade path is showing the whole 64 characters if a support flow ever needs it.
 */
function changeIdLine(customizationHash: string): string {
  return `Change id ${customizationHash.slice(0, 12)}.`;
}

/** Every refusal `publishPackCustomization` can return, as an instruction the user can act on. */
function refusalMessage(res: PublishRefusal): string {
  switch (res.reason) {
    case "unknown_template":
      return "That workflow is not one Pikar offers.";
    case "template_not_active":
      return "That workflow is not switched on for your account yet, so it cannot be customized.";
    case "stale_template_version":
      return `Pikar updated this workflow while you were editing. Reload the page and make your changes against version ${res.approvedVersion}.`;
    case "stale_base_version":
      // The server returns the version it actually holds, and the handler adopts it, so the retry
      // this sentence asks for is one the client can now win. Before 29-07's fix the base version
      // came from a truncated list and "reload" reproduced the same wrong value forever.
      return res.currentBaseVersion === null
        ? "Another draft of this workflow changed while you were editing. Pikar has caught up — press save again."
        : `A newer draft of this workflow was saved (version ${res.currentBaseVersion}). Pikar has caught up — press save again.`;
    case "empty_customization":
      return "Change at least one setting before saving.";
    case "invalid_values":
      return "Some settings could not be saved. See the notes on each one.";
  }
}

/** Every rejection the pure validator can attach to one field, in words rather than as an enum. */
function fieldErrorMessage(reason: CustomizationRejection): string {
  switch (reason) {
    case "too_many_fields":
      return "This form sent more settings than Pikar accepts. Reload the page.";
    case "unknown_field":
      return "Pikar does not have this setting any more. Reload the page.";
    case "wrong_type":
      return "This is not the kind of value this setting takes.";
    case "too_large":
      return "That is longer than this setting allows.";
    case "out_of_range":
      return "That number is outside the range this setting allows.";
    case "unknown_option":
      return "That is not one of the choices offered.";
    case "unknown_source":
      return "That is not one of the sources this workflow reads.";
    case "too_many_values":
      return "You selected more sources than this setting allows.";
    case "forbidden_content":
      return "Remove any link, code or key from this text.";
  }
}

/**
 * The live hint under a control: the cap or the range, so the refusal is never the first news.
 *
 * THE UNIT IS BYTES AND THE WORD IS "bytes". It used to say "characters" while counting bytes, over
 * a control capped with `maxLength` — which counts UTF-16 code units. 400 CJK characters passed the
 * control and read "1200 of 400 characters used", a reading the control itself permitted. The
 * wrong-unit cap is gone; the counter says what the server counts (`adaptationBytes`, the same
 * function `SkillAuthoringPanel` uses against the same `USER_SKILL_ADAPTATION_MAX_BYTES` family).
 */
function fieldHint(
  field: CustomizationField,
  value: string | number | readonly string[] | undefined,
): string {
  switch (field.kind) {
    case "terminology":
    case "instruction": {
      const used = adaptationBytes(typeof value === "string" ? value : "");
      return used > field.maxBytes
        ? `${used} of ${field.maxBytes} bytes used. Shorten this before saving.`
        : `${used} of ${field.maxBytes} bytes used.`;
    }
    case "threshold":
      return `A whole number between ${field.min} and ${field.max}.`;
    case "tone":
      return "Leave this alone to keep the workflow's usual tone.";
    case "source_preference":
      return "Leave every box clear to let the workflow use all of them.";
  }
}

// ── The surface ────────────────────────────────────────────────────────────────────────────

const card: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: "1rem",
  padding: "1.25rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
};
const dim: CSSProperties = { margin: 0, fontSize: "0.85rem", color: "var(--ink-soft)" };
const control: CSSProperties = {
  padding: "0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--rule)",
  background: "var(--card)",
  color: "var(--ink)",
  fontFamily: "inherit",
  fontSize: "0.9rem",
};

export type CustomizerViewProps = {
  /** Stable id root. The container passes `useId()`; a test passes a literal so the label/describe
   *  wiring can be asserted on the RENDERED node rather than scanned for as a bare attribute name. */
  idPrefix: string;
  packs: readonly PackListing[] | undefined;
  mine: readonly SavedRow[] | undefined;
  selectedPackId: string | null;
  /** What the form opened with — the last saved settings, or `{}` on a first customization. */
  baseline: CustomizationValues;
  /**
   * The saved version `baseline` CAME FROM, frozen by the container when the form opened, not read
   * live off the pack row. The two travel together or the surface names a version whose settings
   * are not on the form; `null` = never customized. Every sentence on this surface that carries a
   * saved-version number reads this prop.
   */
  baseVersion: number | null;
  values: CustomizationValues;
  busy: boolean;
  outcome: PublishOutcome;
  fieldErrors: Readonly<Record<string, CustomizationRejection>>;
  onChoose: (packId: string) => void;
  onSet: (key: string, value: string | number | readonly string[]) => void;
  onClear: (key: string) => void;
  onSubmit: () => void;
};

export function CustomizerView(props: CustomizerViewProps) {
  const {
    idPrefix,
    packs,
    mine,
    selectedPackId,
    baseline,
    baseVersion,
    values,
    busy,
    outcome,
    fieldErrors,
    onChoose,
    onSet,
    onClear,
    onSubmit,
  } = props;

  const selected = packs?.find((p) => p.packId === selectedPackId) ?? null;
  const resolved = selected === null ? null : resolveWorkflowPack(selected.packId);
  const schema: CustomizationSchema | null =
    selected === null || resolved === null || !resolved.ok
      ? null
      : {
          templateId: resolved.packId,
          templateVersion: selected.version,
          fields: packCustomizationFields(resolved.packId),
        };

  // The tenant's own rows for THIS pack, from the RECENT window `myUserSkills` returns.
  // `selected.myBaseVersion` is the server's exact per-name answer and is what the lineage and the
  // save use; this list is presentation only, and says so when the two disagree.
  const myRows =
    selected === null
      ? []
      : (mine ?? [])
          .filter((r) => r.name === `pack-${selected.packId}`)
          .sort((a, b) => b.version - a.version);

  return (
    <section style={{ display: "grid", gap: "1rem" }} aria-label="Customize a workflow">
      <p style={{ ...dim, fontSize: "0.9rem" }}>{ACTIVATION_NOTE}</p>

      <div style={card}>
        <p className="caps-label" style={{ margin: 0 }}>
          Choose a workflow
        </p>
        {packs === undefined ? (
          <p style={dim}>Loading your workflows…</p>
        ) : packs.length === 0 ? (
          <p style={dim}>
            No workflows are switched on for your account yet, so there is nothing to customize.
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.5rem" }}>
            {packs.map((p) => (
              <li key={p.packId}>
                <button
                  type="button"
                  onClick={() => onChoose(p.packId)}
                  aria-pressed={p.packId === selectedPackId}
                  style={{
                    ...control,
                    width: "100%",
                    textAlign: "left",
                    cursor: "pointer",
                    borderColor: p.packId === selectedPackId ? "var(--ink)" : "var(--rule)",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{p.title}</span>
                  <span style={{ display: "block", color: "var(--ink-soft)", fontSize: "0.8rem" }}>
                    {p.blurb}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected !== null && schema !== null && (
        <div style={card}>
          <p className="caps-label" style={{ margin: 0 }}>
            {selected.title}
          </p>
          <p style={dim}>{lineageLine(selected.packId, selected.version, baseVersion)}</p>
          {Object.keys(baseline).length > 0 && baseVersion !== null && (
            <p style={dim}>{prefillLine(baseVersion)}</p>
          )}

          <div>
            <p className="caps-label" style={{ margin: "0 0 0.35rem" }}>
              What this workflow can read
            </p>
            {/* Reused, not re-rendered: the same component the cockpit's quick starts use, fed the
                server's own rows with no cast in between, so a new `SourceState` breaks this route
                at compile time exactly as it breaks the workspace. */}
            <WorkflowPackPreflight sources={selected.sources} />
          </div>

          {/* THE SAVE HAD NO VISIBLE OUTCOME AT ALL UNTIL 2026-08-30, and the state to render it
              already existed — `setOutcome({kind:"saved"})` was set and nothing read it. Success and
              still-in-flight were indistinguishable in the DOM: no toast, no `role="status"`, no
              `role="alert"`. Found by the 29-10 browser gate, and it is worse than cosmetic —
              navigating straight after pressing Save ABORTS the in-flight mutation, so a user who
              clicks and leaves loses the write with no signal that anything was pending. A test can
              wait and retry the read; a person cannot.
              `role="status"` (polite), not `role="alert"`: a success is not an interruption. */}
          {outcome.kind === "saved" && (
            <p role="status" style={{ ...dim, color: "var(--ink)", fontWeight: 600 }}>
              {SAVED_CONFIRMATION(outcome.saved.version)}
            </p>
          )}
          {outcome.kind === "refused" && (
            <p role="alert" style={{ ...dim, color: "var(--ink)", fontWeight: 600 }}>
              {refusalMessage(outcome.refusal)}
            </p>
          )}
          {outcome.kind === "transport" && (
            <p role="alert" style={{ ...dim, color: "var(--ink)", fontWeight: 600 }}>
              {TRANSPORT_ERROR}
            </p>
          )}

          {schema.fields.map((field) => {
            const fieldId = `${idPrefix}-${field.key}`;
            const noteId = `${fieldId}-note`;
            const error = fieldErrors[field.key];
            const note = error === undefined ? null : fieldErrorMessage(error);
            return (
              <div key={field.key} style={{ display: "grid", gap: "0.3rem" }}>
                {field.kind === "source_preference" ? (
                  <fieldset
                    style={{ border: "none", margin: 0, padding: 0 }}
                    aria-describedby={noteId}
                    aria-invalid={error !== undefined}
                  >
                    <legend style={{ fontSize: "0.8rem", fontWeight: 600, padding: 0 }}>
                      {field.label}
                    </legend>
                    {field.sources.map((source) => {
                      const chosen = (values[field.key] as readonly string[] | undefined) ?? [];
                      return (
                        <label
                          key={source}
                          htmlFor={`${fieldId}-${source}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.4rem",
                            fontSize: "0.85rem",
                          }}
                        >
                          <input
                            id={`${fieldId}-${source}`}
                            type="checkbox"
                            checked={chosen.includes(source)}
                            disabled={busy}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...chosen, source]
                                : chosen.filter((s) => s !== source);
                              if (next.length === 0) onClear(field.key);
                              else onSet(field.key, next);
                            }}
                          />
                          {PACK_SOURCE_LABEL[source]}
                        </label>
                      );
                    })}
                  </fieldset>
                ) : (
                  <>
                    <label htmlFor={fieldId} style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                      {field.label}
                    </label>
                    {renderControl({
                      field,
                      id: fieldId,
                      noteId,
                      invalid: error !== undefined,
                      busy,
                      value: values[field.key],
                      onChange: (v) => (v === null ? onClear(field.key) : onSet(field.key, v)),
                    })}
                  </>
                )}
                <p id={noteId} style={dim} role={note === null ? undefined : "alert"}>
                  {note ?? fieldHint(field, values[field.key])}
                </p>
              </div>
            );
          })}

          <p style={{ ...dim, color: "var(--ink)" }} aria-live="polite">
            {changeSummary(schema, baseline, values)}
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="cta-dark"
              style={{
                margin: 0,
                padding: "0.55rem 1rem",
                fontSize: "0.85rem",
                border: "none",
                fontFamily: "inherit",
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.5 : 1,
              }}
              disabled={busy}
              onClick={onSubmit}
            >
              {busy ? "Saving…" : "Save these settings"}
            </button>
            <p style={dim} aria-live="polite">
              {outcome.kind === "saved"
                ? `${draftStateLine(outcome.saved)} ${changeIdLine(outcome.saved.customizationHash)}`
                : ""}
            </p>
          </div>

          <div>
            <p className="caps-label" style={{ margin: "0.4rem 0 0.3rem" }}>
              What you have saved for this workflow
            </p>
            {mine === undefined ? (
              <p style={dim}>Loading…</p>
            ) : myRows.length === 0 ? (
              <p style={dim}>
                {baseVersion === null
                  ? "You have not customized this workflow yet."
                  : // `myUserSkills` returns the tenant's 50 most recent rows across every skill
                    // name, so a busy account's pack row can be outside it while the server still
                    // holds one. Saying "nothing saved" here would contradict the lineage line
                    // above it.
                    `Version ${baseVersion} is saved for this workflow, but it is outside the recent list this page shows.`}
              </p>
            ) : (
              <ul
                style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.5rem" }}
              >
                {myRows.map((r) => (
                  <li
                    key={r.version}
                    style={{ borderTop: "1px solid var(--rule)", paddingTop: "0.5rem" }}
                  >
                    <p style={{ margin: 0, fontSize: "0.85rem", fontWeight: 600 }}>
                      {draftStateLine(r)}
                    </p>
                    <p style={dim}>{evaluationLine(r)}</p>
                    {/* The tenant's OWN rendered settings, which is what `authoredBody` holds for a
                        pack row. The base and composed bodies are an owner-only boundary and
                        `myUserSkills` does not return them. */}
                    <p
                      style={{ margin: "0.25rem 0 0", fontSize: "0.85rem", whiteSpace: "pre-wrap" }}
                    >
                      {r.authoredBody}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The settings a previous save stored, narrowed to what this schema still declares.
 *
 * `myCustomizationValues` is the tenant's own row, but it was written against a possibly OLDER
 * template: a key the schema has since dropped would be sent straight back and refused as
 * `unknown_field`, and a value whose kind changed would be refused as `wrong_type`. Narrowing here
 * means a template revision drops the stale settings instead of jamming the form.
 *
 * EXPORTED, unlike every copy function in this file, and the difference is deliberate: this is not
 * a sentence, it is a PARSER at a trust boundary. Its input is a JSON string off a database row
 * written by an older build, so what it does with a wrong shape is behaviour worth pinning
 * directly. Its call site is scanned separately.
 */
export function prefillFrom(
  json: string | null,
  schema: CustomizationSchema | null,
): CustomizationValues {
  if (json === null || schema === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  // NO `Array.isArray` guard. Deleting it changed nothing that any test could see, because the
  // loop below is over the SCHEMA's keys and no declared key is an array index — so an array falls
  // through to `{}` on its own. A branch whose removal is invisible is a claim with nothing behind
  // it; the schema-driven loop is the actual bound.
  if (typeof parsed !== "object" || parsed === null) return {};
  const raw = parsed as Record<string, unknown>;
  const out: Record<string, string | number | readonly string[]> = {};
  for (const field of schema.fields) {
    if (!Object.hasOwn(raw, field.key)) continue;
    const v = raw[field.key];
    if (field.kind === "threshold") {
      if (typeof v === "number") out[field.key] = v;
    } else if (field.kind === "source_preference") {
      if (Array.isArray(v) && v.every((s) => typeof s === "string")) out[field.key] = v as string[];
    } else if (typeof v === "string") {
      out[field.key] = v;
    }
  }
  return out;
}

export function WorkflowPackCustomizer() {
  const packs = useQuery(api.workflowPackDiscovery.listPacks);
  const mine = useQuery(api.skills.myUserSkills);
  const publish = useMutation(api.skills.publishPackCustomization);

  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [values, setValues] = useState<CustomizationValues>({});
  const [baseline, setBaseline] = useState<CustomizationValues>({});
  /**
   * The saved version `baseline` came from, SNAPSHOTTED when the form opened.
   *
   * It used to be read live off `selected.myBaseVersion` at save time while the form contents were
   * frozen at open time, so a concurrent publish moved the token without moving the data it
   * describes: the save then carried the other draft's version, the server accepted it, and
   * `stale_base_version` — the refusal that exists for exactly this race — could not fire. The
   * token and the contents it describes now move together.
   */
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  /** Adopted from a `stale_base_version` refusal so the retry can win. `undefined` = send the
   *  snapshotted `baseVersion`. */
  const [adoptedBase, setAdoptedBase] = useState<number | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<PublishOutcome>({ kind: "none" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, CustomizationRejection>>({});
  const idPrefix = useId();

  const selected = packs?.find((p) => p.packId === selectedPackId) ?? null;

  const schema: CustomizationSchema | null = useMemo(() => {
    if (selected === null) return null;
    const resolved = resolveWorkflowPack(selected.packId);
    if (!resolved.ok) return null;
    return {
      templateId: resolved.packId,
      templateVersion: selected.version,
      fields: packCustomizationFields(resolved.packId),
    };
  }, [selected]);

  const choose = (id: string) => {
    const pack = packs?.find((p) => p.packId === id) ?? null;
    const resolved = pack === null ? null : resolveWorkflowPack(pack.packId);
    const packSchema: CustomizationSchema | null =
      pack === null || resolved === null || !resolved.ok
        ? null
        : {
            templateId: resolved.packId,
            templateVersion: pack.version,
            fields: packCustomizationFields(resolved.packId),
          };
    // REOPEN WITH WHAT WAS SAVED. A blank form plus a save that carries only the re-typed fields
    // silently discarded everything else; `prefillLine` states the replacement, and this is what
    // makes the statement survivable.
    const prior = prefillFrom(pack?.myCustomizationValues ?? null, packSchema);
    setSelectedPackId(id);
    setBaseline(prior);
    setBaseVersion(pack?.myBaseVersion ?? null);
    setValues(prior);
    setAdoptedBase(undefined);
    setOutcome({ kind: "none" });
    setFieldErrors({});
  };

  const setValue = (key: string, value: string | number | readonly string[]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      const { [key]: _drop, ...rest } = prev;
      return rest;
    });
  };

  const clearValue = (key: string) =>
    setValues((prev) => {
      const { [key]: _drop, ...rest } = prev;
      return rest;
    });

  const submit = async () => {
    if (selected === null || schema === null) return;
    setBusy(true);
    setOutcome({ kind: "none" });
    setFieldErrors({});
    try {
      const res = await publish({
        templateId: selected.packId,
        templateVersion: selected.version,
        baseCandidateVersion: adoptedBase === undefined ? baseVersion : adoptedBase,
        values: values as Record<string, string | number | string[]>,
      });
      if (res.ok) {
        setOutcome({ kind: "saved", saved: res });
        // The row this edit is now based on, and the settings that row holds. Both move, together:
        // without the version a second save from the same open form sends the version it started
        // with and is refused, and without the baseline the change summary keeps reporting a diff
        // against settings that are no longer what is saved.
        setBaseVersion(res.version);
        setAdoptedBase(undefined);
        setBaseline(values);
        return;
      }
      setOutcome({ kind: "refused", refusal: res });
      if (res.reason === "stale_base_version") setAdoptedBase(res.currentBaseVersion);
      if (res.reason === "invalid_values") {
        const next: Record<string, CustomizationRejection> = {};
        for (const e of res.errors) if (e.key !== "") next[e.key] = e.reason;
        setFieldErrors(next);
      }
    } catch {
      // The user's own words never reach an error string or a log (CLAUDE.md §4). Every refusal
      // this channel produces comes back as DATA above; a throw here is a transport failure.
      setOutcome({ kind: "transport" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <CustomizerView
      idPrefix={idPrefix}
      packs={packs}
      mine={mine}
      selectedPackId={selectedPackId}
      baseline={baseline}
      baseVersion={baseVersion}
      values={values}
      busy={busy}
      outcome={outcome}
      fieldErrors={fieldErrors}
      onChoose={choose}
      onSet={setValue}
      onClear={clearValue}
      onSubmit={() => void submit()}
    />
  );
}

/**
 * One control per declared field kind, and NOTHING else. The `instruction` arm is the only free
 * prose on this surface and it is bounded by the schema's own `maxBytes`; there is no control here
 * for an assembled body, a tool, an address or a credential because no such field is declared.
 */
function renderControl(props: {
  /** Everything EXCEPT `source_preference`, which the caller renders as a real fieldset. Stated as
   *  a type rather than as a comment, so the fallback arm below cannot silently receive one. */
  field: Exclude<CustomizationField, { kind: "source_preference" }>;
  id: string;
  noteId: string;
  invalid: boolean;
  busy: boolean;
  value: string | number | readonly string[] | undefined;
  onChange: (v: string | number | null) => void;
}) {
  const { field, id, noteId, invalid, busy, value, onChange } = props;
  const shared = {
    id,
    disabled: busy,
    "aria-describedby": noteId,
    "aria-invalid": invalid,
    style: { ...control, borderColor: invalid ? "var(--ink)" : "var(--rule)" },
  };

  if (field.kind === "tone") {
    return (
      <select
        {...shared}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      >
        <option value="">Leave as it is</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (field.kind === "threshold") {
    return (
      <input
        {...shared}
        type="number"
        min={field.min}
        max={field.max}
        step={field.integer ? 1 : "any"}
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    );
  }

  // NO `maxLength`. The schema's cap is in BYTES and `maxLength` counts UTF-16 code units, so it
  // permitted 3x the cap in CJK while the counter beside it read past the limit. The byte counter
  // in `fieldHint` is the ceiling the user is shown, and the server's `too_large` is the one that
  // enforces it.
  if (field.kind === "instruction") {
    return (
      <textarea
        {...shared}
        rows={4}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        style={{ ...shared.style, resize: "vertical" }}
      />
    );
  }

  return (
    <input
      {...shared}
      type="text"
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
    />
  );
}
