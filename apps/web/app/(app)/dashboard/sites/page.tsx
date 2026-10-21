"use client";

import { api } from "@pikar/backend/api";
import { useAction, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { SiteEditor } from "./SiteEditor";

const card = {
  background: "var(--card)",
  border: "1px solid var(--rule)",
  borderRadius: 18,
  padding: 24,
};

export default function SitesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const projects = useQuery(api.webProjects.listProjects, {});
  const start = useAction(api.cockpit.startOnlinePresence);
  const selected = params.get("project");
  const version = Number(params.get("version"));
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const begin = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await start({
        text:
          request.trim() ||
          "Create a business website using my approved business foundation and documents. Ask only for information you still need.",
      });
      router.push(
        `/dashboard/workspace?thread=${encodeURIComponent(result.threadId)}&label=Your%20website`,
      );
    } catch {
      setNotice("The response could not be confirmed. Check Past chats before trying again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main
      style={{
        padding: "clamp(1rem,3vw,2rem)",
        maxWidth: "76rem",
        margin: "0 auto",
        display: "grid",
        gap: "1.5rem",
      }}
    >
      <header>
        <p className="caps-label">Your online presence</p>
        <h1 style={{ color: "var(--ink)" }}>Your business, online</h1>
        <p style={{ color: "var(--ink-soft)" }}>
          Tell Pikar what you need. Your agent uses your business foundation to prepare the pages
          and bring you a version to review.
        </p>
      </header>
      <section style={card} aria-labelledby="presence-start">
        <h2 id="presence-start">Let Pikar build your website</h2>
        <label style={{ display: "grid", gap: "0.5rem" }}>
          What would you like to create?
          <textarea
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            maxLength={8000}
            rows={3}
            placeholder="A website for my business, a campaign landing page, or help preparing my shop…"
            style={{
              width: "100%",
              padding: 12,
              border: "1px solid var(--rule)",
              borderRadius: 10,
              color: "var(--ink)",
              background: "var(--canvas)",
            }}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void begin()}
          style={{
            minHeight: 44,
            marginTop: 12,
            padding: "0.7rem 1rem",
            background: "var(--teal-600)",
            color: "white",
            border: 0,
            borderRadius: 10,
            fontWeight: 700,
          }}
        >
          {busy ? "Opening your workflow…" : "Build with Pikar"}
        </button>
        {notice && <p role="status">{notice}</p>}
        <p style={{ color: "var(--ink-soft)", fontSize: "0.88rem" }}>
          You review the exact version before it goes public. Shop checkout remains unavailable
          while merchant payment and delivery capabilities are being completed.
        </p>
      </section>
      {selected && (
        <SiteEditor
          projectId={selected}
          version={Number.isSafeInteger(version) && version > 0 ? version : undefined}
        />
      )}
      <section style={card} aria-labelledby="presence-projects">
        <h2 id="presence-projects">Your websites</h2>
        {projects === undefined ? (
          <p role="status">Loading your websites…</p>
        ) : projects.length === 0 ? (
          <p>Your first website will appear here after Pikar creates a draft.</p>
        ) : (
          <ul style={{ paddingLeft: "1.25rem", display: "grid", gap: "0.8rem" }}>
            {projects.map((project) => (
              <li key={project._id}>
                <Link
                  href={`/dashboard/sites?project=${project._id}&version=${project.draftVersion ?? 1}`}
                  style={{ color: "var(--ink)", fontWeight: 700 }}
                >
                  {project.title}
                </Link>
                <span style={{ color: "var(--ink-soft)" }}>
                  {" "}
                  ·{" "}
                  {project.publishedVersion
                    ? `Published version ${project.publishedVersion}`
                    : "Private draft"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
