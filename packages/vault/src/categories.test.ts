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
  it("VAULT_FILE_CAP_BYTES is a positive integer; GRAPH_HOP_CAP === 2", async () => {
    const { VAULT_FILE_CAP_BYTES, GRAPH_HOP_CAP } = await import("./constants");
    expect(Number.isInteger(VAULT_FILE_CAP_BYTES)).toBe(true);
    expect(VAULT_FILE_CAP_BYTES).toBeGreaterThan(0);
    expect(GRAPH_HOP_CAP).toBe(2);
  });
});
