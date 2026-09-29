"use client";

import { useSearchParams } from "next/navigation";
import { PreviewCanvas } from "./PreviewCanvas";

export default function SitePreviewPage() {
  const params = useSearchParams();
  const project = params.get("project");
  const version = Number(params.get("version"));
  if (!project || !Number.isInteger(version) || version < 1)
    return (
      <main style={{ padding: "1.5rem" }}>
        <p role="alert">Choose a valid project version to preview.</p>
      </main>
    );
  return <PreviewCanvas projectId={project} version={version} />;
}
