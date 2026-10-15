import { type BusinessProfile, type ProfileInput, serializeProfile } from "./businessProfile";

export const FOUNDATION_SECTIONS = [
  "essentials",
  "offers",
  "operations",
  "delivery",
  "goals",
  "constraints",
] as const;
export type FoundationSection = (typeof FOUNDATION_SECTIONS)[number];
export const FOUNDATION_TITLES = {
  essentials: "Business overview",
  offers: "Offers and customers",
  operations: "Operating model",
  delivery: "Sales and delivery process",
  goals: "Goals and metrics",
  constraints: "Constraints and decisions",
} as const;
export type FoundationAnswer = {
  section: FoundationSection;
  text: string;
  eventId: string;
  sourceDocId?: string;
  intent: "current" | "planned";
};
export const FOUNDATION_TRANSCRIPT_TTL = 7 * 24 * 60 * 60 * 1000;
export const FOUNDATION_MAX_ANSWERS = 100;
export const FOUNDATION_MAX_TEXT = 8000;
export const FOUNDATION_MAX_TOTAL_TEXT = 100000;

/** Only user-supplied statements are projected. No speculative prose or extra model call. */
export function renderFoundation(profile: BusinessProfile, answers: readonly FoundationAnswer[]) {
  const known = (text: string) => text.trim() || "Unknown — not yet provided.";
  const base: Record<FoundationSection, string> = {
    essentials: serializeProfile(profile),
    offers: `Offering: ${known(profile.offering)}\n\nCustomers: ${known(profile.targetCustomer)}`,
    operations: "Roles, tools, routines, and dependencies: unknown unless stated below.",
    delivery:
      "Acquisition, sales, fulfillment, support, and handoffs: unknown unless stated below.",
    goals: known(profile.primaryGoals.join("\n")),
    constraints: known(profile.knownConstraints.join("\n")),
  };
  return FOUNDATION_SECTIONS.map((section) => ({
    section,
    title: FOUNDATION_TITLES[section],
    kind: section === "essentials" ? "business_profile" : `business_foundation_${section}`,
    text: `${section === "essentials" ? "" : `# ${FOUNDATION_TITLES[section]}\n\n`}${base[section]}\n\n## User statements and provenance\n${
      answers
        .filter((a) => a.section === section)
        .map(
          (a) =>
            `\n### ${a.intent === "planned" ? "Intended future practice" : "User-stated information"} [source: ${a.eventId}${a.sourceDocId ? `; document: ${a.sourceDocId}` : ""}]\n${a.text}`,
        )
        .join("\n") || "\nNo additional information provided."
    }\n`,
  }));
}

export function emptyFoundationProfile(): ProfileInput {
  return {
    name: "",
    oneLineDescription: "",
    stage: "",
    offering: "",
    targetCustomer: "",
    primaryGoals: [],
    knownConstraints: [],
  };
}

export const SAVE_FOUNDATION_ANSWER_TOOL = {
  type: "function",
  name: "save_foundation_answer",
  description:
    "Save the user's own answer as a draft and get the next interview step. Never publishes.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      section: { type: "string", enum: FOUNDATION_SECTIONS },
      intent: { type: "string", enum: ["current", "planned"] },
    },
    required: ["answer", "section", "intent"],
  },
} as const;
