"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type RecipeField = {
  id: string;
  label: string;
  type: "text" | "text-list" | "email" | "catalogue-list" | "dials";
  required: boolean;
  maxLength?: number;
};

type Recipe = {
  id: "business-site" | "campaign-landing";
  name: string;
  version: number;
  bodyHash: string;
  bundleHash: string;
  family: string;
  fields: readonly RecipeField[];
};

type FormValues = Record<string, string | number>;
type ApiShape = {
  webRecipes: {
    listAvailable: unknown;
    createProjectFromRecipe: unknown;
  };
};

const recipeApi = (api as unknown as ApiShape).webRecipes;
const card = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: 18,
  padding: 24,
};

const roleFor = (family: string) =>
  family === "campaign" || family === "campaign-landing" ? "Campaign landing" : "Business site";

const SOURCE_ROLES = "Interface patterns · visual-quality guardrails · commerce-safety boundaries";

function initialValues(recipe: Recipe | undefined): FormValues {
  const values: FormValues = {};
  for (const field of recipe?.fields ?? []) {
    if (field.type === "dials") continue;
    values[field.id] = field.type === "text-list" ? "" : "";
  }
  values.variance = 5;
  values.motion = 5;
  values.density = 5;
  return values;
}

function parseValue(field: RecipeField, value: string | number): unknown {
  if (field.type === "text-list")
    return String(value)
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
  return value;
}

