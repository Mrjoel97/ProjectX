"use client";

import { api } from "@pikar/backend/api";
import { VERTICAL_IDS, type VerticalId } from "@pikar/core/verticalPacks";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { type FormEvent, useId, useRef, useState } from "react";
import { ErrorBoundary } from "../workspace/ErrorBoundary";
import { card, field, label, primaryButton } from "./styles";

type Source = FunctionReturnType<typeof api.verticalPacks.workloadSources>["docs"][number];
type Titles = Readonly<Record<VerticalId, string>>;
const secondaryButton: React.CSSProperties = {
  font: "inherit",
  color: "var(--ink)",
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: "0.7rem",
  padding: "0.65rem 0.85rem",
  cursor: "pointer",
};
const hint: React.CSSProperties = {
  margin: 0,
  color: "var(--ink-soft)",
  fontSize: "0.9rem",
  lineHeight: 1.5,
};

function SourcePage({
  selected,
  onToggle,
  busy,
}: {
  selected: readonly Source[];
  onToggle: (doc: Source) => void;
  busy: boolean;
}) {
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const cursor = cursors[cursors.length - 1];
  const page = useQuery(api.verticalPacks.workloadSources, cursor ? { cursor } : {});
  const atLimit = selected.length === 2;
  return (
    <div style={{ display: "grid", gap: "0.75rem" }} aria-busy={page === undefined}>
      <p style={hint}>
        Choose two different documents from work you have already done. Availability is checked
        again when you save.
      </p>
      {page === undefined ? (
        <p role="status" style={hint}>
          Loading your Vault documents…
        </p>
      ) : page.docs.length === 0 ? (
        <p style={hint}>No available documents on this page.</p>
      ) : (
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <legend style={{ ...label, marginBottom: "0.5rem" }}>Available documents</legend>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.5rem" }}>
            {page.docs.map((doc) => {
              const checked = selected.some((item) => item.docId === doc.docId);
              return (
                <li key={doc.docId}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "start",
                      gap: "0.65rem",
                      padding: "0.7rem",
                      border: "1px solid var(--rule)",
                      borderRadius: "0.65rem",
                      color: "var(--ink)",
                      overflowWrap: "anywhere",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={atLimit && !checked}
                      onChange={() => onToggle(doc)}
                      style={{
                        marginTop: "0.2rem",
                        accentColor: "var(--teal-600)",
                        flexShrink: 0,
                      }}
                    />
                    <span>{doc.title || "Untitled document"}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        {cursors.length > 1 && (
          <button
            type="button"
            disabled={busy || page === undefined}
            style={secondaryButton}
            onClick={() => setCursors((values) => values.slice(0, -1))}
          >
            Previous documents
          </button>
        )}
        {page?.nextCursor && (
          <button
            type="button"
            disabled={busy}
            style={secondaryButton}
            onClick={() => setCursors((values) => [...values, page.nextCursor ?? undefined])}
          >
            More documents
          </button>
        )}
        <a href="/dashboard/vault" style={{ color: "var(--teal-600)", padding: "0.5rem 0" }}>
          Open Vault
        </a>
      </div>
    </div>
  );
}

function WorkloadForm({ titles }: { titles: Titles }) {
  const profile = useQuery(api.tenantProfile.get, {});
  const configure = useMutation(api.verticalPacks.configure);
  const [verticalId, setVerticalId] = useState<VerticalId | "">("");
  const [selected, setSelected] = useState<Source[]>([]);
  const [confirmedNeed, setConfirmedNeed] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const fieldId = useId();
  if (profile === undefined)
    return (
      <p role="status" style={hint}>
        Loading your saved preferences…
      </p>
    );
  if (profile === null)
    return <p style={hint}>Confirm your business shape above before adding examples.</p>;
  const ready = verticalId !== "" && selected.length === 2 && confirmedNeed && !saving;
  const previous = profile.verticalPreferences?.confirmedWorkloads?.find(
    (item) => item.verticalId === verticalId,
  );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || savingRef.current || !verticalId) return;
    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    const preferences = profile.verticalPreferences;
    try {
      await configure({
        needs: [...new Set([...(preferences?.needs ?? []), verticalId])],
        reviewReady: preferences?.reviewReady ?? [],
        ...(preferences?.legalPlaybookDocId
          ? { legalPlaybookDocId: preferences.legalPlaybookDocId }
          : {}),
        confirmWorkload: { verticalId, artifactIds: selected.map((doc) => doc.docId) },
      });
      setConfirmedNeed(false);
      setNotice({
        error: false,
        text: "Examples saved. Suggestions will appear when a workflow is ready and its current source requirements are met.",
      });
    } catch {
      setNotice({
        error: true,
        text: "The examples could not be confirmed. A document may no longer be available. Check your selections and try again.",
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <form
      onSubmit={(event) => void submit(event)}
      style={{ display: "grid", gap: "1rem" }}
      aria-busy={saving}
    >
      <p style={hint}>
        Show which work repeats in your business. These examples record past work; they do not start
        or approve a workflow.
      </p>
      <div style={{ display: "grid", gap: "0.45rem" }}>
        <label htmlFor={fieldId} style={label}>
          Work you want help with
        </label>
        <select
          id={fieldId}
          value={verticalId}
          disabled={saving}
          style={field}
          onChange={(event) => {
            const next = VERTICAL_IDS.find((id) => id === event.target.value) ?? "";
            setVerticalId(next);
            setSelected([]);
            setConfirmedNeed(false);
            setNotice(null);
          }}
        >
          <option value="">Choose the work</option>
          {VERTICAL_IDS.map((id) => (
            <option key={id} value={id}>
              {titles[id]}
            </option>
          ))}
        </select>
      </div>
      {verticalId && (
        <>
          {previous && (
            <p style={hint}>
              Past examples recorded on {new Date(previous.confirmedAt).toLocaleDateString()}.
              Saving replaces those examples for this type of work.
            </p>
          )}
          <SourcePage
            key={verticalId}
            selected={selected}
            busy={saving}
            onToggle={(doc) => {
              setNotice(null);
              setConfirmedNeed(false);
              setSelected((values) =>
                values.some((item) => item.docId === doc.docId)
                  ? values.filter((item) => item.docId !== doc.docId)
                  : values.length < 2
                    ? [...values, doc]
                    : values,
              );
            }}
          />
          <div style={{ display: "grid", gap: "0.5rem" }}>
            <p role="status" style={{ ...hint, fontWeight: 600 }}>
              {selected.length} of 2 examples selected
            </p>
            {selected.length > 0 && (
              <ul
                aria-label="Selected examples"
                style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.5rem" }}
              >
                {selected.map((doc) => (
                  <li
                    key={doc.docId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "0.75rem",
                      minWidth: 0,
                    }}
                  >
                    <span style={{ overflowWrap: "anywhere", minWidth: 0 }}>
                      {doc.title || "Untitled document"}
                    </span>
                    <button
                      type="button"
                      disabled={saving}
                      aria-label={`Remove ${doc.title || "untitled document"}`}
                      style={secondaryButton}
                      onClick={() => {
                        setSelected((values) => values.filter((item) => item.docId !== doc.docId));
                        setNotice(null);
                        setConfirmedNeed(false);
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "start",
              gap: "0.65rem",
              color: "var(--ink)",
              lineHeight: 1.5,
            }}
          >
            <input
              type="checkbox"
              checked={confirmedNeed}
              disabled={saving}
              onChange={(event) => setConfirmedNeed(event.target.checked)}
              style={{ marginTop: "0.25rem", accentColor: "var(--teal-600)" }}
            />
            <span>
              This work repeats in my business, and these two documents are relevant examples.
            </span>
          </label>
          <p style={hint}>
            Your confirmation remains a record of past work if a document is later removed. Starting
            a workflow still requires sources available now and the required review.
          </p>
          <div>
            <button type="submit" disabled={!ready} style={primaryButton(!ready)}>
              {saving ? "Saving examples…" : "Save examples"}
            </button>
          </div>
        </>
      )}
      {notice && (
        <p role={notice.error ? "alert" : "status"} style={hint}>
          {notice.text}
        </p>
      )}
    </form>
  );
}

/** Preference collection remains available when no candidate qualifies for a recommendation. */
export function VerticalWorkloadConfirmation({ titles }: { titles: Titles }) {
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  return (
    <details style={card} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary style={{ cursor: "pointer", color: "var(--ink)", fontWeight: 600 }}>
        Show work you do repeatedly
      </summary>
      {open && (
        <ErrorBoundary
          key={retry}
          label="workload examples"
          fallback={
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <p role="alert" style={hint}>
                Your saved preferences or Vault documents could not be loaded.
              </p>
              <div>
                <button
                  type="button"
                  style={secondaryButton}
                  onClick={() => setRetry((value) => value + 1)}
                >
                  Try again
                </button>
              </div>
            </div>
          }
        >
          <WorkloadForm titles={titles} />
        </ErrorBoundary>
      )}
    </details>
  );
}
