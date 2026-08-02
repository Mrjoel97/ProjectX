import { describe, expect, it } from "vitest";
import { categoryFor, isSearchable } from "./categories";

describe("categoryFor — auto-assigned vault category (VALT-04)", () => {
  it("maps (source, mimeType) to exactly one of the 6 categories", () => {
    expect(categoryFor({ source: "upload", mimeType: "text/plain" })).toBe("my-uploads");
    expect(categoryFor({ source: "paste" })).toBe("brain-dumps");
    expect(categoryFor({ source: "agent" })).toBe("workspace-docs");
    expect(categoryFor({ mimeType: "image/png" })).toBe("images");
    expect(categoryFor({ mimeType: "video/mp4" })).toBe("videos");
    expect(categoryFor({ source: "google" })).toBe("google-docs");
  });

  it("image/video mimeType wins over an upload source", () => {
    expect(categoryFor({ source: "upload", mimeType: "image/jpeg" })).toBe("images");
    expect(categoryFor({ source: "upload", mimeType: "video/webm" })).toBe("videos");
  });

  it("defaults an unknown/absent source to my-uploads", () => {
    expect(categoryFor({})).toBe("my-uploads");
  });
});

describe("isSearchable — Phase-5 searchable format set", () => {
  it("returns true for the wired plain-text formats", () => {
    expect(isSearchable("text/plain")).toBe(true);
    expect(isSearchable("text/markdown")).toBe(true);
    expect(isSearchable("text/csv")).toBe(true);
  });

  it("returns false for accept-but-defer formats", () => {
    expect(isSearchable("application/pdf")).toBe(false);
    expect(isSearchable("image/png")).toBe(false);
    expect(isSearchable("video/mp4")).toBe(false);
    expect(isSearchable(undefined)).toBe(false);
  });
});

describe("constants", () => {
  // "a positive integer" was the whole assertion here until 15.3-02 — which meant the
  // 100 MiB → 200 MB raise would have broken nothing and been silently unverified. A cap that
  // nothing pins is a cap nothing notices changing.
  it("VAULT_FILE_CAP_BYTES is exactly 200 MB (decimal — the way the copy reads it)", async () => {
    const { VAULT_FILE_CAP_BYTES, GRAPH_HOP_CAP } = await import("./constants");
    expect(VAULT_FILE_CAP_BYTES).toBe(200 * 1000 * 1000);
    expect(GRAPH_HOP_CAP).toBe(2);
  });

  // THE RELATIONSHIP, not either number. VAULT_VIDEO_CAP_BYTES is bounded by the transcription
  // API's hard 25 MB limit (vaultTranscribe.ts:43) — NOT by our storage — so it must NOT track the
  // file cap. Anyone raising the file cap and "tidying" the video cap up to match breaks every
  // video upload at the API, not here.
  it("the video cap stays strictly BELOW the file cap (it is the API's number, not ours)", async () => {
    const { VAULT_FILE_CAP_BYTES, VAULT_VIDEO_CAP_BYTES } = await import("./constants");
    expect(VAULT_VIDEO_CAP_BYTES).toBe(25 * 1000 * 1000);
    expect(VAULT_VIDEO_CAP_BYTES).toBeLessThan(VAULT_FILE_CAP_BYTES);
  });

  // The formatter has to agree with the constants, or the product says 190.7 MB where the cap
  // says 200 MB — the exact class of drift this phase deleted five copies of.
  it("capMB renders each cap the way the product speaks it", async () => {
    const { capMB, VAULT_FILE_CAP_BYTES, VAULT_VIDEO_CAP_BYTES } = await import("./constants");
    expect(capMB(VAULT_FILE_CAP_BYTES)).toBe("200 MB");
    expect(capMB(VAULT_VIDEO_CAP_BYTES)).toBe("25 MB");
  });
});
