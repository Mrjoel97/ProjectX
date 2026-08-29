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
  type WorkflowPackId,
} from "@pikar/core";
import { useMutation, useQuery } from "convex/react";
import { useId, useMemo, useState } from "react";
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
// THE HONEST PART, AND IT IS THE HARD PART. A saved customization is a `tenantSkills` CANDIDATE:
//
//   - `planTenantActivation` (convex/skills.ts) throws `PACK_GATE` for every name in
//     `WORKFLOW_PACK_SKILL_NAMES`, ahead of its mode switch — so in this release there is no
//     activation path for one, with or without evidence.
//   - `cockpit.ts` is the only production caller of `runWorkflowPack` and it passes `skillVersions`
//     (a global, owner-only preview pin) and never `tenantSkillIds` — so no workflow a user starts
//     reads what they saved here.
//
// Copy that said "pending approval" or "awaiting review" would describe a queue that does not
// exist. `ACTIVATION_NOTE` says the true thing instead, once, at the top of the form, and
// `WorkflowPackCustomizer.test.ts` fails if either phrase reappears.
//
// NO ACTIVATION OR ROLLBACK CONTROL, and none is possible from here: `activateTenantCandidate` and
// `rollbackTenantSkill` are `ownerMutation`s. A disabled button implying "not yet" would be the
// same lie in a different shape, so there is no button.
//
// BRAND: tokens only (`--card`, `--rule`, `--ink`, `--ink-soft`, `--canvas`), the tracked-caps
// section label (§3), cards on canvas (§4), status carried in WORDS not colour (§6). Amber
// (`--held`) is the approval gate's alone and appears nowhere here.

// ── The copy. Exported so it is asserted as LITERAL strings, and rendered below so the assertion
//    is about the shipped surface rather than about an unused helper. ──────────────────────────

/** The one true sentence about what saving does. Rendered once; never restated per row. */
export const ACTIVATION_NOTE =
  "Pikar cannot make a workflow customization live in this release. Saving one records your settings; no workflow you start uses them yet.";

/** The approved template's own name. An unknown id is NAMED as unknown, never echoed as a title. */
export function packTitle(packId: string): string {
  const resolved = resolveWorkflowPack(packId);
  return resolved.ok ? WORKFLOW_PACKS[resolved.packId].title : "Unknown workflow";
}

/**
 * What one saved row IS. Four statuses the `tenantSkills` row can carry, plus an honest fallback:
 * describing an unrecognised status as a draft is how a UI quietly reports the wrong state.
 */
