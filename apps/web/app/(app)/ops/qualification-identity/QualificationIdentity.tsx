"use client";

import { api } from "@pikar/backend/api";
import { useConvexAuth, useQuery } from "convex/react";

export default function QualificationIdentity({
  expectedAId,
  expectedBId,
}: {
  expectedAId: string;
  expectedBId: string;
}) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const queryArgs = !isLoading && isAuthenticated ? {} : "skip";
  const profile = useQuery(api.tenantProfile.get, queryArgs);
  const viewer = useQuery(api.owner.viewer, queryArgs);
  let status = "NOT_READY";
  if (!isLoading && isAuthenticated && expectedAId !== expectedBId) {
    if (profile?.tenantId === expectedAId && viewer?.isOwner === true) status = "A_IDENTITY_MATCH";
    // Identity observation before the separate owner grant; this is not paid-run readiness.
    else if (profile?.tenantId === expectedAId && viewer?.isOwner === false)
      status = "A_NON_OWNER_MATCH";
    else if (profile?.tenantId === expectedBId && viewer?.isOwner === false)
      status = "B_IDENTITY_MATCH";
  }

  return (
    <main style={{ padding: "2rem", color: "var(--ink)" }}>
      <section
        style={{
          maxWidth: "40rem",
          padding: "1.5rem",
          borderRadius: "1rem",
          background: "var(--card)",
          border: "1px solid var(--rule)",
        }}
      >
        <h1>Verify account identity</h1>
        <p style={{ color: "var(--ink-soft)" }}>
          Local read-only check of the signed-in account and its existing role.
        </p>
        <p role="status" data-testid="phase23-identity-result">
          {status}
        </p>
      </section>
    </main>
  );
}
