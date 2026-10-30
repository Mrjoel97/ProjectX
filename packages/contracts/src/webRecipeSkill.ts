/**
 * Phase 49's three bounded web recipes.  This is deliberately a separate closed family: the
 * agent golden runner cannot execute recipe definitions and workflow-pack evidence certifies a
 * different runtime, so adding these names to either suite would create a false gate.
 */
export const WEB_RECIPE_SKILL_NAMES = [
  "web-recipe-business-site",
  "web-recipe-campaign-landing",
  "web-recipe-storefront-catalogue",
] as const;
export type WebRecipeSkillName = (typeof WEB_RECIPE_SKILL_NAMES)[number];

export const WEB_RECIPE_EVAL_RUNNER = "eval:web-recipe-deterministic" as const;
export const WEB_RECIPE_EVAL_FIXTURE_HASH =
  "fc9ff50300ef7de36d4b2e7f28ea32518e10d7f2ad4e18d258ec6e80caa2b379" as const;
export const WEB_RECIPE_EVAL_IMPLEMENTATION_HASH =
  "63c118b4b87993bb3cd32c8b4332c50f220005cc26ffb57cba2a243b2a2e5d20" as const;
export const WEB_RECIPE_BROWSER_RUNNER = "playwright:web-recipe" as const;
export const WEB_RECIPE_BROWSER_ROUTE = "/ops" as const;
export const WEB_RECIPE_BROWSER_EVIDENCE_REVISION = "browser-observed-v5" as const;
export const WEB_RECIPE_BROWSER_LANE_OUTCOMES = [
  "selected",
  "partial",
  "refusal",
  "recovery",
  "edit",
  "preview",
] as const;
export const WEB_RECIPE_BROWSER_EVIDENCE_OUTCOME_REFS = Object.freeze([
  "selected",
  "partial",
  "refusal",
  "recovery",
  "edit",
  "preview",
  "storefront-private",
] as const);
export const WEB_RECIPE_PROVENANCE_SCHEMA = "web-recipe-provenance-v1" as const;

/** Canonical case identities shared by the evaluator and its offline self-check. */
export const WEB_RECIPE_EVAL_CASE_IDS = Object.freeze([
  "business-site.positive",
  "business-site.partial",
  "business-site.required",
  "business-site.unknown",
  "business-site.non-canonical",
  "business-site.max",
  "business-site.one-over",
  "business-site.injection",
  "business-site.cross-family",
  "business-site.changed-version",
  "business-site.changed-body",
  "business-site.changed-bundle",
  "business-site.repeat",
  "business-site.design-dial",
  "business-site.source-coverage",
  "business-site.source-influence",
  "business-site.source-removal",
  "business-site.consent",
  "business-site.attribution",
  "business-site.no-commerce",
  "campaign-landing.positive",
  "campaign-landing.partial",
  "campaign-landing.required",
  "campaign-landing.unknown",
  "campaign-landing.non-canonical",
  "campaign-landing.max",
  "campaign-landing.one-over",
  "campaign-landing.injection",
  "campaign-landing.cross-family",
  "campaign-landing.changed-version",
  "campaign-landing.changed-body",
  "campaign-landing.changed-bundle",
  "campaign-landing.repeat",
  "campaign-landing.design-dial",
  "campaign-landing.source-coverage",
  "campaign-landing.source-influence",
  "campaign-landing.source-removal",
  "campaign-landing.consent",
  "campaign-landing.attribution",
  "campaign-landing.no-commerce",
  "storefront-catalogue.positive",
  "storefront-catalogue.partial",
  "storefront-catalogue.required",
  "storefront-catalogue.unknown",
  "storefront-catalogue.non-canonical",
  "storefront-catalogue.max",
  "storefront-catalogue.one-over",
  "storefront-catalogue.injection",
  "storefront-catalogue.cross-family",
  "storefront-catalogue.changed-version",
  "storefront-catalogue.changed-body",
  "storefront-catalogue.changed-bundle",
  "storefront-catalogue.repeat",
  "storefront-catalogue.design-dial",
  "storefront-catalogue.source-coverage",
  "storefront-catalogue.source-influence",
  "storefront-catalogue.source-removal",
  "storefront-catalogue.consent",
  "storefront-catalogue.attribution",
  "storefront-catalogue.no-commerce",
] as const);