export function draftStateLine(row: { version: number; status: string }): string {
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

/** Which approved template this edit derives from, and which of the tenant's drafts it builds on. */
export function lineageLine(
  packId: string,
  templateVersion: number,
  baseCandidateVersion: number | null,
): string {
  const base =
    baseCandidateVersion === null
      ? "You have not customized this workflow before."
      : `Your latest saved version is ${baseCandidateVersion}.`;
  return `Based on the approved ${packTitle(packId)} template, version ${templateVersion}. ${base}`;
}

/**
 * The before/after semantic diff, from the REAL classifier rather than a second comparison here.
 * The baseline is the empty set, which is what absence means to the renderer: "use the template's
 * default". `material` is the classifier's own word for "this changes what the workflow does".
 */
export function changeSummary(schema: CustomizationSchema, values: CustomizationValues): string {
  const diff = classifyCustomizationChange(schema, {}, values);
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
export function changeIdLine(customizationHash: string): string {
  return `Change id ${customizationHash.slice(0, 12)}.`;
}

/** Every refusal `publishPackCustomization` can return, as an instruction the user can act on. */
export function refusalMessage(
  res:
    | { ok: false; reason: "unknown_template" }
    | { ok: false; reason: "template_not_active" }
    | { ok: false; reason: "stale_template_version"; approvedVersion: number }
    | { ok: false; reason: "stale_base_version"; currentBaseVersion: number | null }
    | { ok: false; reason: "empty_customization" }
    | { ok: false; reason: "invalid_values"; errors: readonly unknown[] },
): string {
  switch (res.reason) {
    case "unknown_template":
      return "That workflow is not one Pikar offers.";
    case "template_not_active":
      return "That workflow is not switched on for your account yet, so it cannot be customized.";
    case "stale_template_version":
      return `Pikar updated this workflow while you were editing. Reload the page and make your changes against version ${res.approvedVersion}.`;
    case "stale_base_version":
      return res.currentBaseVersion === null
        ? "This workflow's drafts changed while you were editing. Reload the page before saving again."
        : `A newer draft of this workflow was saved (version ${res.currentBaseVersion}). Reload the page before saving again.`;
    case "empty_customization":
      return "Change at least one setting before saving.";
    case "invalid_values":
      return "Some settings could not be saved. See the notes on each one.";
  }
}

/** Every rejection the pure validator can attach to one field, in words rather than as an enum. */
export function fieldErrorMessage(reason: CustomizationRejection): string {
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

/** UTF-8 bytes of the trimmed value — exactly what the server's cap counts. */
export const valueBytes = (text: string) => new TextEncoder().encode(text.trim()).length;

// ── The surface ────────────────────────────────────────────────────────────────────────────

type PackRow = {
  packId: string;
  title: string;
  blurb: string;
  version: number;
  sources: readonly { source: string; label: string; state: string; unlock: string | null }[];
};

const card = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: "1rem",
  padding: "1.25rem",
  display: "flex",
  flexDirection: "column" as const,
  gap: "0.75rem",
};
const dim = { margin: 0, fontSize: "0.85rem", color: "var(--ink-soft)" } as const;
const control = {
  padding: "0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--rule)",
  background: "var(--card)",
  color: "var(--ink)",
  fontFamily: "inherit",
  fontSize: "0.9rem",
};

export function WorkflowPackCustomizer() {
  const packs = useQuery(api.workflowPackDiscovery.listPacks) as PackRow[] | undefined;
  const mine = useQuery(api.skills.myUserSkills);
  const publish = useMutation(api.skills.publishPackCustomization);

  const [packId, setPackId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string | number | string[]>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, CustomizationRejection>>({});
  const idPrefix = useId();

  const selected = packs?.find((p) => p.packId === packId) ?? null;

  // The tenant's own rows for THIS pack. `myUserSkills` returns their adaptations only; the base
  // and composed bodies never cross that boundary, so nothing here can render a registry prompt.
  const myRows = useMemo(
    () =>
      selected === null
        ? []
        : (mine ?? [])
            .filter((r) => r.name === `pack-${selected.packId}`)
            .sort((a, b) => b.version - a.version),
    [mine, selected],
  );
  const baseCandidateVersion = myRows[0]?.version ?? null;

  const schema: CustomizationSchema | null = useMemo(() => {
    if (selected === null) return null;
    const resolved = resolveWorkflowPack(selected.packId);
    if (!resolved.ok) return null;
    return {
      templateId: resolved.packId as WorkflowPackId,
      templateVersion: selected.version,
      fields: packCustomizationFields(resolved.packId),
    };
  }, [selected]);

  const choose = (id: string) => {
    setPackId(id);
    setValues({});
    setNotice(null);
    setFormError(null);
    setFieldErrors({});
  };

  const setValue = (key: string, value: string | number | string[]) => {
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
    setNotice(null);
    setFormError(null);
    setFieldErrors({});
    try {
      const res = await publish({
        templateId: selected.packId,
        templateVersion: selected.version,
        baseCandidateVersion,
        values,
      });
      if (res.ok) {
        setNotice(
          `${draftStateLine({ version: res.version, status: res.status })} ${changeIdLine(res.customizationHash)}`,
        );
        return;
      }
      setFormError(refusalMessage(res));
      if (res.reason === "invalid_values") {
        const next: Record<string, CustomizationRejection> = {};
        for (const e of res.errors) if (e.key !== "") next[e.key] = e.reason;
        setFieldErrors(next);
      }
    } catch {
      // The user's own words never reach an error string or a log (CLAUDE.md §4). Every refusal
      // this channel produces comes back as DATA above; a throw here is a transport failure.
      setFormError("That could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

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
                  onClick={() => choose(p.packId)}
                  aria-pressed={p.packId === packId}
                  style={{
                    ...control,
                    width: "100%",
                    textAlign: "left",
                    cursor: "pointer",
                    borderColor: p.packId === packId ? "var(--ink)" : "var(--rule)",
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
          <p style={dim}>{lineageLine(selected.packId, selected.version, baseCandidateVersion)}</p>

          <div>
            <p className="caps-label" style={{ margin: "0 0 0.35rem" }}>
              What this workflow can read
            </p>
            {/* Reused, not re-rendered: the same component the cockpit's quick starts use, fed the
                same server-resolved states, so a source can never read one way here and another
                there. */}
            <WorkflowPackPreflight
              sources={selected.sources.map((s) => ({
                source: s.source,
                label: s.label,
                state: s.state as "available" | "partial" | "unavailable",
                unlock: s.unlock,
              }))}
            />
          </div>

          {formError !== null && (
            <p role="alert" style={{ ...dim, color: "var(--ink)", fontWeight: 600 }}>
              {formError}
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
                    aria-describedby={note === null ? undefined : noteId}
                  >
                    <legend style={{ fontSize: "0.8rem", fontWeight: 600, padding: 0 }}>
                      {field.label}
                    </legend>
                    {field.sources.map((source) => {
                      const chosen = (values[field.key] as string[] | undefined) ?? [];
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
                              if (next.length === 0) clearValue(field.key);
                              else setValue(field.key, next);
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
                      noteId: note === null ? undefined : noteId,
                      invalid: error !== undefined,
                      busy,
                      value: values[field.key],
                      onChange: (v) =>
                        v === null ? clearValue(field.key) : setValue(field.key, v),
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
            {changeSummary(schema, values as CustomizationValues)}
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
              onClick={() => void submit()}
            >
              {busy ? "Saving…" : "Save these settings"}
            </button>
            <p style={dim} aria-live="polite">
              {notice ?? ""}
            </p>
          </div>

          <div>
            <p className="caps-label" style={{ margin: "0.4rem 0 0.3rem" }}>
              What you have saved for this workflow
            </p>
            {mine === undefined ? (
              <p style={dim}>Loading…</p>
            ) : myRows.length === 0 ? (
              <p style={dim}>You have not customized this workflow yet.</p>
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

/** The live hint under a control: the cap or the range, so the refusal is never the first news. */
function fieldHint(
  field: CustomizationField,
  value: string | number | string[] | undefined,
): string {
  switch (field.kind) {
    case "terminology":
    case "instruction":
      return `${valueBytes(typeof value === "string" ? value : "")} of ${field.maxBytes} characters used.`;
    case "threshold":
      return `A whole number between ${field.min} and ${field.max}.`;
    case "tone":
      return "Leave this alone to keep the workflow's usual tone.";
    case "source_preference":
      return "Leave every box clear to let the workflow use all of them.";
  }
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
  noteId: string | undefined;
  invalid: boolean;
  busy: boolean;
  value: string | number | string[] | undefined;
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

  if (field.kind === "instruction") {
    return (
      <textarea
        {...shared}
        rows={4}
        value={typeof value === "string" ? value : ""}
        maxLength={field.maxBytes}
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
      maxLength={field.maxBytes}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
    />
  );
}
