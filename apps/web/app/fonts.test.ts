import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(resolve(root, "public/fonts/manifest.json"), "utf8"));
const css = readFileSync(resolve(root, "app/fonts.css"), "utf8");
const layout = readFileSync(resolve(root, "app/layout.tsx"), "utf8");

test("vendored font bytes match the official provenance and every CSS asset resolves", () => {
  expect(manifest.assets).toHaveLength(12);
  for (const asset of manifest.assets) {
    const bytes = readFileSync(resolve(root, "public/fonts", asset.file));
    expect(bytes.subarray(0, 4).toString()).toBe("wOF2");
    expect(bytes.length).toBe(asset.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
    expect(new URL(asset.url).hostname).toBe("fonts.gstatic.com");
    expect(css).toContain(`/fonts/${asset.file}`);
  }
  const references = [
    ...new Set([...css.matchAll(/url\(["']?(\/fonts\/[^)"']+)/g)].map((x) => x[1])),
  ];
  expect(references.sort()).toEqual(
    manifest.assets.map((x: { file: string }) => `/fonts/${x.file}`).sort(),
  );
  for (const license of manifest.licenses) {
    expect(readFileSync(resolve(root, "public/fonts", license.file), "utf8")).toContain(
      "SIL OPEN FONT LICENSE Version 1.1",
    );
  }
});

test("brand weights, multilingual subsets, fallback metrics and latin preloads survive without Google loaders", () => {
  const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((x) => x[1] ?? "");
  for (const [family, weights, subsets] of [
    ["Bricolage Grotesque", [600, 700, 800], 3],
    ["Public Sans", [400, 500, 600], 3],
    ["JetBrains Mono", [400, 500], 6],
  ] as const) {
    const own = faces.filter((x) => new RegExp(`font-family:\\s*["']?${family}["']?;`).test(x));
    expect(own).toHaveLength(weights.length * subsets);
    for (const weight of weights)
      expect(own.filter((x) => new RegExp(`font-weight:\\s*${weight};`).test(x))).toHaveLength(
        subsets,
      );
    for (const face of own) {
      expect(face).toMatch(/unicode-range:/);
      expect(face).toMatch(/font-display:\s*swap/);
    }
  }
  expect(faces).toHaveLength(33);
  for (const adjustment of ["105.43%", "104.87%", "134.59%"]) expect(css).toContain(adjustment);
  expect(layout).not.toContain("next/font/google");
  expect(css).not.toMatch(/https?:\/\//);
  for (const asset of manifest.assets.filter((x: { preload: boolean }) => x.preload))
    expect(layout).toContain(`/fonts/${asset.file}`);
  expect(manifest.assets.filter((x: { preload: boolean }) => x.preload)).toHaveLength(3);
});
