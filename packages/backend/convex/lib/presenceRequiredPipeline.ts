import type { WebDocument } from "@pikar/contracts/webRuntime";
import { validateDesignProfileRef } from "@pikar/core/designKnowledge";
import { assessWebQuality } from "@pikar/core/webQuality";
import { canonicalWebDocument, sha256Bytes, validateWebDocument } from "@pikar/core/webRuntime";

/** Candidate contract for the required design chain. It deliberately cannot publish a site.
 * A native importer and browser fidelity verifier must supply independently checked receipts
 * before this pipeline may be attached to the customer build tool. */
export const REQUIRED_PRESENCE_DESIGN_POLICY = {
  version: "stitch-kimi-required-v1",
  status: "candidate" as const,
  providers: ["stitch", "or/moonshotai/kimi-k3.1-pro"] as const,
  fallbackAllowed: false,
  automaticRetries: 0,
  activationBlockers: [
    "tenant_budgeted_provider_runner",
    "stitch_layout_fidelity_mapping",
    "exact_artifact_browser_fidelity_review",
  ] as const,
};

export type PresenceDesignScope = {
  tenantId: string;
  planId: string;
  revision: number;
  briefHash: string;
  sourceHash: string;
};
export type RequiredDesignPhase = "claimed" | "stitch_complete" | "kimi_complete" | "stopped";
const hashPattern = /^[a-f0-9]{64}$/;
export const validDesignHash = (value: unknown): value is string =>
  typeof value === "string" && hashPattern.test(value);

export function requiredDesignTransition(
  previous: RequiredDesignPhase,
  next: RequiredDesignPhase,
): boolean {
  if (previous === "stopped" || previous === "kimi_complete") return false;
  return (
    next === "stopped" ||
    (previous === "claimed" && next === "stitch_complete") ||
    (previous === "stitch_complete" && next === "kimi_complete")
  );
}

export type RequiredDesignServices = {
  /** Atomically claims this exact tenant/context and admits the existing budget before any call. */
  claim(scope: PresenceDesignScope): Promise<void>;
  assertCurrent(scope: PresenceDesignScope): Promise<void>;
  stitch(scope: PresenceDesignScope): Promise<{ designHash: string; html: string }>;
  kimi(
    scope: PresenceDesignScope,
    reference: { designHash: string; html: string },
  ): Promise<{
    model: string;
    text: string;
  }>;
  /** Checks facts, asset ownership, destination/consent and commerce authority against frozen sources. */
  validateBusinessContent(document: WebDocument): Promise<boolean>;
  render(document: WebDocument, profile: unknown): Promise<{ pageSlug: string; html: string }[]>;
  routeSlug: string;
  record(
    phase: Exclude<RequiredDesignPhase, "claimed">,
    hashes: {
      designHash?: string;
      proposalHash?: string;
      documentHash?: string;
      artifactsHash?: string;
      reason?: string;
    },
  ): Promise<void>;
};

/** Dependency boundary, not a second unbudgeted model loop. No fallback or hidden retries. */
export async function runRequiredPresenceDesign(
  scope: PresenceDesignScope,
  services: RequiredDesignServices,
) {
  if (
    !scope.tenantId ||
    !scope.planId ||
    !Number.isSafeInteger(scope.revision) ||
    scope.revision < 0 ||
    !validDesignHash(scope.briefHash) ||
    !validDesignHash(scope.sourceHash)
  )
    throw Error("PRESENCE_DESIGN_SCOPE_INVALID");
  await services.claim(scope);
  try {
    await services.assertCurrent(scope);
    const design = await services.stitch(scope);
    if (
      !validDesignHash(design.designHash) ||
      new TextEncoder().encode(design.html).length > 2 * 1024 * 1024 ||
      sha256Bytes(new TextEncoder().encode(design.html)) !== design.designHash
    )
      throw Error("PRESENCE_STITCH_EVIDENCE_INVALID");
    await services.record("stitch_complete", { designHash: design.designHash });
    await services.assertCurrent(scope);
    const proposal = await services.kimi(scope, design);
    if (
      proposal.model !== REQUIRED_PRESENCE_DESIGN_POLICY.providers[1] ||
      new TextEncoder().encode(proposal.text).length > 300 * 1024
    )
      throw Error("PRESENCE_KIMI_EVIDENCE_INVALID");
    const parsed = JSON.parse(proposal.text);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.keys(parsed).sort().join() !== "document,profile" ||
      !validateDesignProfileRef(parsed.profile)
    )
      throw Error("PRESENCE_NATIVE_DESIGN_UNSUPPORTED");
    const document = validateWebDocument(parsed.document);
    if (!document.ok || !(await services.validateBusinessContent(document.value)))
      throw Error("PRESENCE_NATIVE_CONTENT_UNVERIFIED");
    const artifacts = await services.render(document.value, parsed.profile);
    const quality = assessWebQuality({
      document: document.value,
      artifacts,
      routeSlug: services.routeSlug,
    });
    if (!quality.ok) throw Error("PRESENCE_NATIVE_QUALITY_FAILED");
    const proposalHash = sha256Bytes(new TextEncoder().encode(proposal.text));
    const documentHash = sha256Bytes(
      new TextEncoder().encode(canonicalWebDocument(document.value)),
    );
    await services.assertCurrent(scope);
    await services.record("kimi_complete", {
      designHash: design.designHash,
      proposalHash,
      documentHash,
      artifactsHash: sha256Bytes(new TextEncoder().encode(JSON.stringify(quality.artifactHashes))),
    });
    return {
      status: "awaiting_browser_fidelity_review" as const,
      designHash: design.designHash,
      proposalHash,
      documentHash,
      document: document.value,
      profile: parsed.profile,
      artifacts,
      quality,
      nativeBuildQualified: false as const,
      publicationAuthorized: false as const,
    };
  } catch {
    // Do not put upstream errors (which may contain credentials or business content) in evidence.
    await services.record("stopped", { reason: "provider_or_context_unavailable" });
    return {
      status: "stopped" as const,
      nativeBuildQualified: false as const,
      publicationAuthorized: false as const,
    };
  }
}
