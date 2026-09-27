"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { SiteEditor } from "./SiteEditor";
import { TenantCatalogue } from "./TenantCatalogue";
import { WebRecipeForm } from "./WebRecipeForm";

const card = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: 18,
  padding: 24,
};

function starter(kind: "site" | "landing") {
  return {
    kind,
    title: "A clear next move",
    brand: { name: "Pikar AI" },
    navigation: [],
    pages: [
      {
        slug: "home",
        title: "Home",
        nodes: [
          {
            kind: "hero",
            eyebrow: "PIKAR AI",
            heading: "Run the next revenue move",
            body: "A focused landing page for your next campaign.",
          },
          {
            kind: "form",
            id: "contact",
            heading: "Keep me posted",
            fields: ["email", "name"],
            consent: "I agree to hear from Pikar AI.",
          },
        ],
      },
      ...(kind === "site"
        ? [
            {
              slug: "about",
              title: "About",
              nodes: [
                {
                  kind: "section",
                  id: "about-us",
                  heading: "About us",
                  children: [
                    { kind: "text", text: "Tell customers what makes the business useful." },
                  ],
                },
              ],
            },
          ]
        : []),
    ],
    footer: { kind: "footer", text: "Built with Pikar AI" },
  };
}

export default function SitesPage() {
  const projects = useQuery(api.webProjects.listProjects, {});
  const createDraft = useMutation(api.webProjects.createDraft);
  const params = useSearchParams();
  const selected = params.get("project");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const create = async (kind: "site" | "landing") => {
    setCreating(true);
    setMessage(null);
    try {
      const label = kind === "site" ? "site" : "landing page";
      const result = await createDraft({
        kind,
        slug: `${kind}-${Date.now()}`,
        title: `New ${label}`,
        document: starter(kind),
      });
      window.location.assign(`/dashboard/sites?project=${String(result.projectId)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The page could not be created.");
    } finally {
      setCreating(false);
    }
  };

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
      <header>
        <p className="caps-label" style={{ margin: 0 }}>
          Web runtime
        </p>
        <h1 style={{ margin: "0.25rem 0 0", color: "var(--ink)" }}>Publish a focused page</h1>
        <p style={{ margin: "0.4rem 0 0", color: "var(--ink-soft)" }}>
          Structured content, exact versions, and a clear approval gate. Hosting is currently the
          Pikar platform path.
        </p>
      </header>
      {message && (
        <p role="alert" style={{ ...card, color: "var(--held-text)" }}>
          {message}
        </p>
      )}
      <WebRecipeForm />
      <section style={{ ...card, display: "grid", gap: "1rem" }} aria-labelledby="sites-heading">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2 id="sites-heading" style={{ margin: 0 }}>
              Your pages
            </h2>
            <p style={{ margin: "0.25rem 0 0", color: "var(--ink-soft)" }}>
              Drafts are private until you approve and publish them.
            </p>
          </div>
          <div style={{ display: "grid", gap: "0.45rem", justifyItems: "end" }}>
            <span style={{ color: "var(--ink-soft)", fontSize: "0.82rem" }}>
              Advanced manual path
            </span>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => create("landing")}
                disabled={creating}
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
                {creating ? "Creating…" : "Create landing page"}
              </button>
              <button
                type="button"
                onClick={() => create("site")}
                disabled={creating}
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
                Create site
              </button>
            </div>
          </div>
        </div>
        {projects === undefined ? (
          <p role="status">Loading your pages…</p>
        ) : projects.length === 0 ? (
          <p>No pages yet. Create a structured landing page to begin.</p>
        ) : (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {projects.map((project) => (
              <article
                key={String(project._id)}
                style={{
                  borderTop: "1px solid var(--rule)",
                  paddingTop: "0.75rem",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "1rem",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <h3 style={{ margin: 0 }}>{project.title}</h3>
                  <p style={{ margin: "0.2rem 0 0", color: "var(--ink-soft)" }}>
                    /{project.slug} ·{" "}
                    {project.publishedVersion
                      ? `Published v${project.publishedVersion}`
                      : project.approvedVersion
                        ? `Approved v${project.approvedVersion}`
                        : "Draft"}
                  </p>
                </div>
                <Link
                  href={`/dashboard/sites?project=${String(project._id)}`}
                  style={{ color: "var(--ink)", fontWeight: 700 }}
                >
                  {selected === String(project._id) ? "Editing" : "Open editor"}
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>
      <TenantCatalogue />
      {selected && <SiteEditor projectId={selected} />}
    </main>
  );
}
