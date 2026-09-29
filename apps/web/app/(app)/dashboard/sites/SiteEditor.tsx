"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TenantPolicyEditor } from "./TenantPolicyEditor";

const card = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: 18,
  padding: 24,
};

type ProjectId = FunctionArgs<typeof api.webProjects.getProject>["projectId"];
type Project = FunctionReturnType<typeof api.webProjects.getProject>;

function lifecycle(project: Project): string {
  if (!project) return "Unavailable";
  if (project.publishedVersion) return `Published v${project.publishedVersion}`;
  if (project.approvedVersion) return `Approved v${project.approvedVersion}`;
  if (project.draftVersion) return `Draft v${project.draftVersion}`;
  return "Unpublished";
}

function shortHash(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}…${value.slice(-4)}` : value;
}

export function SiteEditor({ projectId }: { projectId: string }) {
  const typedProjectId = projectId as ProjectId;
  const project = useQuery(api.webProjects.getProject, { projectId: typedProjectId });
  const draft = useQuery(
    api.webProjects.getVersion,
    project?.draftVersion ? { projectId: typedProjectId, version: project.draftVersion } : "skip",
  );
  const versions = useQuery(api.webProjects.listVersions, { projectId: typedProjectId });
  const saveDraft = useMutation(api.webProjects.saveDraft);
  const approveVersion = useMutation(api.webProjects.approveVersion);
  const publishVersion = useMutation(api.webProjects.publishVersion);
  const updateVersion = useMutation(api.webProjects.updateVersion);
  const rollback = useMutation(api.webProjects.rollback);
  const unpublish = useMutation(api.webProjects.unpublish);
  const [json, setJson] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (draft?.document) setJson(JSON.stringify(draft.document, null, 2));
  }, [draft]);

  const parsed = useMemo(() => {
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }, [json]);

  if (project === undefined)
    return (
      <section style={card}>
        <p role="status">Loading editor…</p>
      </section>
    );
  if (project === null)
    return (
      <section style={card}>
        <p role="alert">This page is unavailable or you do not have access.</p>
      </section>
    );
  if (draft === undefined && project.draftVersion)
    return (
      <section style={card}>
        <p role="status">Loading the exact draft version…</p>
      </section>
    );

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      if (result && typeof result === "object" && "ok" in result && result.ok === false)
        throw new Error("LIFECYCLE_REFUSED");
      setNotice(success);
    } catch (error) {
      setNotice(
        error instanceof Error && error.message.includes("STALE")
          ? "This editor is stale. Reload before changing the page."
          : "The requested lifecycle action was refused.",
      );
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!parsed) {
      setNotice("Enter valid structured JSON before saving.");
      return;
    }
    return run(
      () =>
        saveDraft({
          projectId: typedProjectId,
          document: parsed,
          expectedRevision: project.revision,
        }),
      "Draft saved. Approval is required before publishing.",
    );
  };
  const approve = () =>
    draft &&
    run(
      () =>
        approveVersion({
          projectId: typedProjectId,
          version: draft.version,
          contentHash: draft.contentHash,
        }),
      "Version approved.",
    );
  const publish = () =>
    draft &&
    project.approvedVersion === draft.version &&
    run(
      () =>
        project.publishedVersion
          ? updateVersion({
              projectId: typedProjectId,
              version: draft.version,
              contentHash: draft.contentHash,
              expectedRevision: project.revision,
            })
          : publishVersion({
              projectId: typedProjectId,
              version: draft.version,
              contentHash: draft.contentHash,
              expectedRevision: project.revision,
            }),
      project.publishedVersion
        ? "Published version updated."
        : "Published on the Pikar platform path.",
    );

  return (
    <section style={{ ...card, display: "grid", gap: "1rem" }} aria-labelledby="editor-heading">
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}
      >
        <div>
          <p className="caps-label" style={{ margin: 0 }}>
            Protected editor
          </p>
          <h2 id="editor-heading" style={{ margin: "0.25rem 0 0" }}>
            {project.title}
          </h2>
          <p style={{ margin: "0.2rem 0 0", color: "var(--ink-soft)" }}>
            {lifecycle(project)} · revision {project.revision}
          </p>
        </div>
        {draft && (
          <Link
            href={`/dashboard/sites/preview?project=${projectId}&version=${draft.version}`}
            style={{ color: "var(--ink)", fontWeight: 700 }}
          >
            Preview exact v{draft.version}
          </Link>
        )}
      </div>
      {notice && (
        <p role="status" style={{ margin: 0 }}>
          {notice}
        </p>
      )}
      <section
        aria-label="Content identity"
        style={{
          display: "grid",
          gap: "0.45rem",
          padding: "0.85rem 1rem",
          borderRadius: 12,
          background: "var(--canvas)",
          border: "1px solid var(--rule)",
        }}
      >
        <strong>Content identity</strong>
        {draft?.recipeRef ? (
          <>
            <div>
              <span style={{ fontWeight: 700 }}>Started from: </span>
              {draft.recipeRef.name} · exact recipe version {draft.recipeRef.version}
            </div>
            <div style={{ color: "var(--ink-soft)", fontSize: "0.86rem" }}>
              Origin body {shortHash(draft.recipeRef.bodyHash)} · bundle{" "}
              {shortHash(draft.recipeRef.designProfile.bundleHash)}
            </div>
            <div style={{ color: "var(--ink-soft)", fontSize: "0.86rem" }}>
              Current content: version {draft.version} · {draft.contentHash}
            </div>
            <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.82rem" }}>
              Later field or JSON edits change the current content identity only; the recipe origin
              remains immutable.
            </p>
          </>
        ) : (
          <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.86rem" }}>
            Manual project. No recipe origin was recorded. Current content: version{" "}
            {draft?.version ?? "—"} · {draft?.contentHash ?? "not loaded"}.
          </p>
        )}
      </section>
      <label style={{ display: "grid", gap: "0.4rem" }}>
        <span style={{ fontWeight: 700 }}>Structured content JSON</span>
        <textarea
          aria-label="Structured content JSON"
          value={json}
          onChange={(event) => setJson(event.target.value)}
          rows={18}
          spellCheck={false}
          style={{
            width: "100%",
            padding: 12,
            border: "1px solid var(--rule)",
            borderRadius: 10,
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            color: "var(--ink)",
            background: "var(--canvas)",
          }}
        />
      </label>
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={busy || !parsed}
          onClick={save}
          style={{
            minHeight: 44,
            padding: "0.7rem 1rem",
            border: 0,
            borderRadius: 10,
            background: "var(--teal-600)",
            color: "white",
            fontWeight: 700,
          }}
        >
          Save draft
        </button>
        <button
          type="button"
          disabled={busy || !draft}
          onClick={approve}
          style={{
            minHeight: 44,
            padding: "0.7rem 1rem",
            border: "1px solid var(--rule)",
            borderRadius: 10,
            background: "var(--card)",
            color: "var(--ink)",
            fontWeight: 700,
          }}
        >
          Approve exact version
        </button>
        <button
          type="button"
          disabled={
            busy ||
            !draft ||
            project.approvedVersion !== draft.version ||
            project.publishedVersion === draft.version
          }
          onClick={publish}
          style={{
            minHeight: 44,
            padding: "0.7rem 1rem",
            border: 0,
            borderRadius: 10,
            background: "var(--ink)",
            color: "white",
            fontWeight: 700,
          }}
        >
          {project.publishedVersion ? "Publish update" : "Publish"}
        </button>
        {project.publishedVersion && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () => unpublish({ projectId: typedProjectId, expectedRevision: project.revision }),
                "The page is unpublished and public reads now refuse it.",
              )
            }
            style={{
              minHeight: 44,
              padding: "0.7rem 1rem",
              border: "1px solid var(--rule)",
              borderRadius: 10,
              background: "var(--card)",
              color: "var(--ink)",
              fontWeight: 700,
            }}
          >
            Unpublish
          </button>
        )}
      </div>
      {versions && versions.length > 1 && (
        <section aria-label="Version history" style={{ display: "grid", gap: "0.5rem" }}>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>Version history</h3>
          {versions
            .filter((version) => version.version !== project.draftVersion)
            .map((version) => (
              <div
                key={version.version}
                style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}
              >
                <span>
                  v{version.version} · {version.contentHash.slice(0, 12)}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () =>
                        approveVersion({
                          projectId: typedProjectId,
                          version: version.version,
                          contentHash: version.contentHash,
                        }),
                      `Version ${version.version} approved for rollback.`,
                    )
                  }
                >
                  Approve v{version.version}
                </button>
                <button
                  type="button"
                  disabled={busy || project.approvedVersion !== version.version}
                  onClick={() =>
                    run(
                      () =>
                        rollback({
                          projectId: typedProjectId,
                          version: version.version,
                          contentHash: version.contentHash,
                          expectedRevision: project.revision,
                        }),
                      `Rolled back to exact version ${version.version}.`,
                    )
                  }
                >
                  Rollback to v{version.version}
                </button>
              </div>
            ))}
        </section>
      )}
      {project.kind === "storefront" && <TenantPolicyEditor projectId={projectId} />}
      <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: "0.9rem" }}>
        Hosting: Pikar platform path · source: tenant structured content · custom domains remain
        pending.
      </p>
    </section>
  );
}
