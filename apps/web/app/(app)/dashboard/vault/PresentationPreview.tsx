"use client";

import { renderPresentationHtml, validatePresentationSpec } from "@pikar/core/presentation";
import { useMemo, useState } from "react";

/** A same-spec preview, not a pixel-identical Office conversion. No scripts/network in frame. */
export function PresentationPreview({ spec }: { spec: unknown }) {
  const [selected, setSelected] = useState(0);
  const prepared = useMemo(() => {
    try {
      return validatePresentationSpec(spec);
    } catch {
      return null;
    }
  }, [spec]);
  const current = Math.min(selected, Math.max(0, (prepared?.slides.length ?? 1) - 1));
  const html = useMemo(
    () => (prepared ? renderPresentationHtml(prepared, current) : ""),
    [prepared, current],
  );
  if (!prepared)
    return (
      <p className="text-sm text-[var(--ink-soft)]">
        The slide preview is unavailable. Download the original PowerPoint.
      </p>
    );
  const slide = prepared.slides[current]!;
  return (
    <section aria-label="Presentation preview" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--ink-soft)]" aria-live="polite">
          Slide {current + 1} of {prepared.slides.length}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={current === 0}
            onClick={() => setSelected(current - 1)}
            className="rounded border border-[var(--rule)] px-3 py-1 text-sm disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={current === prepared.slides.length - 1}
            onClick={() => setSelected(current + 1)}
            className="rounded border border-[var(--rule)] px-3 py-1 text-sm disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
      <iframe
        title={`Slide ${current + 1}: ${slide.title}`}
        srcDoc={html}
        sandbox=""
        referrerPolicy="no-referrer"
        className="aspect-video w-full rounded border border-[var(--rule)] bg-white"
      />
      <p className="text-xs text-[var(--ink-soft)]">
        Layout preview. PowerPoint fonts and spacing may vary. Download the editable original for
        presenting.
      </p>
      {slide.notes || slide.sourceIds?.length ? (
        <details className="text-sm text-[var(--ink-soft)]">
          <summary className="cursor-pointer">Speaker notes and sources</summary>
          {slide.notes ? <p className="mt-2 whitespace-pre-wrap">{slide.notes}</p> : null}
          {slide.sourceIds?.map((id) => {
            const source = prepared.sources?.find((entry) => entry.id === id);
            return source ? (
              <p key={id} className="mt-2 break-words">
                [{source.id}] {source.label}
                {source.url ? ` — ${source.url}` : ""}
              </p>
            ) : null;
          })}
        </details>
      ) : null}
    </section>
  );
}
