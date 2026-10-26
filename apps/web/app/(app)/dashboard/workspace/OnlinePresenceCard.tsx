"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";

type Session = NonNullable<FunctionReturnType<typeof api.onlinePresence.sessionForThread>>;
export type OnlinePresenceCardData = Pick<Session, "status" | "artifact" | "assessment">;

const muted = { color: "var(--ink-soft)", margin: 0, lineHeight: 1.6 } as const;

/** Read-only progress over server receipts. Reviewing the exact stored version happens in Sites. */
export function OnlinePresenceCardView({
  session,
}: {
  session: OnlinePresenceCardData | null | undefined;
}) {
  if (session === null) return null;
  if (session === undefined)
    return (
      <p role="status" style={muted}>
        Checking your online presence…
      </p>
    );

  const { artifact, assessment } = session;
  const isShop = artifact?.kind === "storefront";
  const published = artifact !== null && artifact.publishedVersion === artifact.version;
  const approved = artifact !== null && artifact.approvedVersion === artifact.version;
  const needsReview =
    session.status === "awaiting_review" && artifact !== null && !approved && !published;
  const copy =
    session.status === "blocked"
      ? {
          title: "Your online shop requirements",
          status: "Shop service unavailable",
          detail:
            "Pikar can prepare your requirements. Checkout, payments and fulfilment are not ready for a working shop.",
        }
      : session.status === "collecting"
        ? {
            title: "Your online presence",
            status: "Gathering business details",
            detail:
              "Pikar is shaping the package from your business information and documents. Add the missing details in this chat.",
          }
        : session.status === "ready"
          ? {
              title: "Your online presence",
              status: "Ready to build",
              detail: "Your brief is ready. Pikar can prepare the website package for your review.",
            }
          : artifact === null
            ? {
                title: "Your website package",
                status: "Checking the saved package",
                detail: "Pikar will show a review link when the saved website is available.",
              }
            : published
              ? {
                  title: "Your website package",
                  status: "Published",
                  detail: `Version ${artifact?.version} is published.`,
                }
              : approved
                ? {
                    title: "Your website package",
                    status: "Approved",
                    detail: `Version ${artifact?.version} is approved. Review its publication status in Sites.`,
                  }
                : {
                    title: "Your website package",
                    status: "Ready for your review",
                    detail:
                      "Open the finished draft to review its pages and approve the exact version before publication.",
                  };
  const questions = assessment && !assessment.ok ? assessment.missing.slice(0, 5) : [];
  const displayedCopy = isShop
    ? {
        title: "Your shop draft",
        status:
          session.status === "ready"
            ? "Ready to rebuild shop draft"
            : published
              ? "Presentation published"
              : approved
                ? "Presentation approved"
                : "Shop draft ready for review",
        detail:
          "This is your shop presentation, with its product catalogue. Review the exact version in Sites. Test checkout requires a verified merchant connection and the shop readiness checks shown there.",
      }
    : copy;

  return (
    <section
      aria-label="Online presence"
      data-testid="online-presence-card"
      style={{
        border: "1px solid var(--rule)",
        borderRadius: "1.25rem",
        background: "var(--card)",
        padding: "1.5rem",
        display: "grid",
        gap: "1rem",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <p
          style={{
            margin: 0,
            color: "var(--ink-soft)",
            fontSize: ".75rem",
            fontWeight: 700,
            letterSpacing: ".12em",
            textTransform: "uppercase",
          }}
        >
          Online presence
        </p>
        <span
          role="status"
          style={{
            padding: ".3rem .65rem",
            border: "1px solid var(--rule)",
            borderRadius: "1rem",
            color: needsReview ? "var(--held-text)" : "var(--ink)",
            background: "var(--canvas)",
            fontSize: ".8rem",
            fontWeight: 600,
          }}
        >
          {displayedCopy.status}
        </span>
      </div>
      <h3 style={{ margin: 0, color: "var(--ink)", fontSize: "1.2rem" }}>{displayedCopy.title}</h3>
      <p style={muted}>{displayedCopy.detail}</p>
      {questions.length ? (
        <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "var(--ink)", lineHeight: 1.6 }}>
          {questions.map((entry) => (
            <li key={`${entry.field}:${entry.reason}`}>{entry.question}</li>
          ))}
        </ul>
      ) : null}
      {artifact ? (
        <div
          style={{
            display: "grid",
            gap: ".6rem",
            paddingTop: "1rem",
            borderTop: "1px solid var(--rule)",
          }}
        >
          <p style={muted}>
            {isShop ? "Shop draft" : "Website"} version {artifact.version}
            {published ? " · Published" : approved ? " · Approved" : " · Draft"}
          </p>
          {artifact.currentDraftVersion !== undefined &&
          artifact.currentDraftVersion !== artifact.version ? (
            <p style={muted}>
              The editor now has version {artifact.currentDraftVersion}. This card refers to version{" "}
              {artifact.version}.
            </p>
          ) : null}
          <Link
            href={`/dashboard/sites?project=${encodeURIComponent(artifact.projectId)}&version=${artifact.version}`}
            style={{
              color: "var(--teal-900)",
              fontWeight: 700,
              textDecoration: "underline",
              textUnderlineOffset: ".2em",
              paddingBlock: ".5rem",
              width: "fit-content",
            }}
          >
            Review {isShop ? "shop draft" : "website"} version {artifact.version} →
          </Link>
        </div>
      ) : null}
    </section>
  );
}

export function OnlinePresenceCard({ threadId }: { threadId: string }) {
  const session = useQuery(api.onlinePresence.sessionForThread, { threadId });
  return <OnlinePresenceCardView session={session} />;
}
