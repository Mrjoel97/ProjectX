"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useState } from "react";

type ArtifactId = FunctionArgs<typeof api.verticalPacks.reviewTarget>["artifactId"];

/** An authenticated artifact decision, not candidate approval, publication or a send. */
export function VerticalArtifactReview({ artifactId }: { artifactId: ArtifactId }) {
  const target = useQuery(api.verticalPacks.reviewTarget, { artifactId });
  const recordReview = useMutation(api.verticalPacks.recordReview);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  if (!target) return null;

  const decide = async (decision: "approve" | "reject") => {
    setSaving(true);
    setError(false);
    try {
      await recordReview({ artifactId, decision });
    } catch {
      setError(true);
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
          Review recorded: {target.decision === "approve" ? "acceptable" : "needs changes"}.
        </p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <button type="button" disabled={saving} onClick={() => void decide("approve")}>
            Mark acceptable
          </button>
          <button type="button" disabled={saving} onClick={() => void decide("reject")}>
            Needs changes
          </button>
        </div>
      )}
      {error && (
        <p role="alert">Review could not be recorded. Reopen the artifact and try again.</p>
      )}
    </section>
  );
}
