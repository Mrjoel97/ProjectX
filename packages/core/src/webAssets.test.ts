import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { assessOnlinePresenceBrief } from "./onlinePresence";
import { deletableTables, storageIdsIn, TENANT_TABLE_CLASSIFICATION } from "./tenantData";
import {
  collectWebAssetRefs,
  inspectWebAssetBytes,
  parseWebAssetRef,
  webAssetPath,
} from "./webAssets";
import { renderDesignedWebDocument } from "./webDesignRenderer";
import { materializeWebRecipeWithProvenance, validateWebRecipeInput } from "./webRecipes";
import {
  canonicalWebDocument,
  hashWebDocument,
  renderWebDocument,
  validateWebDocument,
} from "./webRuntime";

function png(width = 2, height = 1): Uint8Array {
  const chunk = (type: string, body: Uint8Array) => {
    const b = Buffer.alloc(body.length + 12);
    b.writeUInt32BE(body.length);
    b.write(type, 4);
    b.set(body, 8);
    let c = 0xffffffff;
    for (const n of b.subarray(4, -4)) {
      c ^= n;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    b.writeUInt32BE((c ^ 0xffffffff) >>> 0, b.length - 4);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255, 0, 255, 0, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const digest = "a".repeat(64),
  heroRef = `webasset:hero_owned:${digest}`,
  logoRef = `webasset:logo_owned:${"b".repeat(64)}`;
const base = {
  brandName: "Fieldwork",
  headline: "Gardens made for living",
  summary: "Landscape planning for homeowners.",
  ctaLabel: "Discuss your garden",
  ctaHref: "https://fieldwork.example/contact",
};
const media = {
  logo: { storageRef: logoRef, alt: "Fieldwork logo" },
  hero: {
    storageRef: heroRef,
    alt: "Illustration of a garden concept",
    crop: "cover" as const,
    aspect: "landscape" as const,
    focalPoint: { x: 38, y: 42 },
  },
  gallery: [
    {
      storageRef: heroRef,
      alt: "A second view of the selected illustration",
      aspect: "square" as const,
    },
  ],
};

describe("immutable prepared public web assets", () => {
  test("reads a real PNG fixture and binds the exact byte digest", () => {
    const bytes = readFileSync(
      new URL("../../../apps/web/e2e/fixtures/online-presence/design-study.png", import.meta.url),
    );
    expect(inspectWebAssetBytes(bytes, "image/png")).toMatchObject({
      mimeType: "image/png",
      byteLength: bytes.length,
      contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    });
    expect(inspectWebAssetBytes(png(), "image/png")).toMatchObject({ width: 2, height: 1 });
  });
  test("refuses mislabeled, active, truncated, corrupt, oversized and excessive-dimension files", () => {
    for (const [bytes, mime] of [
      [png(), "image/jpeg"],
      [Buffer.from('<svg onload="alert(1)"></svg>'), "image/png"],
      [png().slice(0, -1), "image/png"],
      [new Uint8Array(5 * 1024 * 1024 + 1), "image/png"],
      [png(8193), "image/png"],
      [png(5000, 5000), "image/png"],
    ] as const)
      expect(() => inspectWebAssetBytes(bytes, mime)).toThrow("WEB_ASSET_INVALID");
    const corrupt = png();
    corrupt[20] = (corrupt[20] ?? 0) ^ 1;
    expect(() => inspectWebAssetBytes(corrupt, "image/png")).toThrow("WEB_ASSET_INVALID");
    expect(() =>
      inspectWebAssetBytes(
        Buffer.from([255, 216, 255, 192, 255, 255, 1, 2, 3, 4, 255, 217]),
        "image/jpeg",
      ),
    ).toThrow("WEB_ASSET_INVALID");
  });
  test("only derives local scoped routes from closed hash-bound references", () => {
    expect(parseWebAssetRef(heroRef)).toEqual({
      assetId: "hero_owned",
      digest,
      contentHash: `sha256:${digest}`,
    });
    expect(webAssetPath(heroRef, "fieldwork")).toBe(`/p/fieldwork/assets/hero_owned/${digest}`);
    for (const bad of [
      "https://example.com/a.png",
      "data:image/png;base64,AA",
      `webasset:../secret:${digest}`,
      `webasset:x:${digest.toUpperCase()}`,
      `webasset:x:${digest.slice(1)}`,
    ])
      expect(parseWebAssetRef(bad)).toBeNull();
    expect(webAssetPath(heroRef, "../secret")).toBeNull();
  });
  test("materializes real image roles, safe crop and logo in all three art directions", () => {
    for (const artDirection of ["editorial", "studio", "technical"] as const) {
      const result = materializeWebRecipeWithProvenance("business-site", {
        ...base,
        artDirection,
        media,
      });
      const html = renderDesignedWebDocument(result.document, result.designProfile, {
        slug: "fieldwork",
        page: "home",
      });
      expect(collectWebAssetRefs(result.document)).toEqual([heroRef, logoRef].sort());
      expect(html).toContain(`data-asset-ref="${heroRef}"`);
      expect(html).toContain(`data-asset-ref="${logoRef}"`);
      expect(html).toContain(`src="/p/fieldwork/assets/hero_owned/${digest}"`);
      expect(html).toContain("hero-rail hero-visual");
      expect(html).toContain("object-position:38% 42%");
      expect(html).toContain('alt="Illustration of a garden concept"');
      expect(html).toContain('id="gallery"');
      expect(html).toContain('loading="eager"');
      expect(html).toContain('loading="lazy"');
      expect(html).not.toContain('src="https:');
      expect(renderWebDocument(result.document, { slug: "fieldwork", page: "home" })).toContain(
        `data-asset-ref="${logoRef}"`,
      );
    }
  });
  test("omits absent imagery gracefully and never resolves legacy storage refs", () => {
    const result = materializeWebRecipeWithProvenance("business-site", base);
    expect(renderDesignedWebDocument(result.document, result.designProfile)).not.toContain("<img");
    const legacy = {
      ...result.document,
      pages: result.document.pages.map((p) => ({
        ...p,
        nodes: [
          ...p.nodes,
          { kind: "media" as const, storageRef: "storage:legacy", alt: "Legacy source" },
        ],
      })),
    };
    expect(validateWebDocument(legacy).ok).toBe(true);
    expect(collectWebAssetRefs(legacy)).toEqual([]);
    expect(renderWebDocument(legacy)).not.toContain("<img");
  });
  test("hash covers image bytes identity, crop and accessible description", () => {
    const result = materializeWebRecipeWithProvenance("business-site", { ...base, media });
    for (const change of [
      { ...media, hero: { ...media.hero, storageRef: `webasset:hero_owned:${"c".repeat(64)}` } },
      { ...media, hero: { ...media.hero, crop: "contain" as const } },
      { ...media, hero: { ...media.hero, alt: "A truthful revised description" } },
    ]) {
      const revised = materializeWebRecipeWithProvenance("business-site", {
        ...base,
        media: change,
      });
      expect(canonicalWebDocument(revised.document)).not.toBe(
        canonicalWebDocument(result.document),
      );
      expect(hashWebDocument(revised.document)).not.toBe(hashWebDocument(result.document));
    }
  });
  test("rejects arbitrary sources, invalid placement/crop/focal and gallery bounds", () => {
    for (const invalid of [
      { hero: { storageRef: "storage:untrusted", alt: "x" } },
      { hero: { storageRef: "https://example.com/a.png", alt: "x" } },
      { hero: { ...media.hero, alt: "" } },
      { hero: { ...media.hero, crop: "url(x)" } },
      { hero: { ...media.hero, placement: "gallery" } },
      { hero: { ...media.hero, focalPoint: { x: 101, y: 50 } } },
      { hero: { ...media.hero, focalPoint: { x: NaN, y: 50 } } },
      { gallery: Array.from({ length: 7 }, () => media.hero) },
      { logo: { ...media.logo, crop: "cover" } },
    ])
      expect(validateWebRecipeInput("business-site", { ...base, media: invalid }).ok).toBe(false);
  });
  test("enforces the distinct asset cap and rejects malformed refs before rendering", () => {
    const original = materializeWebRecipeWithProvenance("business-site", base).document;
    const nodes = Array.from({ length: 9 }, (_, i) => ({
      kind: "media" as const,
      storageRef: `webasset:asset_${i}:${digest}`,
      alt: `Selected image ${i}`,
    }));
    const overflow = { ...original, pages: [{ slug: "home", title: "Home", nodes }] };
    expect(() => collectWebAssetRefs(overflow)).toThrow("WEB_ASSET_LIMIT");
    expect(validateWebDocument(overflow).ok).toBe(false);
    const malformed = {
      ...original,
      brand: { ...original.brand, logo: { storageRef: "webasset:bad", alt: "Logo" } },
    };
    expect(() => collectWebAssetRefs(malformed)).toThrow("WEB_ASSET_REF_INVALID");
    expect(validateWebDocument(malformed).ok).toBe(false);
  });
  test("service mapper preserves prepared media while source ownership stays adapter-controlled", () => {
    const source = {
      ref: "vault:illustration",
      kind: "vault" as const,
      revision: "sha256:1",
      text: "Owned image selected for private website draft.",
      intent: "current" as const,
      status: "approved" as const,
      visibility: "private" as const,
    };
    const assessment = assessOnlinePresenceBrief(
      {
        kind: "website",
        businessName: "Fieldwork",
        headline: base.headline,
        summary: base.summary,
        audience: "Homeowners",
        media,
        sourceRefs: [source.ref],
      },
      [source],
    );
    expect(assessment.ok).toBe(true);
    if (!assessment.ok) throw new Error("Expected private draft");
    expect(assessment.input.media).toEqual(media);
    expect(assessment.warnings).toContainEqual({ code: "private_source", sourceRef: source.ref });
  });
  test("asset rows and copied bytes participate in tenant export and erasure", () => {
    expect(TENANT_TABLE_CLASSIFICATION.webAssets).toBe("tenant_owned");
    expect(deletableTables()).toContain("webAssets");
    expect(
      storageIdsIn("webAssets", {
        storageId: "owned_copy",
        sourceStorageId: "must_not_delete_source_via_snapshot",
      }),
    ).toEqual(["owned_copy"]);
    expect(
      storageIdsIn("webProjectVersions", { assetSnapshots: [{ storageId: "not_a_blob_owner" }] }),
    ).toEqual([]);
  });
});