// Small synchronous SHA-256 used only for the compiled contract identity. Keeping this local
// makes the activation predicate deterministic in Convex, where Node's crypto module is absent.
function sha256Utf8(value: string): string {
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bytes = Array.from(new TextEncoder().encode(value));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length + 8) % 64 !== 0) bytes.push(0);
  for (let shift = 7; shift >= 0; shift--) bytes.push((bitLength / 2 ** (shift * 8)) & 0xff);
  let [a, b, c, d, e, f, g, h] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++)
      w[i] =
        ((bytes[offset + i * 4]! << 24) |
          (bytes[offset + i * 4 + 1]! << 16) |
          (bytes[offset + i * 4 + 2]! << 8) |
          bytes[offset + i * 4 + 3]!) >>>
        0;
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!,
        y = w[i - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [aa, bb, cc, dd, ee, ff, gg, hh] = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 64; i++) {
      const s1 = ((ee >>> 6) | (ee << 26)) ^ ((ee >>> 11) | (ee << 21)) ^ ((ee >>> 25) | (ee << 7));
      const ch = (ee & ff) ^ (~ee & gg);
      const temp1 = (hh + s1 + ch + k[i]! + w[i]!) >>> 0;
      const s0 =
        ((aa >>> 2) | (aa << 30)) ^ ((aa >>> 13) | (aa << 19)) ^ ((aa >>> 22) | (aa << 10));
      const maj = (aa & bb) ^ (aa & cc) ^ (bb & cc);
      const temp2 = (s0 + maj) >>> 0;
      [hh, gg, ff, ee, dd, cc, bb, aa] = [
        gg,
        ff,
        ee,
        (dd + temp1) >>> 0,
        cc,
        bb,
        aa,
        (temp1 + temp2) >>> 0,
      ];
    }
    [a, b, c, d, e, f, g, h] = [
      (a + aa) >>> 0,
      (b + bb) >>> 0,
      (c + cc) >>> 0,
      (d + dd) >>> 0,
      (e + ee) >>> 0,
      (f + ff) >>> 0,
      (g + gg) >>> 0,
      (h + hh) >>> 0,
    ];
  }
  return [a, b, c, d, e, f, g, h].map((word) => word.toString(16).padStart(8, "0")).join("");
}

