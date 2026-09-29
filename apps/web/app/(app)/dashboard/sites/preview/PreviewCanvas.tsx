"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type ProjectId = FunctionArgs<typeof api.webProjects.getProject>["projectId"];
type Project = NonNullable<FunctionReturnType<typeof api.webProjects.getProject>>;
type ExactVersion = NonNullable<FunctionReturnType<typeof api.webProjects.getVersion>>;
type OwnerApiShape = { webRecipes: { getStorefrontQualification: unknown } };
const ownerApi = (api as unknown as OwnerApiShape).webRecipes;

const card = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: 18,
  padding: 20,
};

export function PreviewCanvas({
  projectId,
  version,
  qualificationOnly = false,
}: {
  projectId: string;
  version: number;
  qualificationOnly?: boolean;
}) {
  const typedProjectId = projectId as ProjectId;
  const params = useSearchParams();
  const queryQualificationOnly = params.get("qualification") === "only";
  const isQualification = qualificationOnly || queryQualificationOnly;
  const tenantProject = useQuery(
    api.webProjects.getProject,
    isQualification ? "skip" : { projectId: typedProjectId },
  );
  const tenantExact = useQuery(
    api.webProjects.getVersion,
    isQualification ? "skip" : { projectId: typedProjectId, version },
  );
  // The URL flag grants no data. It only selects the owner-wrapped query, which independently
  // refuses non-owners and is the sole read door for a private storefront qualification.
  const qualification = useQuery(
    ownerApi.getStorefrontQualification as never,
    isQualification ? ({ projectId: typedProjectId } as never) : "skip",
  ) as { project: Project; version: ExactVersion | null } | null | undefined;
  const project = isQualification ? qualification?.project : tenantProject;
  const exact = isQualification
    ? qualification?.version?.version === version
      ? qualification.version
      : null
    : tenantExact;
  if (
    (isQualification && qualification === undefined) ||
    (!isQualification && (tenantProject === undefined || tenantExact === undefined))
  )
    return (
      <main style={{ padding: "1.5rem" }}>
        <p role="status">Loading exact version…</p>
      </main>
    );
  if (!project || !exact)
    return (
      <main style={{ padding: "1.5rem" }}>
        <p role="alert">This version is unavailable.</p>
      </main>
    );
  const page = exact.document.pages[0];
  const artifact = exact.artifacts?.find((candidate) => candidate.pageSlug === page.slug);
  if (!artifact)
    return (
      <main style={{ padding: "1.5rem" }}>
        <p role="alert">This version cannot be rendered from its immutable artifact.</p>
      </main>
    );
  return (
    <main
      style={{
        display: "grid",
        gap: "1rem",
        padding: "1.5rem",
        maxWidth: "72rem",
        margin: "0 auto",
      }}
    >
      <header
        style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}
      >
        <div>
          <p className="caps-label" style={{ margin: 0 }}>
            Exact version preview
          </p>
          <h1 style={{ margin: "0.25rem 0 0" }}>
            {project.title} · v{exact.version}
          </h1>
          <p style={{ margin: "0.2rem 0 0", color: "var(--ink-soft)" }}>
            Hash {exact.contentHash}. This frame is read-only.
          </p>
        </div>
        <Link
          href={`/dashboard/sites?project=${projectId}`}
          style={{ color: "var(--ink)", fontWeight: 700 }}
        >
          Back to editor
        </Link>
      </header>
      {(isQualification || project.kind === "storefront") && (
        <section
          role="note"
          aria-label="Qualification-only preview"
          style={{ ...card, borderColor: "var(--held-text)" }}
        >
          <strong>Qualification only — commerce unavailable</strong>
          <p style={{ margin: "0.3rem 0 0", color: "var(--ink-soft)" }}>
            This storefront document is an owner review artifact. It is not tenant discoverable,
            publishable, or public.
          </p>
        </section>
      )}
      <section aria-label="Preview provenance" style={{ ...card, display: "grid", gap: "0.35rem" }}>
        <strong>Exact preview provenance</strong>
        {exact.recipeRef ? (
          <>
            <span>
              Recipe {exact.recipeRef.name} · version {exact.recipeRef.version}
            </span>
            <span style={{ color: "var(--ink-soft)", fontSize: "0.86rem" }}>
              Origin body {exact.recipeRef.bodyHash.slice(0, 12)}… · bundle{" "}
              {exact.recipeRef.designProfile.bundleHash.slice(0, 12)}…
            </span>
          </>
        ) : (
          <span style={{ color: "var(--ink-soft)", fontSize: "0.86rem" }}>
            Manual project; no recipe origin was recorded.
          </span>
        )}
        <span style={{ color: "var(--ink-soft)", fontSize: "0.86rem" }}>
          Current version {exact.version} · content {exact.contentHash}
        </span>
      </section>
      <section
        aria-label="Rendered page"
        style={{
          background: "var(--card)",
          border: "1px solid var(--rule)",
          borderRadius: 18,
          padding: 12,
        }}
      >
        <iframe
          title={`Preview ${project.title} version ${exact.version}`}
          srcDoc={artifact.html}
          style={{
            width: "100%",
            minHeight: 620,
            border: "1px solid var(--rule)",
            borderRadius: 12,
            background: "white",
          }}
          sandbox="allow-forms"
        />
      </section>
    </main>
  );
}
