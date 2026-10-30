import { normalizeAddress } from "./contacts";
import { isValidEmail } from "./validateSubmit";

export type InboundFormField = "email" | "name" | "company";

export type InboundFormNode = {
  readonly fields: readonly InboundFormField[];
  readonly consent: string;
};

export type ParsedInboundForm = {
  readonly email: string;
  readonly name?: string;
  readonly company?: string;
  readonly consent: { readonly source: "inbound-form"; readonly wording: string };
  readonly origin: "inbound";
};

export type InboundFormParseResult =
  | { readonly ok: true; readonly value: ParsedInboundForm }
  | { readonly ok: false; readonly code: "invalid" | "consent_required" };

const hasControl = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

function optionalText(value: unknown, max: number): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > max || hasControl(value)) return null;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Parse an anonymous form at the server boundary. The form node supplies the allowed field list
 * and consent wording; the caller cannot choose the contact origin or consent source.
 */
export function parseInboundWebForm(
  raw: Record<string, unknown>,
  node: InboundFormNode,
): InboundFormParseResult {
  if (!Array.isArray(node.fields) || !node.fields.includes("email") || node.consent.trim() === "") {
    return { ok: false, code: "invalid" };
  }
  const emailRaw = raw.email;
  if (typeof emailRaw !== "string" || emailRaw.length > 320) return { ok: false, code: "invalid" };
  const email = normalizeAddress(emailRaw);
  if (!isValidEmail(email)) return { ok: false, code: "invalid" };

  // Consent is deliberately interpreted from a closed boolean-ish set. Absence, false, and an
  // unchecked browser checkbox are all refusal; no consent is inferred from the presence of data.
  const consent =
    raw.consent === true || raw.consent === "true" || raw.consent === "on" || raw.consent === "1";
  if (!consent) return { ok: false, code: "consent_required" };

  const name = node.fields.includes("name") ? optionalText(raw.name, 160) : undefined;
  const company = node.fields.includes("company") ? optionalText(raw.company, 200) : undefined;
  if (name === null || company === null) return { ok: false, code: "invalid" };
  return {
    ok: true,
    value: {
      email,
      ...(name ? { name } : {}),
      ...(company ? { company } : {}),
      consent: { source: "inbound-form", wording: node.consent },
      origin: "inbound",
    },
  };
}