/** The exact upstream identity selected by the offline Plan 49-01 compiler. */
export const WEB_RECIPE_UPSTREAM_PROVENANCE = {
  "web-recipe-business-site": [
    {
      repository: "ui-ux-pro-max",
      commit: "dcc40ff5133ef78276117db0cc34e7b83cc8aeba",
      paths: [
        ".claude/skills/ui-ux-pro-max/data/styles.csv",
        ".claude/skills/ui-ux-pro-max/data/ux-guidelines.csv",
        ".claude/skills/ui-ux-pro-max/data/typography.csv",
        ".claude/skills/ui-ux-pro-max/data/landing.csv",
      ],
      hashes: [
        "a93a4d9d7025856575d7b7583bda020be9043013432c5af7c58af9dbdfb206b7",
        "ff81ec613f70ba9fc3fcce52dbe4ae35d44b2079dbe6dc066d2d6e38c28facd5",
        "321fc446e89024488ebae96dda93efc4d2307bd8bddb240857ad51364f6782c8",
        "9a2edd3bb676c2a58f00ade7a062e285222d4297bfd847c8d5b056f0dbbf52d0",
      ],
    },
    {
      repository: "taste-skill",
      commit: "5217fb45be2c0b302f29c9cd31cbd3237501c684",
      paths: ["skills/taste-skill/SKILL.md"],
      hashes: ["aa194351b246b8b4799099d4ed7b033d29eab6e6e3d58d8d2172978be7b3ec89"],
    },
    {
      repository: "nexscope-ecommerce",
      commit: "ee0fb29433d02ccc22e3e6cea9ab4586d49fd42e",
      paths: ["ecommerce-landing-page/SKILL.md", "product-description-generator/SKILL.md"],
      hashes: [
        "b3685198fa75b407bb97467438bf758a50f1d895bdbee0441e1ca4345ab77bf7",
        "2c868d8c6d436d2f10c48da44ae92ae76aa1e68cb5dcc0ca4122c9ee4beccc69",
      ],
    },
  ],
  "web-recipe-campaign-landing": [
    {
      repository: "ui-ux-pro-max",
      commit: "dcc40ff5133ef78276117db0cc34e7b83cc8aeba",
      paths: [
        ".claude/skills/ui-ux-pro-max/data/styles.csv",
        ".claude/skills/ui-ux-pro-max/data/ux-guidelines.csv",
        ".claude/skills/ui-ux-pro-max/data/typography.csv",
        ".claude/skills/ui-ux-pro-max/data/landing.csv",
      ],
      hashes: [
        "a93a4d9d7025856575d7b7583bda020be9043013432c5af7c58af9dbdfb206b7",
        "ff81ec613f70ba9fc3fcce52dbe4ae35d44b2079dbe6dc066d2d6e38c28facd5",
        "321fc446e89024488ebae96dda93efc4d2307bd8bddb240857ad51364f6782c8",
        "9a2edd3bb676c2a58f00ade7a062e285222d4297bfd847c8d5b056f0dbbf52d0",
      ],
    },
    {
      repository: "taste-skill",
      commit: "5217fb45be2c0b302f29c9cd31cbd3237501c684",
      paths: ["skills/taste-skill/SKILL.md"],
      hashes: ["aa194351b246b8b4799099d4ed7b033d29eab6e6e3d58d8d2172978be7b3ec89"],
    },
    {
      repository: "nexscope-ecommerce",
      commit: "ee0fb29433d02ccc22e3e6cea9ab4586d49fd42e",
      paths: [
        "ecommerce-landing-page/SKILL.md",
        "product-description-generator/SKILL.md",
        "conversion-rate-optimization/SKILL.md",
      ],
      hashes: [
        "b3685198fa75b407bb97467438bf758a50f1d895bdbee0441e1ca4345ab77bf7",
        "2c868d8c6d436d2f10c48da44ae92ae76aa1e68cb5dcc0ca4122c9ee4beccc69",
        "8c8815336665c4d585b14b1bbbdb72185a108e1b98740074181be419e4ed97c6",
      ],
    },
  ],
  "web-recipe-storefront-catalogue": [
    {
      repository: "ui-ux-pro-max",
      commit: "dcc40ff5133ef78276117db0cc34e7b83cc8aeba",
      paths: [
        ".claude/skills/ui-ux-pro-max/data/styles.csv",
        ".claude/skills/ui-ux-pro-max/data/colors.csv",
        ".claude/skills/ui-ux-pro-max/data/typography.csv",
      ],
      hashes: [
        "a93a4d9d7025856575d7b7583bda020be9043013432c5af7c58af9dbdfb206b7",
        "8162429222bce22df62b564085946a30d07cc9722c58d0a3a494bd0d1d00841c",
        "321fc446e89024488ebae96dda93efc4d2307bd8bddb240857ad51364f6782c8",
      ],
    },
    {
      repository: "taste-skill",
      commit: "5217fb45be2c0b302f29c9cd31cbd3237501c684",
      paths: ["skills/taste-skill/SKILL.md"],
      hashes: ["aa194351b246b8b4799099d4ed7b033d29eab6e6e3d58d8d2172978be7b3ec89"],
    },
    {
      repository: "nexscope-ecommerce",
      commit: "ee0fb29433d02ccc22e3e6cea9ab4586d49fd42e",
      paths: ["product-description-generator/SKILL.md", "conversion-rate-optimization/SKILL.md"],
      hashes: [
        "2c868d8c6d436d2f10c48da44ae92ae76aa1e68cb5dcc0ca4122c9ee4beccc69",
        "8c8815336665c4d585b14b1bbbdb72185a108e1b98740074181be419e4ed97c6",
      ],
    },
  ],
} as const satisfies Record<WebRecipeSkillName, readonly unknown[]>;

