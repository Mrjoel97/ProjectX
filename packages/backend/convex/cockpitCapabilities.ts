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
 * throwaway tenant is intentionally disconnected, so a pinned cockpit candidate must retain the
 * email tools the fixtures are evaluating. Real user turns never carry this internal version pin.
 *
 * 21-03 (SKILL-01) — WHY THERE ARE TWO PIN SCOPES HERE. A pinned evaluation is one the HARNESS
 * drives, and since 21-03 the harness can pin in either of two scopes: `--skill name@version`
 * (a GLOBAL `skills` row → `cockpitSkillVersion`) or `--tenant-skill <id>` (an EXACT `tenantSkills`
 * row → `tenantSkillPins`). This function knew only the first, and the consequence was measured:
 * golden run with 41 cases went 21/41 for $0.4157 while pinning ONLY a tenant candidate. The eval
 * tenant is disconnected by design, so the bypass returning false withheld the Gmail rail; six
 * fixtures returned at $0.0000 having called no tool at all, and the paid email fixtures show the
 * model reaching for `checkAvailability`/`proposeCalendarEvent` because `addRecipients` and
 * `proposePlan` were structurally absent. It measured the harness, not the candidate.
 *
 * The `eval-` tenant prefix is what keeps this away from real users, and it is UNCHANGED — a
 * production turn has neither pin and cannot reach this branch by either scope.
 */
export function isPinnedCockpitEvaluation(
  tenantId: string,
  cockpitSkillVersion: number | undefined,
  tenantSkillPins?: Record<string, unknown>,
): boolean {
  if (!tenantId.startsWith("eval-")) return false;
  // EITHER scope means "the harness is driving this turn". Deliberately not `cockpitSkillVersion`
  // plus a `tenantSkillPins["cockpit-agent"]` lookup: `cockpit-agent` is not in
  // USER_AUTHORABLE_SKILLS, so a tenant pin NEVER names it — requiring one would make this branch
  // unreachable for exactly the runs it exists to serve.
  return cockpitSkillVersion !== undefined || Object.keys(tenantSkillPins ?? {}).length > 0;
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
