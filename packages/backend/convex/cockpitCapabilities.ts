/** Deterministic cockpit capability routing; this is containment, not another model call. */
export type CockpitCapability =
  | "business"
  | "calendar"
  | "content"
  | "crm"
  | "email"
  | "finance"
  | "knowledge"
  | "media"
  | "research"
  | "general";

export type CockpitCapabilityRoute = {
  primary: CockpitCapability;
  capabilities: readonly CockpitCapability[];
  gmailRequired: boolean;
};

const CAPABILITY_RULES: ReadonlyArray<{
  capability: Exclude<CockpitCapability, "general">;
  pattern: RegExp;
}> = [
  {
    capability: "email",
    // Requiring an action verb keeps product topics such as "email marketing strategy" off Gmail.
    pattern:
      /(?:\b(?:check|read|brief|briefing|search|summari[sz]e|triage|what happened)\b[^.?!]{0,60}\b(?:inbox|mailbox|e-?mails?)\b)|(?:\b(?:draft|compose|write|send|schedule|forward)\b[^.?!]{0,80}\b(?:e-?mail|message)\b)|(?:\brepl(?:y|ies|ied|ying)\b[^.?!]{0,80}\b(?:to|e-?mail|message|thread)\b)|(?:\b(?:send|deliver)\b[^.?!]{0,80}\bto\b)|(?:\be-?mail\b\s+(?:to|for|him|her|them)\b)|(?:\b(?:recipient|subject line)\b)|(?:\b[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+\b)/i,
  },
  {
    capability: "calendar",
    pattern: /\b(?:calendar|availability|available slots?|meeting|appointment|schedule a call)\b/i,
  },
  {
    capability: "finance",
    pattern:
      /\b(?:cash(?:flow| on hand)?|runway|mrr|revenue|receivables?|payables?|operating cost|finance|financial|margin|cac|ltgp)\b/i,
  },
  {
    capability: "crm",
    pattern: /\b(?:crm|contact|pipeline|lead|follow[- ]?up|customer record)\b/i,
  },
  {
    capability: "knowledge",
    pattern:
      /\b(?:vault|uploaded|my (?:notes?|documents?|files?)|knowledge base|business corpus)\b/i,
  },
  {
    capability: "research",
    pattern: /\b(?:research|look up|current price|competitor|market scan|verify|sources?)\b/i,
  },
  {
    capability: "media",
    pattern: /\b(?:video|reel|image|illustration|poster|social graphic|storyboard)\b/i,
  },
  {
    capability: "content",
    pattern:
      /\b(?:document|proposal|brief|report|one[- ]pager|copy|content|article|memo|onboarding sequence)\b/i,
  },
  {
    capability: "business",
    pattern:
      /\b(?:business|strategy|blueprint|goal|plan|swot|lean canvas|business model canvas|growth|bottleneck|evaluate|diagnose|offer|positioning)\b/i,
  },
];

export function routeCockpitIntent(text: string): CockpitCapabilityRoute {
  const normalized = text.trim().replace(/\s+/g, " ");
  const matches: CockpitCapability[] = CAPABILITY_RULES.filter(({ pattern }) =>
    pattern.test(normalized),
  ).map(({ capability }) => capability);
  // Preserve capitalization so "Email Amina" is recognized as a verb without turning lower-case
  // product topics such as "email onboarding sequence" into a Gmail request.
  if (/\b[Ee]-?mail\s+[A-Z][\p{L}'-]+/u.test(normalized) && !matches.includes("email")) {
    matches.unshift("email");
  }
  const capabilities: CockpitCapability[] =
    matches.length > 0 ? [...new Set(matches)] : ["general"];
  return {
    primary: capabilities[0] ?? "general",
    capabilities,
    gmailRequired: capabilities.includes("email"),
  };
}

const EXPLICIT_NON_EMAIL_ACTION =
  /\b(?:assess|evaluate|diagnose|research|look up|verify|create|make|generate|analy[sz]e|review|calculate|show|read)\b[^.?!]{0,80}\b(?:business|strategy|blueprint|swot|canvas|vault|notes?|documents?|files?|finance|cash|runway|competitors?|market|report|one[- ]pager|post|video|reel|image)\b/i;

/**
 * Resolve multi-turn ambiguity. A bare answer continues an active email plan, while an explicit
 * new non-email action changes rails. An explicit email instruction always wins.
 */
export function shouldUseGmailCapability(text: string, activeEmailPlan: boolean): boolean {
  const route = routeCockpitIntent(text);
  if (route.gmailRequired) return true;
  if (!activeEmailPlan) return false;
  return !EXPLICIT_NON_EMAIL_ACTION.test(text);
}

/**
 * Golden evaluations stage governed email plans but can never approve or execute them. Their
 * throwaway tenant is intentionally disconnected, so a harness-driven turn must retain the email
 * tools the fixtures are evaluating.
 *
 * THE PREDICATE IS "IS THE HARNESS DRIVING THIS TURN", AND IT USED TO BE "DOES A PIN EXIST".
 * Those are not the same question, and the gap between them has now been paid for three times
 * with the SAME signature — email fixtures returning `recipients: []` and a tool list of
 * `{proposeCalendarEvent, stageCrmWrite}` because `addRecipients` and `proposePlan` were
 * structurally absent, plus research fixtures at $0.0000 that never reached a model at all:
 *
 *   1. 21-03: only the GLOBAL pin scope counted, so a `--tenant-skill`-only run scored 21/41
 *      for $0.4157. Fixed by adding the tenant scope BESIDE the global one.
 *   2. 2026-08-27: a run pinning `research-specialist` (and nothing else) scored 26/46 — the
 *      cockpit was unpinned, so all 20 email fixtures failed and were nearly filed as a cockpit
 *      regression. Fixture 34 failed the same way for a subtler reason: its injection bait is an
 *      email ADDRESS, which the capability router matches, so a RESEARCH turn took the
 *      disconnected-Gmail early return and dispatched nothing.
 *   3. The `--only` probe run to diagnose (2) reproduced (2) exactly, because it was unpinned too.
 *
 * Widening the scope a fourth time would repeat the fix that did not hold twice. The question the
 * caller actually needs answered is whether the HARNESS is driving, and the `eval-` tenant prefix
 * is the only thing that has ever answered it — it is, and always was, the guard that keeps this
 * away from real users. A pin is evidence the harness is driving; it was never the definition, and
 * requiring it made every unpinned run measure the harness instead of the product.
 *
 * SAFE BECAUSE THE PREFIX IS NOT CALLER-SUPPLIED: `sendCockpitMessage` is a `tenantAction` and
 * passes `ctx.tenantId`, injected by the wrapper from the authenticated identity. A real user
 * cannot present an `eval-` tenant, so no production turn can reach this branch.
 */
export function isHarnessDrivenEvaluation(tenantId: string): boolean {
  return tenantId.startsWith("eval-");
}

/** Gmail-bound keys in the executive tool record. Business/CRM/Vault/content tools are absent. */
export const GMAIL_TOOL_NAMES = new Set([
  "resolveContacts",
  "addRecipients",
  "setRecipients",
  "removeRecipient",
  "setSubject",
  "setSendTime",
  "setMode",
  "resetPlan",
  "draftBody",
  "personalizeRecipient",
  "generateAttachment",
  "regenerateAttachment",
  "removeAttachment",
  "proposePlan",
  "listInbox",
  "briefInbox",
  "replyToMessage",
]);

/** Return a tool record with Gmail-bound keys structurally absent when the rail is disabled. */
export function applyGmailCapability<T extends Record<string, unknown>>(
  tools: T,
  enabled: boolean,
): T {
  if (enabled) return tools;
  return Object.fromEntries(
    Object.entries(tools).filter(([name]) => !GMAIL_TOOL_NAMES.has(name)),
  ) as T;
}

export const GMAIL_CONNECTION_REQUIRED_REPLY =
  "That action uses the email capability. Connect Gmail in Integrations, then ask me again; " +
  "the rest of the cockpit remains available without email.";