export const WEB_RECIPE_EVAL_SUITE = {
  revision: "2026-10-23.online-presence-quality.v6",
  casesHash: sha256Utf8(`${WEB_RECIPE_EVAL_FIXTURE_HASH}\n${WEB_RECIPE_EVAL_IMPLEMENTATION_HASH}`),
  /** Twenty complete cases per exact candidate family; the corpus contains 60 cases in total. */
  caseCount: 20,
  corpusCaseCount: WEB_RECIPE_EVAL_CASE_IDS.length,
  families: ["business-site", "campaign-landing", "storefront-catalogue"],
} as const;

export const WEB_RECIPE_REQUIRED_VIEWPORTS = ["desktop", "mobile"] as const;

export type WebRecipeEvidenceTarget = {
  readonly skillId: string;
  readonly name: WebRecipeSkillName;
  readonly version: number;
  readonly bodyHash: string;
  readonly definitionHash: string;
};

export type WebRecipeProvenance = {
  readonly schemaVersion: typeof WEB_RECIPE_PROVENANCE_SCHEMA;
  readonly name: WebRecipeSkillName;
  readonly version: number;
  readonly bodySha256: string;
  readonly definitionHash: string;
  readonly bundleHash: string;
  readonly compilerId: string;
  readonly skillVersions: Record<string, number>;
  readonly upstream: readonly unknown[];
};

const exactJson = (value: unknown): string => JSON.stringify(value);
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));
export function webRecipeFamilyForSkill(
  name: WebRecipeSkillName,
): "business-site" | "campaign-landing" | "storefront-catalogue" {
  return name.replace("web-recipe-", "") as
    | "business-site"
    | "campaign-landing"
    | "storefront-catalogue";
}
export function isWebRecipeSkill(name: string): name is WebRecipeSkillName {
  return (WEB_RECIPE_SKILL_NAMES as readonly string[]).includes(name);
}

export function hasValidWebRecipeProvenance(
  provenance: string | undefined,
  target: WebRecipeEvidenceTarget,
  expected: { readonly bundleHash: string; readonly compilerId: string },
): boolean {
  if (provenance === undefined || !isWebRecipeSkill(target.name)) return false;
  try {
    const parsed = JSON.parse(provenance) as Partial<WebRecipeProvenance> & Record<string, unknown>;
    return (
      hasOnlyKeys(parsed, [
        "schemaVersion",
        "name",
        "version",
        "bodySha256",
        "definitionHash",
        "bundleHash",
        "compilerId",
        "skillVersions",
        "upstream",
      ]) &&
      parsed.schemaVersion === WEB_RECIPE_PROVENANCE_SCHEMA &&
      parsed.name === target.name &&
      parsed.version === target.version &&
      parsed.bodySha256 === target.bodyHash &&
      parsed.definitionHash === target.definitionHash &&
      parsed.bundleHash === expected.bundleHash &&
      parsed.compilerId === expected.compilerId &&
      exactJson(parsed.skillVersions) === exactJson({ [target.name]: target.version }) &&
      exactJson(parsed.upstream) === exactJson(WEB_RECIPE_UPSTREAM_PROVENANCE[target.name])
    );
  } catch {
    return false;
  }
}

