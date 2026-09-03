import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import skillsLock from "../../../backend/skills-lock.json";
import {
  BUSINESS_BLUEPRINT_SKILL,
  DOCUMENT_CLASSIFIER_SKILL,
  FOLDER_DIGEST_SKILL,
  isGatedSkill,
  MEDIA_DIRECTOR_SKILL,
} from "../skill";
import { bmcSkillBody } from "./bmc";
import { businessBlueprintSkillBody } from "./businessBlueprint";
import { cockpitAgentSkillBody } from "./cockpitAgent";
import { documentAnalystSkillBody } from "./documentAnalyst";
import { documentClassifierSkillBody } from "./documentClassifier";
import { folderDigestSkillBody } from "./folderDigest";
import { growthOsDiagnosticSkillBody } from "./growthOsDiagnostic";
import { leadEngineSkillBody } from "./leadEngine";
import { leanCanvasSkillBody } from "./leanCanvas";
import { mediaDirectorSkillBody } from "./mediaDirector";
import { moneyModelDesignerSkillBody } from "./moneyModelDesigner";
import { offerArchitectSkillBody } from "./offerArchitect";
import { onboardingAgentSkillBody } from "./onboardingAgent";
import { packBrandReviewSkillBody } from "./packBrandReview";
import { packBusinessPulseSkillBody } from "./packBusinessPulse";
import { packCampaignPlanSkillBody } from "./packCampaignPlan";
import { packCustomerComplaintSkillBody } from "./packCustomerComplaint";
import { packProcessSopSkillBody } from "./packProcessSop";
import { packSalesCallPrepSkillBody } from "./packSalesCallPrep";
import { researchSpecialistSkillBody } from "./researchSpecialist";
import { revenueSkillBodies } from "./revenueBodies";
import { styleCoachingSkillBody } from "./styleCoaching";
import { styleConciseSkillBody } from "./styleConcise";
import { styleDirectSkillBody } from "./styleDirect";
import { swotSkillBody } from "./swot";

// Every derived .ts body MUST stay byte-identical (LF-normalized) to its canonical
// .md source — the derived constant is the bundler-safe artifact the Convex runtime
// ships, generated FROM the .md; drift means a stale prompt. Mirrors the
// skills.test.ts "no drift" precedent, scoped to the Phase 12 (BEVL-01) skill bodies.
const lf = (s: string) => s.replace(/\r\n/g, "\n");

const revenueBodies = {
  "revenue-specialist": {
    bytes: 2192,
    sha256: "558cca103e7c298472a7d9f1ff4cd48651c4b08388f4ebadb2dd0ff63c082b24",
    sources: ["small-business/skills/business-pulse", "sales/skills/call-prep"],
    required: [
      "lead triage",
      "call list",
      "pipeline review",
      "customer pulse",
      "cash flow",
      "payroll confidence",
      "invoice reminder",
    ],
  },
  "revenue-lead-triage": {
    bytes: 1658,
    sha256: "640c210f6fff276a32dbcdfd0093e984452b2264b09db1e7683547823734c9f8",
    sources: ["sales/skills/call-prep"],
    required: ["source-provided", "suppressed", "unknown", "stable order"],
  },
  "revenue-call-list": {
    bytes: 1468,
    sha256: "36e760292676ad2a8881cf9d712e78ea595d7f1d9150bbe8a58576d648346c3d",
    sources: ["sales/skills/call-prep"],
    required: ["source-provided", "do not contact", "unknown", "stable order"],
  },
  "revenue-pipeline-review": {
    bytes: 1535,
    sha256: "a64656d37a59c49f3dae91a2b31281673c509249e0ad467f7569766d08920ece",
    sources: ["sales/skills/call-prep"],
    required: ["local follow-up", "provider-owned", "unavailable", "fictional opportunity"],
  },
  "revenue-customer-pulse": {
    bytes: 1586,
    sha256: "258145d3f7a377d3a605524428b6771c5712eb0d9a55112a312abcdc89732300",
    sources: ["small-business/skills/business-pulse"],
    required: ["bounded typed signals", "free text", "partial", "unknown"],
  },
  "revenue-cash-flow": {
    bytes: 1680,
    sha256: "327b4fbfb72e07ddea5765d9e8d6a3ae5bebafd10e29735ea4228a6942829ae9",
    sources: ["small-business/skills/business-pulse"],
    required: ["precomputed", "separate currencies", "coverage", "qualified professional"],
  },
  "revenue-payroll-confidence": {
    bytes: 1740,
    sha256: "f5dcd1736b4b4014b328d58fc77aaa1d9359c9e351e2898bf940687e4d98e80c",
    sources: ["small-business/skills/business-pulse"],
    required: ["precomputed", "confirmed obligation", "unavailable", "qualified professional"],
  },
  "revenue-invoice-reminder": {
    bytes: 1771,
    sha256: "2541cadb10404c34b0f08ca85fb17f43a810fe8dab86d5ee43d3582ae6b91899",
    sources: ["small-business/skills/business-pulse", "small-business/skills/ticket-deflector"],
    required: [
      "explicit user intent",
      "proposed",
      "human approval",
      "nothing has been sent",
      "suppression",
    ],
  },
} as const;