export function WebRecipeForm() {
  const router = useRouter();
  const recipes = useQuery(recipeApi.listAvailable as never, {}) as Recipe[] | undefined;
  const createProject = useMutation(
    recipeApi.createProjectFromRecipe as never,
  ) as unknown as (args: {
    recipeId: Recipe["id"];
    values: Record<string, unknown>;
    slug: string;
    title: string;
    expectedAvailability: "tenant_discoverable";
  }) => Promise<{ projectId: string }>;
  const [selectedId, setSelectedId] = useState<Recipe["id"] | "">("");
  const [values, setValues] = useState<FormValues>({});
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<"status" | "alert">("status");
  const [submitting, setSubmitting] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const selected = useMemo(
    () => recipes?.find((recipe) => recipe.id === selectedId),
    [recipes, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    setValues(initialValues(selected));
    setErrors({});
    setNotice(null);
    setTitle("");
    setSlug("");
  }, [selected]);

  useEffect(() => {
    if (noticeTone === "alert") headingRef.current?.focus();
  }, [noticeTone]);

  const selectRecipe = (recipe: Recipe) => {
    setSelectedId(recipe.id);
    setNotice(null);
  };

  const validate = () => {
    if (!selected) return { selected: "Choose a recipe to continue." };
    const next: Record<string, string> = {};
    if (!title.trim()) next.title = "Add a project title.";
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      next.slug = "Use lowercase letters, numbers, and single hyphens.";
    for (const field of selected.fields) {
      if (field.type === "dials") continue;
      const raw = String(values[field.id] ?? "").trim();
      if (field.required && !raw) next[field.id] = `${field.label} is required.`;
      if (field.maxLength && raw.length > field.maxLength)
        next[field.id] = `${field.label} must be ${field.maxLength} characters or fewer.`;
    }
    return next;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = validate();
    if (Object.keys(next).length > 0) {
      setErrors(next);
      setNotice("Check the highlighted fields before continuing.");
      setNoticeTone("alert");
      return;
    }
    if (!selected) return;
    setSubmitting(true);
    setNotice("Creating your editable project…");
    setNoticeTone("status");
    try {
      const recipeValues: Record<string, unknown> = {};
      for (const field of selected.fields) {
        if (field.type === "dials") continue;
        const value = parseValue(field, values[field.id] ?? "");
        if (Array.isArray(value) ? value.length > 0 : String(value).trim())
          recipeValues[field.id] = value;
      }
      recipeValues.design = {
        variance: Number(values.variance),
        motion: Number(values.motion),
        density: Number(values.density),
      };
      const result = await createProject({
        recipeId: selected.id,
        values: recipeValues,
        slug,
        title,
        expectedAvailability: "tenant_discoverable",
      });
      setNotice("Project created. Opening the editor…");
      setNoticeTone("status");
      router.push(`/dashboard/sites?project=${String(result.projectId)}`);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setNotice(
        code.includes("UNAVAILABLE") || code.includes("STALE")
          ? "This recipe is no longer available. Your values are kept; retry to refresh the active list."
          : "The project could not be created. Your values are kept; check them and try again.",
      );
      setNoticeTone("alert");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section style={{ ...card, display: "grid", gap: "1rem" }} aria-labelledby="recipe-heading">
      <div>
        <p className="caps-label" style={{ margin: 0 }}>
          Guided starting point
        </p>
        <h2 id="recipe-heading" ref={headingRef} tabIndex={-1} style={{ margin: "0.25rem 0 0" }}>
          Start from a qualified recipe
        </h2>
        <p style={{ margin: "0.35rem 0 0", color: "var(--ink-soft)" }}>
          Choose one active starting point, add bounded business details, then keep editing in the
          normal protected editor.
        </p>
      </div>
      {recipes === undefined ? (
        <div aria-busy="true" role="status" style={{ display: "grid", gap: "0.5rem" }}>
          <span style={{ color: "var(--ink-soft)" }}>Loading active recipes…</span>
          <span aria-hidden style={{ height: 52, borderRadius: 12, background: "var(--canvas)" }} />
        </div>
      ) : recipes.length === 0 ? (
        <div role="status" style={{ display: "grid", gap: "0.5rem" }}>
          <strong>No active recipes are available right now.</strong>
          <span style={{ color: "var(--ink-soft)" }}>
            You can still use the advanced manual path below.
          </span>
          <button type="button" onClick={() => router.refresh()} style={{ justifySelf: "start" }}>
            Retry active recipes
          </button>
        </div>
      ) : (
        <>
          <ul
            aria-label="Active recipe choices"
            style={{ display: "grid", gap: "0.65rem", listStyle: "none", padding: 0, margin: 0 }}
          >
            {recipes.map((recipe) => (
              <li key={recipe.id}>
                <button
                  type="button"
                  aria-pressed={selectedId === recipe.id}
                  onClick={() => selectRecipe(recipe)}
                  style={{
                    textAlign: "left",
                    display: "grid",
                    gap: "0.25rem",
                    minHeight: 64,
                    width: "100%",
                    padding: "0.75rem 1rem",
                    borderRadius: 12,
                    border: `1px solid ${selectedId === recipe.id ? "var(--teal-600)" : "var(--rule)"}`,
                    background: selectedId === recipe.id ? "var(--canvas)" : "var(--card)",
                    color: "var(--ink)",
                  }}
                >
                  <span style={{ fontWeight: 750 }}>{roleFor(recipe.family)}</span>
                  <span style={{ color: "var(--ink-soft)", fontSize: "0.88rem" }}>
                    Qualified recipe · exact version {recipe.version}
                  </span>
                  <span style={{ color: "var(--ink-soft)", fontSize: "0.78rem" }}>
                    Source roles: {SOURCE_ROLES}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <form onSubmit={submit} noValidate style={{ display: "grid", gap: "0.9rem" }}>
              <div
                style={{ padding: "0.7rem 0.85rem", borderRadius: 10, background: "var(--canvas)" }}
              >
                <strong>{roleFor(selected.family)}</strong>
                <div style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
                  Version {selected.version} · qualified starting point
                </div>
                <div style={{ color: "var(--ink-soft)", fontSize: "0.82rem" }}>
                  Partial inputs are allowed when a field is marked optional; the server remains the
                  final validator.
                </div>
              </div>
              {notice && (
                <div role={noticeTone === "alert" ? "alert" : "status"} aria-live="polite">
                  {notice}
                  {noticeTone === "alert" && (
                    <button
                      type="button"
                      onClick={() => router.refresh()}
                      style={{ marginLeft: "0.6rem" }}
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}
              <Field
                label="Project title"
                id="project-title"
                value={title}
                error={errors.title}
                onChange={setTitle}
              />
              <Field
                label="Page path"
                id="project-slug"
                value={slug}
                error={errors.slug}
                onChange={setSlug}
                hint="Lowercase path, for example spring-offer."
              />
              {selected.fields.map((field) =>
                field.type === "dials" ? null : (
                  <Field
                    key={field.id}
                    label={field.label}
                    id={`recipe-${field.id}`}
                    value={String(values[field.id] ?? "")}
                    error={errors[field.id]}
                    hint={field.required ? "Required" : "Optional"}
                    multiline={field.type === "text-list"}
                    maxLength={field.maxLength}
                    onChange={(value) =>
                      setValues((current) => ({ ...current, [field.id]: value }))
                    }
                  />
                ),
              )}
              <fieldset style={{ display: "grid", gap: "0.65rem", border: 0, padding: 0 }}>
                <legend style={{ fontWeight: 750 }}>Design dials</legend>
                {(["variance", "motion", "density"] as const).map((dial) => (
                  <label
                    key={dial}
                    htmlFor={`recipe-${dial}`}
                    style={{ display: "grid", gap: "0.2rem" }}
                  >
                    <span style={{ textTransform: "capitalize" }}>{dial}</span>
                    <input
                      id={`recipe-${dial}`}
                      type="range"
                      min={1}
                      max={10}
                      step={1}
                      value={Number(values[dial] ?? 5)}
                      onChange={(event) =>
                        setValues((current) => ({ ...current, [dial]: event.target.value }))
                      }
                      aria-valuetext={`${Number(values[dial] ?? 5)} out of 10`}
                    />
                  </label>
                ))}
              </fieldset>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  minHeight: 44,
                  border: 0,
                  borderRadius: 10,
                  background: "var(--teal-600)",
                  color: "white",
                  fontWeight: 750,
                }}
              >
                {submitting ? "Creating…" : "Create editable project"}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

function Field({
  label,
  id,
  value,
  error,
  hint,
  multiline,
  maxLength,
  onChange,
}: {
  label: string;
  id: string;
  value: string;
  error?: string;
  hint?: string;
  multiline?: boolean;
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <label htmlFor={id} style={{ display: "grid", gap: "0.3rem" }}>
      <span style={{ fontWeight: 700 }}>{label}</span>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          rows={3}
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid var(--rule)",
            color: "var(--ink)",
          }}
        />
      ) : (
        <input
          id={id}
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          style={{
            minHeight: 42,
            padding: "0.55rem 0.7rem",
            borderRadius: 10,
            border: "1px solid var(--rule)",
            color: "var(--ink)",
          }}
        />
      )}
      {hint && !error && (
        <span id={hintId} style={{ color: "var(--ink-soft)", fontSize: "0.82rem" }}>
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} role="alert" style={{ color: "var(--held-text)", fontSize: "0.82rem" }}>
          {error}
        </span>
      )}
    </label>
  );
}