export function hasPassingWebRecipeEvidence(
  evidence: string | undefined,
  target: WebRecipeEvidenceTarget,
): boolean {
  if (evidence === undefined) return false;
  try {
    const parsed = JSON.parse(evidence) as Record<string, unknown>;
    const suite = parsed.suite as Record<string, unknown> | undefined;
    const coverage = parsed.familyCoverage;
    const family = webRecipeFamilyForSkill(target.name);
    const expectedOutcomeKinds = WEB_RECIPE_EVAL_CASE_IDS.filter((id) =>
      id.startsWith(`${family}.`),
    ).map((id) => id.slice(family.length + 1));
    const outcomes = parsed.outcomes as Record<string, unknown> | undefined;
    return (
      hasOnlyKeys(parsed, [
        "runner",
        "runId",
        "pass",
        "casesPassed",
        "casesTotal",
        "retriedCases",
        "costUsd",
        "model",
        "skillId",
        "name",
        "version",
        "bodyHash",
        "definitionHash",
        "skillVersions",
        "suite",
        "familyCoverage",
        "filtered",
        "skipped",
        "outcomes",
        "ts",
      ]) &&
      suite !== undefined &&
      hasOnlyKeys(suite, ["revision", "casesHash", "caseCount", "corpusCaseCount"]) &&
      parsed.runner === WEB_RECIPE_EVAL_RUNNER &&
      parsed.pass === true &&
      parsed.costUsd === 0 &&
      parsed.skillId === target.skillId &&
      parsed.name === target.name &&
      parsed.version === target.version &&
      parsed.bodyHash === target.bodyHash &&
      parsed.definitionHash === target.definitionHash &&
      exactJson(parsed.skillVersions) === exactJson({ [target.name]: target.version }) &&
      parsed.casesPassed === WEB_RECIPE_EVAL_SUITE.caseCount &&
      parsed.casesTotal === WEB_RECIPE_EVAL_SUITE.caseCount &&
      Array.isArray(parsed.retriedCases) &&
      parsed.retriedCases.length === 0 &&
      suite?.revision === WEB_RECIPE_EVAL_SUITE.revision &&
      suite.casesHash === WEB_RECIPE_EVAL_SUITE.casesHash &&
      suite.caseCount === WEB_RECIPE_EVAL_SUITE.caseCount &&
      suite.corpusCaseCount === WEB_RECIPE_EVAL_SUITE.corpusCaseCount &&
      exactJson(coverage) === exactJson([webRecipeFamilyForSkill(target.name)]) &&
      outcomes !== undefined &&
      hasOnlyKeys(outcomes, expectedOutcomeKinds) &&
      expectedOutcomeKinds.every((kind) => outcomes[kind] === 1) &&
      parsed.filtered === false &&
      parsed.skipped === 0
    );
  } catch {
    return false;
  }
}

export function hasPassingWebRecipeBrowserEvidence(
  evidence: string | undefined,
  target: WebRecipeEvidenceTarget,
): boolean {
  if (evidence === undefined) return false;
  try {
    const parsed = JSON.parse(evidence) as Record<string, unknown>;
    return (
      hasOnlyKeys(parsed, [
        "runner",
        "runId",
        "pass",
        "authenticated",
        "actorClass",
        "route",
        "rendered",
        "skillId",
        "name",
        "version",
        "bodyHash",
        "viewports",
        "casesPassed",
        "casesTotal",
        "revision",
        "outcomeRefs",
        "transcriptHash",
        "bundleHash",
        "definitionHash",
        "evidenceRevision",
        "ts",
      ]) &&
      parsed.runner === WEB_RECIPE_BROWSER_RUNNER &&
      parsed.pass === true &&
      parsed.authenticated === true &&
      parsed.actorClass === "owner" &&
      parsed.route === WEB_RECIPE_BROWSER_ROUTE &&
      parsed.rendered === true &&
      parsed.skillId === target.skillId &&
      parsed.name === target.name &&
      parsed.version === target.version &&
      parsed.bodyHash === target.bodyHash &&
      parsed.evidenceRevision === WEB_RECIPE_BROWSER_EVIDENCE_REVISION &&
      typeof parsed.bundleHash === "string" &&
      /^[a-f0-9]{64}$/.test(parsed.bundleHash) &&
      parsed.definitionHash === target.definitionHash &&
      exactJson(parsed.viewports) === exactJson(WEB_RECIPE_REQUIRED_VIEWPORTS) &&
      parsed.casesPassed === parsed.casesTotal &&
      typeof parsed.casesTotal === "number" &&
      parsed.casesTotal > 0 &&
      typeof parsed.revision === "number" &&
      Number.isInteger(parsed.revision) &&
      parsed.revision > 0 &&
      exactJson(parsed.outcomeRefs) === exactJson(WEB_RECIPE_BROWSER_EVIDENCE_OUTCOME_REFS) &&
      typeof parsed.transcriptHash === "string" &&
      /^[a-f0-9]{64}$/.test(parsed.transcriptHash) &&
      parsed.rawContent === undefined
    );
  } catch {
    return false;
  }
}
