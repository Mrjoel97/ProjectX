import { normalizeAddress } from "./contacts";
import { isValidEmail } from "./validateSubmit";

export type MarketingLeadInput = {
  email: string;
  name?: string;
  company?: string;
  consent?: { wording: string; context?: string };
};

/** C1: manual entry, with optional explicit per-person evidence; never inferred form consent. */
export function parseMarketingLead(input: MarketingLeadInput) {
  const email = normalizeAddress(input.email);
  if (input.email.length > 320 || !isValidEmail(email)) throw new Error("MARKETING_EMAIL_INVALID");
  for (const [value, bound] of [
    [input.name, 160],
    [input.company, 200],
    [input.consent?.wording, 4000],
    [input.consent?.context, 1000],
  ] as const) {
    if (
      value !== undefined &&
      (value.length > bound ||
        Array.from(value).some((character) => {
          const code = character.charCodeAt(0);
          return code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13);
        }))
    )
      throw new Error("MARKETING_FIELD_INVALID");
  }
  if (input.consent && !input.consent.wording.trim()) throw new Error("CONSENT_WORDING_REQUIRED");
  return {
    email,
    ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    ...(input.company?.trim() ? { company: input.company.trim() } : {}),
    origin: "user-entered" as const,
    ...(input.consent
      ? { consent: { ...input.consent, source: "asserted-by-user" as const } }
      : {}),
  };
}