const readRevenueBody = (base: keyof typeof revenueBodies) =>
  lf(readFileSync(fileURLToPath(new URL(`../../skills/${base}.md`, import.meta.url)), "utf8"));

describe("Phase 28 provider-neutral revenue bodies (REVN-04..06)", () => {
  test("the candidate lock pins every reviewed body at immutable v1", () => {
    const candidates = skillsLock.revenueCandidates.candidates;
    expect(candidates.map((candidate) => candidate.name)).toEqual(Object.keys(revenueBodies));

    for (const candidate of candidates) {
      const contract = revenueBodies[candidate.name as keyof typeof revenueBodies];
      const body = readRevenueBody(candidate.name as keyof typeof revenueBodies);
      expect(candidate).toMatchObject({
        version: 1,
        status: "candidate",
        bodyPath: `packages/contracts/skills/${candidate.name}.md`,
        bodyBytes: contract.bytes,
        bodySha256: contract.sha256,
        sourceRepo: "https://github.com/anthropics/knowledge-work-plugins",
        sourceCommit: "5267cf7bff3031921d4474b8e8f86ad02d2b8f6d",
        license: "Apache-2.0",
      });
      expect(createHash("sha256").update(body).digest("hex")).toBe(candidate.bodySha256);
      expect(Buffer.byteLength(body, "utf8")).toBe(candidate.bodyBytes);
      expect(lf(revenueSkillBodies[candidate.name] ?? "")).toBe(body);
      expect(candidate.sourcePaths.length).toBeGreaterThan(0);
      expect(candidate.modificationNotice.trim()).not.toBe("");
      expect(candidate).not.toHaveProperty("tools");
      expect(candidate).not.toHaveProperty("grants");
      expect(candidate).not.toHaveProperty("discoverable");
    }
  });

  test("the owner judgment approves only the three green exact pins and parks every red pin", () => {
    const candidates = skillsLock.revenueCandidates.candidates;
    const approved = candidates
      .filter((candidate) => candidate.activationDecision.decision === "approve")
      .map((candidate) => `${candidate.name}@${candidate.version}`)
      .sort();
    const parked = candidates
      .filter((candidate) => candidate.activationDecision.decision === "park")
      .map((candidate) => `${candidate.name}@${candidate.version}`)
      .sort();

    expect(approved).toEqual([
      "revenue-call-list@1",
      "revenue-lead-triage@1",
      "revenue-specialist@1",
    ]);
    expect(parked).toEqual([
      "revenue-cash-flow@1",
      "revenue-customer-pulse@1",
      "revenue-invoice-reminder@1",
      "revenue-payroll-confidence@1",
      "revenue-pipeline-review@1",
    ]);
    for (const candidate of candidates) {
      expect(candidate.activationDecision.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(candidate.activationDecision.reason.trim()).not.toBe("");
      // Publication stays candidate-only. A decision must never make a fresh deployment auto-live.
      expect(candidate.status).toBe("candidate");
    }
  });

  test.each(
    Object.entries(revenueBodies),
  )("%s has reviewed byte pins and the Phase 27 provenance notice", (base, contract) => {
    const body = readRevenueBody(base as keyof typeof revenueBodies);

    expect(createHash("sha256").update(body).digest("hex")).toBe(contract.sha256);
    expect(Buffer.byteLength(body, "utf8")).toBe(contract.bytes);
    expect(body).toContain("## Provenance and modification notice");
    expect(body).toContain("provider-neutral");
    expect(body).toContain("modified");
    expect(body).toContain("Attribution");
    expect(body).toContain("Apache-2.0");
    expect(body).toContain("5267cf7bff3031921d4474b8e8f86ad02d2b8f6d");
    expect(body).toContain(
      "This body describes behavior only; it does not grant tools, scopes, or write authority.",
    );

    for (const source of contract.sources) expect(body).toContain(source);
    for (const phrase of contract.required) {
      expect(body.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });

  test.each(
    Object.keys(revenueBodies),
  )("%s stays provider-neutral and contains no authority-bearing configuration", (base) => {
    const body = readRevenueBody(base as keyof typeof revenueBodies);

    expect(body).not.toMatch(/HubSpot|QuickBooks|Stripe|PayPal/iu);
    expect(body).not.toMatch(/https?:\/\//iu);
    expect(body).not.toMatch(
      /\b(?:OAuth|access token|refresh token|client secret|API key|endpoint|executePlan|generic HTTP|MCP)\b/iu,
    );
    expect(body).not.toMatch(
      /\b(?:refund|credit|dispute|CRM|accounting) (?:write|update|mutation|send|issue)\b/iu,
    );
    expect(body).not.toMatch(
      /\b(?:use|call|invoke|access) (?:the )?(?:tool|API|endpoint|connector)\b/iu,
    );
    expect(body).not.toMatch(/\b(?:tools?|scopes?|capabilities?|credentials?)\s*:/iu);
    expect(body).not.toMatch(/\b(?:publish|activate|discover|register|seed)\b/iu);
    expect(body).not.toMatch(/(?:\$|£|€)\s*\d|\b\d+(?:\.\d+)?\s*(?:USD|GBP|EUR)\b/iu);
    expect(body).not.toMatch(
      /(?:opening cash|closing cash|coverage ratio|payroll gap)\s*[=+\-*/]/iu,
    );
    expect(body).not.toMatch(/\b(?:threshold|timeout|retry|lookback)\s*(?:=|:)\s*\d/iu);
  });

  test("finance bodies explain immutable deterministic results instead of asking the model to calculate", () => {
    for (const base of ["revenue-cash-flow", "revenue-payroll-confidence"] as const) {
      const body = readRevenueBody(base);
      expect(body).toContain(
        "Do not calculate, total, age, forecast, repair, reconcile, or convert",
      );
      expect(body).toContain("Missing history and missing sources are unknown, never zero.");
      expect(body).toContain("decision support, not accounting or tax advice");
    }
  });

  test("the reminder body terminates at an ordinary proposed draft", () => {
    const body = readRevenueBody("revenue-invoice-reminder");
    expect(body).toContain("ordinary email plan");
    expect(body).toContain("remains `proposed`");
    expect(body).toContain("Only the existing human approval path may move it onward");
    expect(body).toContain("Re-check consent and suppression at the existing delivery terminal");
  });
});

// [canonical .md basename, derived constant]
const bodies: [string, string][] = [
  ["growth-os-diagnostic", growthOsDiagnosticSkillBody],
  ["swot", swotSkillBody],
  ["lean-canvas", leanCanvasSkillBody],
  ["bmc", bmcSkillBody],
  ["offer-architect", offerArchitectSkillBody],
  ["money-model-designer", moneyModelDesignerSkillBody],
  ["lead-engine", leadEngineSkillBody],
  // Phase 16 (DISP-02/ACTN-03): the research specialist body.
  ["research-specialist", researchSpecialistSkillBody],
  // Phase 20 (MEDIA-01): the media specialist body. The drift row matters here because the .md
  // carries a WORKED EXAMPLE that storyboard.test.ts parses — a stale .ts would ship a body whose
  // example no longer matches the parser the round-trip test certified.
  ["media-director", mediaDirectorSkillBody],
  // 15.1-05 (design §7): the three UNGATED behaviour-preset style overlays. Same mirror, same
  // reason — the `.md` is what a human edits, the `.ts` is what the Convex runtime ships, and a
  // half-applied mirror would silently seed a stale overlay.
  ["style-direct", styleDirectSkillBody],
  ["style-coaching", styleCoachingSkillBody],
  ["style-concise", styleConciseSkillBody],
  // 15.1-06 (design §6): the UNGATED conversational onboarding system prompt. Same mirror — and
  // the drift row matters most here, because `converse` fails CLOSED on an unseeded row: a stale
  // derived constant seeds a stale prompt rather than a loud error.
  ["onboarding-agent", onboardingAgentSkillBody],
  // Phase 14 (DOCV-01) — the voice-doc persona rides the same drift guard.
  ["document-analyst", documentAnalystSkillBody],
  // Phase 17.1 (BLPR-01): the UNGATED corpus-synthesis prompt. Same mirror — and the drift row
  // matters here because the synthesis action loads it FAIL-CLOSED: a stale derived constant seeds
  // a stale prompt rather than a loud error.
  ["business-blueprint", businessBlueprintSkillBody],
  // 15.3-06 (VALT-08): the UNGATED folder-digest synthesis prompt. There is NO generator script —
  // the .ts is hand-derived — so this row is the only thing that turns an edit to one side into a
  // failure instead of a silently stale seeded prompt. It also guards the three-part OUTPUT
  // CONTRACT (what the folder IS / SAYS / could NOT be read), which the digest test asserts against.
  ["folder-digest", folderDigestSkillBody],
  // 15.3-08 (VALT-12): the UNGATED document-classifier prompt. Same hand-derived mirror, and the
  // drift row carries more than freshness here — the .md's OUTPUT CONTRACT lists the twelve
  // `DOC_TYPES` literals VERBATIM, so this row is what turns "the seeded prompt still names the
  // union the schema accepts" into a failure rather than a silent mismatch the coercion layer
  // absorbs as `unclassified`.
  // cockpit-agent was NOT in this list, so its .md and .ts silently drifted (2026-08-10:
  // a body edit landed in the .md, seedSkills published nothing, and the gate would have
  // measured the OLD body). It is the most-edited body in the repo; it belongs here most.
  ["cockpit-agent", cockpitAgentSkillBody],
  ["document-classifier", documentClassifierSkillBody],
  // Phase 27 (PACK-02): the curated knowledge-work pack bodies. This row is not optional
  // bookkeeping — there is NO generator for the derived `.ts`, so it is the ONLY thing that turns
  // an edit to one side into a failure rather than a silently stale constant. It matters more here
  // than for most: 27-01's manifest hashes pin the `.md`, and `publishPackCandidate` ships the
  // `.ts`, so a drifted pair means the body we certified and the body we published are different
  // files. 27-05 and 27-06 append their four here.
  ["pack-business-pulse", packBusinessPulseSkillBody],
  ["pack-campaign-plan", packCampaignPlanSkillBody],
  // 27-05: the two best-supported packs — their primary inputs are real agent tools.
  ["pack-customer-complaint", packCustomerComplaintSkillBody],
  ["pack-sales-call-prep", packSalesCallPrepSkillBody],
  // 27-06: the last two. Brand Review is the most capability-starved pack in the pilot and ships
  // anyway, with its blind spot stated in its own first output section.
  ["pack-process-sop", packProcessSopSkillBody],
  ["pack-brand-review", packBrandReviewSkillBody],
];

describe("evaluation/specialist skill bodies (BEVL-01) — md ↔ ts no-drift", () => {
  test.each(
    bodies,
  )("%s.md === its derived constant (byte-identical, LF-normalized)", (base, body) => {
    const mdPath = fileURLToPath(new URL(`../../skills/${base}.md`, import.meta.url));
    expect(lf(body)).toBe(lf(readFileSync(mdPath, "utf8")));
  });
});

// Phase 17.1 (BLPR-01). This is not a style preference — gating `business-blueprint` DEADLOCKS it
// at v1, because run-eval-golden.mjs hard-validates `--skill` against a closed name list and cannot
// drive the synthesis path, so no runner could ever clear the gate on a body edit. A future "tidy
// up the gate list" edit must fail HERE rather than in production.
describe("business-blueprint gating (17.1-02)", () => {
  test("is DELIBERATELY UNGATED — do not add it to GATED_SKILLS", () => {
    expect(isGatedSkill(BUSINESS_BLUEPRINT_SKILL)).toBe(false);
  });
});

// Phase 20 (MEDIA-01). Same mechanism, same deadlock: the golden runner drives runCockpitAgent over
// TEXT fixtures and structurally cannot exercise a script/art-direction/storyboard turn, so gating
// media-director would strand it at v1 on its first body edit. And the guarantees that matter are
// CODE, not prose — searchVault is its only grant, the narration band is enforced by the parser,
// and the model comes from a price table the body cannot name into. A future "tidy up the gate
// list" edit must fail HERE, not in production.
describe("media-director gating (20-03)", () => {
  test("is DELIBERATELY UNGATED — do not add it to GATED_SKILLS", () => {
    expect(isGatedSkill(MEDIA_DIRECTOR_SKILL)).toBe(false);
  });
});

// 15.3-06 (VALT-08). Same mechanism, same deadlock: run-eval-golden.mjs derives its --skill list
// from GATED_SKILLS and drives runCockpitAgent over TEXT fixtures. A folder digest is fed a folder
// manifest plus bounded per-member excerpts, which no text fixture can assemble — so gating this
// would strand it at v1 on its first body edit, with no runner able to clear the gate. A future
// "tidy up the gate list" edit must fail HERE, not in production.
describe("folder-digest gating (15.3-06)", () => {
  test("is DELIBERATELY UNGATED — do not add it to GATED_SKILLS", () => {
    expect(isGatedSkill(FOLDER_DIGEST_SKILL)).toBe(false);
  });
});

// 15.3-08 (VALT-12). Same mechanism, same deadlock: run-eval-golden.mjs derives its --skill list
// from GATED_SKILLS and drives runCockpitAgent over TEXT fixtures. This skill runs INSIDE the
// ingestDoc workflow on a stored document's redacted head slice, which no text fixture can reach —
// so gating it would strand it at v1 on its first body edit, with no runner able to clear the gate.
// And what matters here is CODE: the returned docType is coerced to `unclassified` unless it is a
// member of the closed union, so no body edit can widen what reaches the table. A future "tidy up
// the gate list" edit must fail HERE, not in production.
describe("document-classifier gating (15.3-08)", () => {
  test("is DELIBERATELY UNGATED — do not add it to GATED_SKILLS", () => {
    expect(isGatedSkill(DOCUMENT_CLASSIFIER_SKILL)).toBe(false);
  });
});
