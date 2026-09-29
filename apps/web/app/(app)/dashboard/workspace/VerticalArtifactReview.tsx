"use client";

import { api } from "@pikar/backend/api";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useState } from "react";

type ArtifactId = FunctionArgs<typeof api.verticalPacks.reviewTarget>["artifactId"];

/** An authenticated artifact decision, not candidate approval, publication or a send. */
export function VerticalArtifactReview({ artifactId }: { artifactId: ArtifactId }) {
  const target = useQuery(api.verticalPacks.reviewTarget, { artifactId });
  const artifact = useQuery(api.vault.vaultDocText, { vaultDocId: artifactId });
  const recordReview = useMutation(api.verticalPacks.recordReview);
  const saveEdit = useAction(api.verticalArtifactEdit.save);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (!target) return null;

  const decide = async (decision: "approve" | "reject") => {
    setSaving(true);
    setError(null);
    try {
      await recordReview({ artifactId, decision });
    } catch {
      setError("Review could not be recorded. Reopen the artifact and try again.");
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveEdit({ artifactId, markdown: draft });
      setEditing(false);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(
        code.includes("ARTIFACT_EDIT_NO_TABLE")
          ? "This spreadsheet needs a Markdown table before it can be saved."
          : code.includes("ARTIFACT_EDIT_STALE_OR_UNCHANGED") ||
              code.includes("ARTIFACT_ORIGIN_UNVERIFIED")
            ? "This draft changed while you were editing. Reopen it before trying again."
            : "Save result could not be confirmed. Reopen the artifact to check whether your edit was saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Review vertical draft" data-testid="vertical-artifact-review">
      <p style={{ color: "var(--ink-soft)", fontSize: "0.82rem" }}>
        Review this {target.verticalId} draft. This records your decision; it does not publish,
        activate a skill or send anything.
      </p>
      {target.decision ? (
        <p role="status">
          Review recorded:{" "}
          {target.decision === "approve"
            ? "acceptable"
            : target.decision === "edit"
              ? "edited draft saved"
              : "needs changes"}
          .
        </p>
      ) : editing ? (
        <div>
          <label htmlFor="vertical-artifact-edit">Edit this draft</label>
          <textarea
            id="vertical-artifact-edit"
            aria-label="Edit vertical draft"
            value={draft}
            maxLength={25_000}
            onChange={(event) => setDraft(event.target.value)}
            rows={12}
            style={{ width: "100%" }}
          />
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              disabled={saving || !draft.trim() || draft === artifact?.text}
              onClick={() => void save()}
            >
              Save edited draft
            </button>
            <button type="button" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <button type="button" disabled={saving} onClick={() => void decide("approve")}>
            Mark acceptable
          </button>
          <button type="button" disabled={saving} onClick={() => void decide("reject")}>
            Needs changes
          </button>
          <button
            type="button"
            disabled={saving || artifact?.text == null || artifact.status !== "ready"}
            onClick={() => {
              setDraft(artifact?.text ?? "");
              setEditing(true);
            }}
          >
            Edit draft
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
