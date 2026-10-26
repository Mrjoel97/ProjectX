"use client";

import { api } from "@pikar/backend/api";
import { useAction } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  buildPresenceExample,
  examplePresentationHtml,
  PRESENCE_EXAMPLES,
  type PresenceExampleId,
} from "./examples";
import styles from "./examples.module.css";

export function PresenceExampleViewer({ exampleId }: { exampleId: PresenceExampleId }) {
  const example = PRESENCE_EXAMPLES.find((entry) => entry.id === exampleId)!;
  const compiled = useMemo(() => buildPresenceExample(exampleId), [exampleId]);
  const [pageSlug, setPageSlug] = useState(compiled.pages[0]!.slug);
  const [width, setWidth] = useState("desktop");
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const start = useAction(api.cockpit.startOnlinePresence);
  const router = useRouter();
  const page = compiled.pages.find((entry) => entry.slug === pageSlug) ?? compiled.pages[0]!;
  useEffect(() => {
    setHtml(examplePresentationHtml(page.html, compiled.images, window.location.origin));
  }, [page.html, compiled]);
  const begin = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await start({
        text: `Create ${example.kind === "Website" ? "a business website" : example.kind === "Landing page" ? "a landing page" : "an online shop"} for my business using a ${compiled.designProfile.surfaceStyle} visual style. I like the ${example.title} example's composition. Use my actual approved business information and owned imagery, not its fictional content, products or prices. Ask only for missing information.`,
      });
      router.push(
        `/dashboard/workspace?thread=${encodeURIComponent(result.threadId)}&label=Your%20${example.kind === "Shop" ? "shop" : "website"}`,
      );
    } catch {
      setNotice("The response could not be confirmed. Check Past chats before trying again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className={styles.viewer}>
      <Link className={styles.back} href="/dashboard/sites">
        ← Back to Sites
      </Link>
      <header className={styles.viewerHeader}>
        <div>
          <p className={styles.type}>
            {example.kind} example · {example.style}
          </p>
          <h1>{example.title}</h1>
          <p>{example.description}</p>
        </div>
        <button
          type="button"
          className={styles.primary}
          disabled={busy}
          onClick={() => void begin()}
        >
          {busy ? "Opening your workflow…" : "Use this direction"}
        </button>
      </header>
      {notice && <p role="status">{notice}</p>}
      <p className={styles.notice}>
        Read-only example with fictional content and generated illustrations. It creates no booking,
        inquiry or purchase. Your own version uses your business information and is reviewed before
        publication.
      </p>
      <div className={styles.toolbar}>
        <label>
          Page{" "}
          <select
            aria-label="Example page"
            value={page.slug}
            onChange={(event) => setPageSlug(event.target.value)}
          >
            {compiled.pages.map((entry) => (
              <option key={entry.slug} value={entry.slug}>
                {entry.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Preview{" "}
          <select
            aria-label="Example width"
            value={width}
            onChange={(event) => setWidth(event.target.value)}
          >
            <option value="desktop">Desktop</option>
            <option value="tablet">Tablet · 768px</option>
            <option value="phone">Phone · 390px</option>
          </select>
        </label>
        <span>Links and forms are inactive in this preview. Product details can be expanded.</span>
      </div>
      <div className={styles.previewFrame}>
        {html ? (
          <iframe
            title={`${example.title} ${page.title} example`}
            srcDoc={html}
            sandbox=""
            referrerPolicy="no-referrer"
            style={{ maxWidth: width === "phone" ? 390 : width === "tablet" ? 768 : "100%" }}
          />
        ) : (
          <p role="status">Preparing the example…</p>
        )}
      </div>
    </main>
  );
}
