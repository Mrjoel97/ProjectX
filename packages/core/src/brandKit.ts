/** Proposed creative choices are never factual product claims or approved identity. */
export type BrandKit = {
  name: string;
  tagline: string;
  audience: string;
  positioning: string;
  voice: string[];
  palette: { name: string; hex: string }[];
  typography: { heading: string; body: string };
  logoDirection: string;
  imagery: string;
  motion: string;
  examples: string[];
  prohibitedClaims: string[];
};

export function validateBrandKit(value: unknown): BrandKit {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_BRAND_KIT");
  const o = value as Record<string, unknown>;
  const text = (v: unknown, max = 1200): string => {
    if (typeof v !== "string" || !v.trim() || v.length > max) throw new Error("INVALID_BRAND_KIT");
    return v.trim();
  };
  const list = (v: unknown, min = 1): string[] => {
    if (!Array.isArray(v) || v.length < min || v.length > 12) throw new Error("INVALID_BRAND_KIT");
    return v.map((s) => text(s, 500));
  };
  if (!Array.isArray(o.palette) || o.palette.length < 2 || o.palette.length > 8)
    throw new Error("INVALID_BRAND_KIT");
  const typography = o.typography as Record<string, unknown> | undefined;
  if (!typography) throw new Error("INVALID_BRAND_KIT");
  return {
    name: text(o.name, 120),
    tagline: text(o.tagline, 240),
    audience: text(o.audience),
    positioning: text(o.positioning),
    voice: list(o.voice),
    palette: o.palette.map((p) => {
      if (!p || typeof p !== "object" || !/^#[0-9a-f]{6}$/i.test(p.hex))
        throw new Error("INVALID_BRAND_KIT");
      return { name: text(p.name, 80), hex: p.hex.toUpperCase() as string };
    }),
    typography: { heading: text(typography.heading, 120), body: text(typography.body, 120) },
    logoDirection: text(o.logoDirection),
    imagery: text(o.imagery),
    motion: text(o.motion),
    examples: list(o.examples),
    prohibitedClaims: list(o.prohibitedClaims, 0),
  };
}

export function renderBrandKit(kit: BrandKit, revision: number): string {
  return `# Approved brand kit — ${kit.name}\nRevision: ${revision}\n\nThis is approved brand identity, not evidence of product specifications or claims. Product references remain separate per batch item.\n\n${JSON.stringify(kit, null, 2)}\n`;
}

/** Concise visual direction; no claims or product-reference substitution. UTF-8 bounded. */
export function brandImageDirection(kit: BrandKit): string {
  const raw = `Approved brand: ${kit.name}. Palette: ${kit.palette.map((p) => `${p.name} ${p.hex}`).join(", ")}. Voice: ${kit.voice.join(", ")}. Imagery: ${kit.imagery}. Preserve the independently supplied product references.`;
  let result = "";
  let bytes = 0;
  for (const character of raw) {
    bytes += new TextEncoder().encode(character).length;
    if (bytes > 1200) break;
    result += character;
  }
  return result;
}

const string = { type: "string" } as const;
const strings = { type: "array", items: string } as const;
export const brandKitJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: string,
    tagline: string,
    audience: string,
    positioning: string,
    voice: strings,
    palette: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { name: string, hex: string },
        required: ["name", "hex"],
      },
    },
    typography: {
      type: "object",
      additionalProperties: false,
      properties: { heading: string, body: string },
      required: ["heading", "body"],
    },
    logoDirection: string,
    imagery: string,
    motion: string,
    examples: strings,
    prohibitedClaims: strings,
  },
  required: [
    "name",
    "tagline",
    "audience",
    "positioning",
    "voice",
    "palette",
    "typography",
    "logoDirection",
    "imagery",
    "motion",
    "examples",
    "prohibitedClaims",
  ],
} as const;
