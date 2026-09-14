"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type CaseView = FunctionReturnType<typeof api.verticalEvalEvidence.inspectCase>;
type Verdict = "supported" | "contradicted" | "needs_review";

async function sha256(value: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Convert a human-selected JS substring into offsets over the exact stored UTF-8 byte stream. */
export async function locateUtf8EvidenceSpan(output: string, quote: string) {
  const characterStart = output.indexOf(quote);
  if (quote.length === 0 || characterStart < 0) throw new Error("QUOTE_NOT_IN_OUTPUT");
  const encoder = new TextEncoder();
  const startByte = encoder.encode(output.slice(0, characterStart)).length;
  const bytes = encoder.encode(quote);
  return { startByte, endByte: startByte + bytes.length, sha256: await sha256(bytes) };
}

function ReviewCase({ view }: { view: CaseView }) {
  const review = useMutation(api.verticalEvalEvidence.reviewCase);
  const [outcome, setOutcome] = useState<"artifact" | "partial" | "refused" | "blocked">(
    view.binding.observedOutcome === "artifact" ||
      view.binding.observedOutcome === "refused" ||
      view.binding.observedOutcome === "blocked"
      ? view.binding.observedOutcome
      : "partial",
  );
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [quotes, setQuotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setVerdicts(
      Object.fromEntries(
        view.criteria.map((criterion) => [
          criterion.id,
          criterion.mechanical?.decision ?? "needs_review",
        ]),
      ),
    );
    setQuotes({});
    setMessage(null);
  }, [view]);

  const qualification = view.qualification;
  const externallyBlocked = qualification.state === "external-attestation-required";

  async function submit() {
    setMessage(null);
    try {
      const decisions = await Promise.all(
        view.criteria.map(async (criterion) => {
          const decision = verdicts[criterion.id] ?? "needs_review";
          const outputSpans =
            criterion.mechanical || decision === "needs_review" || view.output === null
              ? []
              : [await locateUtf8EvidenceSpan(view.output, quotes[criterion.id] ?? "")];
          return {
            criterion: criterion.id,
            decision,
            outputSpans,
            sourceDocIds:
              criterion.id === "semantic.source-support"
                ? view.sources.map((source) => source.docId)
                : [],
          };
        }),
      );
      await review({
        receiptId: view.receiptId,
        outputHash: view.outputSha256 ?? undefined,
        sourceHashes: view.sources.map((source) => source.hash),
        outcome,
        qualifiedRole: "owner",
        decisions,
      });
      setMessage("Review recorded against these exact bytes. The candidate was not activated.");
    } catch {
      setMessage(
        "Review was not recorded. Check every semantic verdict and its exact output quote.",
      );
    }
  }

  return (
    <div style={{ display: "grid", gap: "0.8rem" }}>
      <p style={{ margin: 0 }}>
        Output SHA-256: <code>{view.outputSha256 ?? "none"}</code> · {view.outputByteLength} UTF-8
        bytes
      </p>
      {externallyBlocked && (
        <p role="status" style={{ margin: 0, color: "#92400e" }}>
          {qualification.lane.toUpperCase()} is blocked. {qualification.requiredPath}
        </p>
      )}
      {view.output !== null && (
        <pre
          style={{ margin: 0, padding: "0.8rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
        >
          {view.output}
        </pre>
      )}
      <label>
        Recorded outcome{" "}
        <select
          value={outcome}
          onChange={(event) => setOutcome(event.target.value as typeof outcome)}
        >
          <option value="artifact">artifact</option>
          <option value="partial">partial</option>
          <option value="refused">refused</option>
          <option value="blocked">blocked</option>
        </select>
      </label>
      {view.criteria.map((criterion) => {
        const mechanical = criterion.mechanical;
        const decision = verdicts[criterion.id] ?? "needs_review";
        return (
          <fieldset key={criterion.id} style={{ display: "grid", gap: "0.4rem" }}>
            <legend>
              <code>{criterion.id}</code> — {criterion.label}
            </legend>
            {mechanical ? (
              <p style={{ margin: 0 }}>
                Mechanically {mechanical.decision}: {mechanical.fact}
              </p>
            ) : (
              <>
                <select
                  aria-label={`${criterion.id} verdict`}
                  value={decision}
                  onChange={(event) =>
                    setVerdicts((prior) => ({
                      ...prior,
                      [criterion.id]: event.target.value as Verdict,
                    }))
                  }
                >
                  <option value="needs_review">needs review</option>
                  <option value="supported">supported</option>
                  <option value="contradicted">contradicted</option>
                </select>
                {decision !== "needs_review" && view.output !== null && (
                  <input
                    aria-label={`${criterion.id} exact output quote`}
                    placeholder="Paste an exact supporting or contradicting output span"
                    value={quotes[criterion.id] ?? ""}
                    onChange={(event) =>
                      setQuotes((prior) => ({ ...prior, [criterion.id]: event.target.value }))
                    }
                  />
                )}
              </>
            )}
          </fieldset>
        );
      })}
      <button type="button" disabled={externallyBlocked} onClick={submit}>
        Record byte-bound review
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}

/** Closed owner-only surface. A run appears only after an exact UUID is supplied. */
export function VerticalReviewConsole() {
  const [runId, setRunId] = useState("");
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const validRun = RUN_ID.test(runId);
  const run = useQuery(api.verticalEvalEvidence.inspectRun, validRun ? { runId } : "skip");
  const selected = useQuery(
    api.verticalEvalEvidence.inspectCase,
    receiptId ? { receiptId: receiptId as never } : "skip",
  );

  return (
    <details>
      <summary>Exact-version semantic evaluation review</summary>
      <div style={{ display: "grid", gap: "0.8rem", marginTop: "0.8rem" }}>
        <label>
          Evaluation run UUID{" "}
          <input
            value={runId}
            onChange={(event) => {
              setRunId(event.target.value.trim().toLowerCase());
              setReceiptId(null);
            }}
            placeholder="Paste the exact run UUID"
          />
        </label>
        {runId.length > 0 && !validRun && <p role="alert">Enter the exact evaluation run UUID.</p>}
        {run && (
          <>
            <p style={{ margin: 0 }}>
              Corpus <code>{run.corpusHash}</code> · evaluator <code>{run.evaluatorHash}</code>
            </p>
            <ul>
              {run.cases
                .filter((item) => item.stage !== "not-started")
                .map((item) => (
                  <li key={item.caseId}>
                    <code>{item.caseId}</code> — {item.stage} —{" "}
                    {item.currentPins ? "current pins" : "stale or unverifiable pins"}{" "}
                    {item.receiptId && item.currentPins && (
                      <button type="button" onClick={() => setReceiptId(item.receiptId)}>
                        Inspect review evidence
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          </>
        )}
        {selected && <ReviewCase view={selected} />}
      </div>
    </details>
  );
}
