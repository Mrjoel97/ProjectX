"use client";

import { api } from "@pikar/backend/api";
import { useMutation, useQuery } from "convex/react";
import type { GenericId } from "convex/values";
import { useState } from "react";

const failureText = (reason?: string) => {
  switch (reason) {
    case "too_many_references":
      return "Choose up to three product images.";
    case "reference_unavailable":
      return "That image is unavailable. Choose another image from your Knowledge Vault.";
    case "media_busy":
      return "Product images cannot change while this film is being generated.";
    case "native_only":
      return "Product references are available for new Seedance films.";
    default:
      return "The selection could not be saved. Try again.";
  }
};

export function NativeProductReferences({
  planId,
  locked,
  onSavingChange,
}: {
  planId: GenericId<"plans">;
  locked: boolean;
  onSavingChange?: (saving: boolean) => void;
}) {
  const options = useQuery(api.media.productReferenceOptions, { planId });
  const save = useMutation(api.media.setProductReferences);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const selected = options?.selectedDocIds ?? [];

  async function toggle(docId: GenericId<"vaultDocuments">, checked: boolean) {
    if (busy || locked) return;
    const docIds = checked ? [...selected, docId] : selected.filter((id) => id !== docId);
    if (docIds.length > 3) {
      setNote(failureText("too_many_references"));
      return;
    }
    setBusy(true);
    onSavingChange?.(true);
    setNote(null);
    try {
      const result = await save({ planId, docIds });
      setNote(
        result.ok
          ? "Product references saved. Review the updated request and estimate before generating."
          : failureText(result.reason),
      );
    } catch {
      setNote(failureText());
    } finally {
      setBusy(false);
      onSavingChange?.(false);
    }
  }

  return (
    <section aria-label="Product reference images" style={{ marginTop: "0.8rem" }}>
      <details>
        <summary style={{ cursor: "pointer", padding: "0.65rem 0", fontWeight: 600 }}>
          Product images · {selected.length} selected
        </summary>
        <p style={{ color: "var(--ink-soft)", fontSize: "0.8rem", lineHeight: 1.6 }}>
          Choose up to three images of this product from your Knowledge Vault. These guide every
          generated scene and are included in the generation review. Choose separately for each
          product in a batch.
        </p>
        {options === undefined ? (
          <p role="status">Loading your product images…</p>
        ) : options === null ? (
          <p>This film's product images are unavailable.</p>
        ) : options.images.length === 0 ? (
          <p>Add product photos to your Knowledge Vault to use them here.</p>
        ) : (
          <fieldset
            disabled={locked || busy}
            style={{
              border: "1px solid var(--rule)",
              borderRadius: "0.5rem",
              margin: "0.6rem 0",
              padding: "0.5rem",
              maxHeight: "15rem",
              overflowY: "auto",
            }}
          >
            <legend>Use these product images</legend>
            {options.images.map((image) => {
              const checked = selected.includes(image.docId);
              return (
                <label
                  key={image.docId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.65rem",
                    minHeight: 56,
                    padding: "0.35rem",
                    overflowWrap: "anywhere",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && selected.length >= 3}
                    onChange={(event) => void toggle(image.docId, event.target.checked)}
                  />
                  {image.url && (
                    // biome-ignore lint/performance/noImgElement: use the owned storage URL directly so no image optimization proxy receives the capability.
                    <img
                      src={image.url}
                      alt=""
                      width={44}
                      height={44}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      style={{ objectFit: "contain", flexShrink: 0 }}
                    />
                  )}
                  <span>{image.title}</span>
                </label>
              );
            })}
          </fieldset>
        )}
        {locked && <p>Product references are fixed for this generated film.</p>}
      </details>
      {busy && <p role="status">Saving product references…</p>}
      {note && <p role="status">{note}</p>}
    </section>
  );
}
