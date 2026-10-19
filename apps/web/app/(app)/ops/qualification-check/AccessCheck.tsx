"use client";

import { api } from "@pikar/backend/api";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useRef, useState } from "react";

type Result = "NOT_STARTED" | "CHECK_RUNNING" | "OWNER_REQUIRED" | "CHECK_FAILED";

/** The native client wraps a plain server Error; never accept a substring or show its prose. */
function isOwnerRequired(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message === "OWNER_REQUIRED") return true;
  const message = error.message.replaceAll("\r\n", "\n");
  if (!message.startsWith("[CONVEX M(skills:activateAgentCandidate)] ")) return false;
  const errorLines = message.split("\n").filter((line) => line.startsWith("Uncaught "));
  return errorLines.length === 1 && errorLines[0] === "Uncaught Error: OWNER_REQUIRED";
}

export default function AccessCheck({
  candidateId,
  expectedBId,
}: {
  candidateId: string;
  expectedBId: string;
}) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const queryArgs = !isLoading && isAuthenticated ? {} : "skip";
  const profile = useQuery(api.tenantProfile.get, queryArgs);
  const viewer = useQuery(api.owner.viewer, queryArgs);
  const activate = useMutation(api.skills.activateAgentCandidate);
  const [result, setResult] = useState<Result>("NOT_STARTED");
  const attempted = useRef(false);
  const invalidated = useRef(false);
  const ready =
    !isLoading && isAuthenticated && profile?.tenantId === expectedBId && viewer?.isOwner === false;
  const latest = useRef({ ready, candidateId, expectedBId });
  if (
    attempted.current &&
    (!ready ||
      latest.current.candidateId !== candidateId ||
      latest.current.expectedBId !== expectedBId)
  )
    invalidated.current = true;
  latest.current = { ready, candidateId, expectedBId };

  async function verifyAccess() {
    if (attempted.current || !latest.current.ready) return;
    attempted.current = true;
    const pins = latest.current;
    setResult("CHECK_RUNNING");
    try {
      // The real public ownerMutation remains the authorization boundary. No internal proxy.
      await activate({
        candidateId: pins.candidateId as FunctionArgs<
          typeof api.skills.activateAgentCandidate
        >["candidateId"],
      });
      setResult("CHECK_FAILED");
    } catch (error) {
      const unchanged =
        !invalidated.current &&
        latest.current.ready &&
        latest.current.candidateId === pins.candidateId &&
        latest.current.expectedBId === pins.expectedBId;
      setResult(unchanged && isOwnerRequired(error) ? "OWNER_REQUIRED" : "CHECK_FAILED");
    }
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
        <h1>Verify restricted access</h1>
        <p style={{ color: "var(--ink-soft)" }}>
          Local qualification check for the prepared non-owner account. This check must be refused
          by the existing owner permission gate.
        </p>
        <p data-testid="phase23-access-identity">{ready ? "B_IDENTITY_MATCH" : "NOT_READY"}</p>
        <button
          type="button"
          disabled={!ready || attempted.current}
          onClick={() => void verifyAccess()}
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "0.75rem",
            border: "1px solid var(--rule)",
            background: "var(--card)",
            color: "var(--ink)",
          }}
        >
          Verify access once
        </button>
        <p role="status" data-testid="phase23-access-result">
          {invalidated.current ? "CHECK_FAILED" : result}
        </p>
      </section>
    </main>
  );
}
