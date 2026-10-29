"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import Link from "next/link";
import { useCallback, useState } from "react";
import { PreviewCanvas } from "./preview/PreviewCanvas";
import { MerchantWorkspace } from "./MerchantWorkspace";

type ProjectId = FunctionArgs<typeof api.webProjects.getProject>["projectId"];
const button = {
  minHeight: 44,
  padding: "0.7rem 1rem",
  border: "1px solid var(--rule)",
  borderRadius: 10,
  color: "var(--ink)",
  background: "var(--card)",
  fontWeight: 700,
};

/** Customers review rendered content; authoring stays in the agent conversation. */
export function SiteEditor({ projectId, version }: { projectId: string; version?: number }) {
  const id = projectId as ProjectId;
  const project = useQuery(api.webProjects.getProject, { projectId: id });
  const selectedVersion = version ?? project?.draftVersion;
  const selected = useQuery(
    api.webProjects.getVersion,
    selectedVersion ? { projectId: id, version: selectedVersion } : "skip",
  );
  const session = useQuery(api.onlinePresence.sessionForProject, {
    projectId: id,
    ...(selectedVersion ? { version: selectedVersion } : {}),
  });
  const versions = useQuery(api.webProjects.listVersions, { projectId: id });
  const approve = useMutation(api.webProjects.approveVersion);
  const publish = useMutation(api.webProjects.publishVersion);
  const update = useMutation(api.webProjects.updateVersion);
  const unpublish = useMutation(api.webProjects.unpublish);
  const rollback = useMutation(api.webProjects.rollback);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const previewPin = `${id}:${selected?.version}:${selected?.contentHash}`;
  const [previewReadiness, setPreviewReadiness] = useState<{ pin: string; ready: boolean } | null>(
    null,
  );
  const onPreviewReadiness = useCallback(
    (ready: boolean) => {
      setPreviewReadiness((previous) =>
        previous?.pin === previewPin && previous.ready === ready
          ? previous
          : { pin: previewPin, ready },
      );
    },
    [previewPin],
  );
  const run = async (operation: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await operation();
      if (result && typeof result === "object" && "ok" in result && result.ok === false) {
        setNotice(
          "That change could not be completed. Refresh to check the current version before retrying.",
        );
        return;
      }
      setNotice(success);
    } catch {
      setNotice(
        "The result could not be confirmed. Refresh and check the published version before trying again.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (project === undefined || (selectedVersion && selected === undefined))
    return <p role="status">Loading your website version…</p>;
  if (!project || !selected) return <p role="alert">This website version is unavailable.</p>;
  const latest = selected.version === project.draftVersion;
  const approved =
    project.approvedVersion === selected.version &&
    project.approvedContentHash === selected.contentHash;
  const published =
    project.publishedVersion === selected.version &&
    project.publishedContentHash === selected.contentHash;
  const sourceReady =
    session !== undefined &&
    (session === null ||
      (session.version === selected.version && session.contentHash === selected.contentHash)) &&
    ((selected.assetSnapshots?.length ?? 0) === 0 ||
      (previewReadiness?.pin === previewPin && previewReadiness.ready));
  // The server binds readiness to this version's content, provider receipt and all page artifacts.
  // A loaded preview alone cannot qualify a generated design for approval or publication.
  const providerReviewRequired = selected.requiresProviderReview === true || !!selected.providerReceipt;
  const providerReviewReady = !providerReviewRequired || selected.browserQualityReady === true;
  const reviewReady = sourceReady && providerReviewReady;
  const reviewNeedsRefinement = selected.browserReview?.status === "failed";
  const reviewJobFailed = selected.browserReviewJob?.state === "failed";
  const reviewInProgress = selected.browserReviewJob?.state === "running" || selected.browserReviewJob?.state === "captured";
  const firstPage = (selected.document as { pages: { slug: string }[] }).pages[0]?.slug;
  const publicUrl =
    project.publicHost && firstPage
      ? `${/^(localhost|127\.0\.0\.1)(:|$)/.test(project.publicHost) ? "http" : "https"}://${project.publicHost}/p/${project.slug}/${firstPage}`
      : null;
  return (
    <section
      aria-label="Website review"
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 18,
        background: "var(--card)",
        padding: 20,
        display: "grid",
        gap: "1rem",
      }}
    >
      <header>
        <p className="caps-label">Review your website</p>
        <h2>
          {project.title} · version {selected.version}
        </h2>
        <p>
          {published
            ? "This exact version is published."
            : approved
              ? "You approved this exact version."
              : "This version is private and awaiting your review."}
        </p>
        {!latest && (
          <p role="status">
            A newer draft exists. You are reviewing version {selected.version}.{" "}
            <Link href={`/dashboard/sites?project=${projectId}&version=${project.draftVersion}`}>
              Review the newest draft
            </Link>
          </p>
        )}
        {session?.threadId && (
          <Link
            href={`/dashboard/workspace?thread=${encodeURIComponent(session.threadId)}&label=Your%20website`}
          >
            Ask Pikar to make a change
          </Link>
        )}
      </header>
      <PreviewCanvas
        projectId={projectId}
        version={selected.version}
        onReadinessChange={onPreviewReadiness}
      />
      {providerReviewRequired && !providerReviewReady && (
        <aside aria-label="Visual quality review" style={{ background: "var(--canvas)", padding: 16, borderRadius: 12 }}>
          <h3>{reviewNeedsRefinement ? "Design needs refinement" : reviewJobFailed ? "Visual review could not finish" : reviewInProgress ? "Visual quality review in progress" : "Visual quality review pending"}</h3>
          <p role="status">
            {reviewNeedsRefinement
              ? "This version has not passed its visual checks. Pikar needs to resolve the findings before approval or publication."
              : reviewJobFailed
                ? published
                  ? "Automatic visual review could not finish. Further publication changes remain blocked until review succeeds."
                  : "Automatic visual review could not finish. This version remains private."
                : reviewInProgress
                  ? "Pikar is checking this version on desktop and mobile, including reduced motion. Approval and publication remain unavailable until review succeeds."
                  : "This version is waiting for desktop, mobile and reduced-motion checks. Approval and publication become available only when its saved design passes review."}
          </p>
        </aside>
      )}
      {reviewReady && (session?.sourceWarnings?.length ?? 0) > 0 && (
        <aside
          aria-label="Information to review"
          style={{ background: "var(--canvas)", padding: 16, borderRadius: 12 }}
        >
          <h3>Before you make this public</h3>
          <ul>
            {[...new Set(session?.sourceWarnings.map((item) => item.code))].map((code) => (
              <li key={code}>
                {(
                  {
                    private_source:
                      "This version uses private business material. Check which details you want visitors to see.",
                    publication_permission_unset:
                      "Permission to publish the source material was not recorded. Check the copy before approving it.",
                    planned_source:
                      "Some source information describes future plans. Check that the pages describe them accurately.",
                    stale_source:
                      "Some source information may be out of date. Check the current business details.",
                    truncated_source:
                      "The agent saw only an excerpt of some material. Check the resulting copy carefully.",
                    claim_support_requires_review:
                      "Check business claims, contact details and offers against your actual business information.",
                  } as Record<string, string>
                )[code] ??
                  "Check the source information used for this version before approving it."}
              </li>
            ))}
          </ul>
        </aside>
      )}
      <p>
        Check the pages and the information you want to make public. Approval applies only to the
        version shown above.
      </p>
      {!sourceReady && (
        <p role="status">
          Loading the source information and saved images for this version before approval…
        </p>
      )}
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
        <button
          type="button"
          style={button}
          disabled={busy || approved || !latest || !reviewReady}
          onClick={() =>
            void run(
              () =>
                approve({
                  projectId: id,
                  version: selected.version,
                  contentHash: selected.contentHash,
                }),
              "This version is approved for publication.",
            )
          }
        >
          Approve this version
        </button>
        <button
          type="button"
          style={{ ...button, background: "var(--teal-600)", color: "white" }}
          disabled={busy || !approved || !latest || published || !reviewReady}
          onClick={() =>
            void run(
              () =>
                project.publishedVersion
                  ? update({
                      projectId: id,
                      version: selected.version,
                      contentHash: selected.contentHash,
                      expectedRevision: project.revision,
                    })
                  : publish({
                      projectId: id,
                      version: selected.version,
                      contentHash: selected.contentHash,
                      expectedRevision: project.revision,
                    }),
              "Your website version was published.",
            )
          }
        >
          Publish approved version
        </button>
        {project.publishedVersion && (
          <button
            type="button"
            style={button}
            disabled={busy}
            onClick={() =>
              void run(
                () => unpublish({ projectId: id, expectedRevision: project.revision }),
                "The website is no longer public.",
              )
            }
          >
            Take website offline
          </button>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
      {published && publicUrl && (
        <a
          href={publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--ink)", fontWeight: 700 }}
        >
          Open published website
        </a>
      )}
      <details>
        <summary>Previous versions</summary>
        <ul>
          {versions?.map((item) => (
            <li key={item._id}>
              <Link href={`/dashboard/sites?project=${projectId}&version=${item.version}`}>
                Review version {item.version}
              </Link>
              {approved && item.version === selected.version && !latest && (
                <button
                  type="button"
                  style={button}
                  disabled={busy || !reviewReady}
                  onClick={() =>
                    void run(
                      () =>
                        rollback({
                          projectId: id,
                          version: selected.version,
                          contentHash: selected.contentHash,
                          expectedRevision: project.revision,
                        }),
                      "The previous approved version was restored.",
                    )
                  }
                >
                  Restore reviewed version
                </button>
              )}
              {!latest && item.version === selected.version && !approved && (
                <button
                  type="button"
                  style={button}
                  disabled={busy || !reviewReady}
                  onClick={() =>
                    void run(
                      () =>
                        approve({
                          projectId: id,
                          version: selected.version,
                          contentHash: selected.contentHash,
                        }),
                      "Previous version approved for restoration.",
                    )
                  }
                >
                  Approve for restoration
                </button>
              )}
            </li>
          ))}
        </ul>
      </details>
      {project.kind === "storefront" && <MerchantWorkspace projectId={projectId} />}
    </section>
  );
}
