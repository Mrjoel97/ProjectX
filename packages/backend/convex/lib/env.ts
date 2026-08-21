// The hosted-deployment environment manifest (25-10).
//
// ONE array, filtered at call time. Never a throw at module load: a missing key must surface as a
// READINESS ANSWER on an owner screen, not as a deployment that refuses to boot and takes every
// working feature down with the broken one. The whole point is to be able to ASK.
//
// NAMES ONLY EVER LEAVE THIS MODULE. No consumer returns a value, and `envCheck` returns
// `{missing: string[]}` — a readiness surface that echoed a secret to prove it was set would be a
// worse leak than the misconfiguration it reports.
//
// HOW TO KEEP THIS HONEST: `env.test.ts` scans the repo for `process.env.X` AND for
// `requireEnvMedia("X")` — the media helper is a `process.env[name]` indirection, so a literal-only
// scan was blind to every name it reads (25.1-06, D12) — and fails when a name is consumed by
// source but classified by nobody here. A manifest that has to be remembered is a manifest that
// goes stale, so it is derived-checked instead.
//
// A THIRD indirection would be invisible again. If you add one, add its regex to that scan in the
// same commit; the scan asserts that the media names are NOT reachable as literals, so removing the
// extension reds rather than quietly narrowing the guard.

export type EnvTier =
  /** The deployment cannot serve its core promise without this. */
  | "required"
  /** A named FEATURE is dark without it; everything else works. */
  | "feature"
  /** Test/fixture seams and operator escape hatches. Absent in a healthy production. */
  | "fixture";

export type EnvSpec = {
  readonly name: string;
  readonly tier: EnvTier;
  /** What breaks, in the words an operator reading a readiness screen needs. */
  readonly whatBreaks: string;
};

export const ENV_MANIFEST: readonly EnvSpec[] = [
  // ── Identity and the app's own origin ───────────────────────────────────────────────────────
  {
    name: "CONVEX_SITE_URL",
    tier: "required",
    whatBreaks:
      "Convex Auth's issuer/JWKS and every OAuth callback base; unsubscribe links fail closed.",
  },
  {
    name: "SITE_URL",
    tier: "required",
    whatBreaks: "Sign-in redirects resolve to the wrong origin.",
  },
  {
    name: "AUTH_GOOGLE_ID",
    tier: "required",
    whatBreaks: "Google sign-in. Distinct from the Gmail MAILBOX grant below.",
  },
  {
    name: "AUTH_GOOGLE_SECRET",
    tier: "required",
    whatBreaks: "Google sign-in stops working for every user.",
  },
  {
    name: "AUTH_MICROSOFT_ENTRA_ID_ID",
    tier: "feature",
    whatBreaks:
      "Microsoft sign-in. The /signup button is hidden while absent (invites.authProviders), so its absence is honest rather than broken.",
  },
  {
    name: "AUTH_MICROSOFT_ENTRA_ID_SECRET",
    tier: "feature",
    whatBreaks: "Microsoft sign-in; the /signup button hides itself while this is unset.",
  },

  // ── Mailbox grants. NOT the same credentials as sign-in above (ADR-018). ─────────────────────
  {
    name: "GOOGLE_OAUTH_CLIENT_ID",
    tier: "required",
    whatBreaks: "Connecting a Gmail mailbox, and therefore all Google delivery.",
  },
  {
    name: "GOOGLE_OAUTH_CLIENT_SECRET",
    tier: "required",
    whatBreaks: "Connecting a Gmail mailbox, and therefore all Google delivery.",
  },
  {
    name: "GMAIL_OAUTH_REDIRECT_URI",
    tier: "required",
    whatBreaks: "The Gmail consent callback lands nowhere.",
  },
  {
    name: "MICROSOFT_OAUTH_CLIENT_ID",
    tier: "feature",
    whatBreaks: "Outlook delivery and Microsoft calendar (ONE grant serves both — ADR-018).",
  },
  {
    name: "MICROSOFT_OAUTH_CLIENT_SECRET",
    tier: "feature",
    whatBreaks: "Outlook delivery and Microsoft calendar.",
  },
  {
    name: "MICROSOFT_CALENDAR_REDIRECT_URI",
    tier: "feature",
    whatBreaks: "The Microsoft consent callback lands nowhere.",
  },

  // ── Governed delivery ───────────────────────────────────────────────────────────────────────
  {
    name: "UNSUBSCRIBE_SECRET",
    tier: "required",
    whatBreaks:
      "The CAN-SPAM footer cannot be built, so EVERY send fails closed. This is the single most consequential name here: absent, delivery stops entirely — by design.",
  },

  // ── Models and research ─────────────────────────────────────────────────────────────────────
  {
    name: "OPENAI_API_KEY",
    tier: "required",
    whatBreaks: "Every agent turn and every eval — the product does nothing without it.",
  },
  {
    name: "GOOGLE_GENERATIVE_AI_API_KEY",
    tier: "feature",
    whatBreaks: "The Gemini model lane.",
  },
  {
    name: "TAVILY_API_KEY",
    tier: "feature",
    whatBreaks: "Web research; the cockpit falls back to asking the user.",
  },

  // ── Reliability ─────────────────────────────────────────────────────────────────────────────
  {
    // The arming gate on `reliabilitySweep.runSweep`, added for the 2026-08-21 production
    // promotion. UNSET IS THE SAFE STATE and the deliberate default: the cron still fires every 30
    // minutes, walks into the handler, and returns without writing. Set to "1" only after a real
    // render has been watched end to end in production, because an unproven watchdog that
    // terminalizes a healthy slow render manufactures the very defect it was built to catch.
    name: "RELIABILITY_SWEEP_ARMED",
    tier: "feature",
    whatBreaks:
      "Nothing, while unset — the stuck-work watchdog stays dormant and stalled rows keep needing a human to notice them. Set it to `1` to arm the sweep.",
  },

  // ── Media ───────────────────────────────────────────────────────────────────────────────────
  {
    name: "MEDIA_RENDER_SECRET",
    tier: "feature",
    whatBreaks: "Media rendering; the render callback cannot be authenticated.",
  },
  {
    // Read INSIDE the scheduled `renderReel` action, so unset it throws where no user is waiting.
    // Invisible to this manifest for its whole life until 25.1-06 (D12).
    name: "MEDIA_RENDER_URL",
    tier: "feature",
    whatBreaks:
      "Media rendering, SILENTLY: the render action throws off-thread and the plan sits at `rendering` for ever.",
  },
  // FAL_WEBHOOK_SECRET was here until 25.1-06 (D12/D14). Its only reader was
  // `mediaComplete.resolveJob`, whose only caller was the `/fal/callback/*` route; all three are
  // gone. Listing it made a readiness screen demand a secret that unlocked nothing — the exact
  // dead-entry failure the second drift check exists to catch. `FAL_FIXTURE` stays: it is still a
  // live short-circuit in `media.ts`'s submit path, whatever its name says.
  {
    // Read only by the LEGACY Wan poller, retained for tasks submitted before the OpenAI cutover
    // (ADR-024). A deployment with no such task in flight needs neither name, which is why both are
    // `feature` rather than `required` — reported as dark, never as broken.
    name: "WAN_API_BASE_URL",
    tier: "feature",
    whatBreaks:
      "The legacy Wan task poller (pre-cutover jobs only, ADR-024). A deployment with no pre-cutover job in flight needs it for nothing.",
  },
  {
    // Alibaba Model Studio's own mixed-case name for the key (ADR-017). It is spelled exactly this
    // way in `convex env` and in source; a shape-based scan would drop it.
    name: "Video_and_image_API_Key",
    tier: "feature",
    whatBreaks:
      "The legacy Wan task poller's credential (pre-cutover jobs only, ADR-024). New visual jobs go to OpenAI on OPENAI_API_KEY.",
  },

  // ── Compliance and operations ───────────────────────────────────────────────────────────────
  { name: "WORM_BUCKET", tier: "feature", whatBreaks: "The OPSG-03 WORM audit export." },
  { name: "AWS_REGION", tier: "feature", whatBreaks: "The WORM export's S3 target." },
  {
    name: "SKILLOPT_TOKEN",
    tier: "feature",
    whatBreaks:
      "The /skillopt/export trajectory endpoint. Absent, that route FAILS CLOSED (401) rather than opening — the safe direction.",
  },
  { name: "SKILLOPT_OWNER_TENANT", tier: "feature", whatBreaks: "Skill-optimizer attribution." },
  {
    name: "GOOGLE_SERVICE_ACCOUNT_JSON",
    tier: "feature",
    whatBreaks: "Vertex-backed model access.",
  },
  { name: "GOOGLE_VERTEX_LOCATION", tier: "feature", whatBreaks: "Vertex region selection." },

  // ── Convex-provided and build-time. Present without operator action. ────────────────────────
  {
    name: "CONVEX_CLOUD_URL",
    tier: "fixture",
    whatBreaks: "Nothing — Convex sets this on the deployment itself.",
  },
  // NEXT_PUBLIC_CONVEX_URL is deliberately ABSENT: it is a web-BUILD variable that no backend
  // source reads, and the drift test's dead-entry check caught it being listed here. It is
  // validated by deploy-production.yml, which is the right place for it.

  // ── Offline seams. A healthy production has NONE of these set. ──────────────────────────────
  {
    name: "MEDIA_PROVIDER_FIXTURE",
    tier: "fixture",
    whatBreaks: "Nothing. Set = media provider calls are FAKED.",
  },
  {
    name: "MEDIA_SANDBOX_FIXTURE",
    tier: "fixture",
    whatBreaks: "Nothing. Set = sandbox renders are FAKED.",
  },
  { name: "FAL_FIXTURE", tier: "fixture", whatBreaks: "Nothing. Set = fal.ai calls are FAKED." },
  {
    name: "PHASE17_ALLOW_DISPOSABLE_GRAPH_PROBE",
    tier: "fixture",
    whatBreaks: "Nothing. Set = the Graph concurrency probe may run against a disposable account.",
  },
  {
    // The probe artifact itself, as JSON. UNSET is the safe state and the normal one: Microsoft
    // calendar UPDATE simply refuses. Setting it does not "enable" anything by itself either — the
    // deployment and tenant hashes inside must match the ones recomputed at call time, so a probe
    // measured elsewhere binds to nothing. Microsoft DELETE is unaffected in every case (ADR-023).
    name: "PHASE17_GRAPH_PROBE",
    tier: "feature",
    whatBreaks: "Microsoft calendar UPDATE. Unset = refused with `provider_unsupported`.",
  },
];

/** Names a healthy hosted deployment must have. */
export const REQUIRED_ENV = ENV_MANIFEST.filter((e) => e.tier === "required").map((e) => e.name);

/** Names whose absence darkens a named feature but breaks nothing else. */
export const FEATURE_ENV = ENV_MANIFEST.filter((e) => e.tier === "feature").map((e) => e.name);

/**
 * Which manifest names are unset, by tier. NAMES ONLY — never a value, never a length, never a
 * prefix. A blank or whitespace-only value counts as unset: `convex env set X ""` is the most
 * common way a key looks configured and is not.
 */
export function missingEnv(read: (name: string) => string | undefined): {
  missingRequired: string[];
  missingFeature: string[];
  fixturesActive: string[];
} {
  const unset = (name: string) => !read(name)?.trim();
  return {
    missingRequired: REQUIRED_ENV.filter(unset),
    missingFeature: FEATURE_ENV.filter(unset),
    // Reported because a fixture seam left on in production silently FAKES a provider — a failure
    // that looks like success, which is the worst kind to leave undetectable.
    fixturesActive: ENV_MANIFEST.filter((e) => e.tier === "fixture" && !unset(e.name))
      .map((e) => e.name)
      // Convex sets these two itself; they are not seams and their presence is not a warning.
      .filter((n) => n !== "CONVEX_CLOUD_URL" && n !== "NEXT_PUBLIC_CONVEX_URL"),
  };
}

/**
 * The names whose VALUE must be a durable origin, not merely present (ADR-022).
 *
 * `CONVEX_SITE_URL` is included even though this repo never sets it — it is the Convex
 * deployment's own origin, and the unsubscribe link is minted from it and fails closed when empty.
 * A read-only assertion is the most this side can do, and it is worth doing.
 */
export const ORIGIN_ENV: readonly string[] = [
  "CONVEX_SITE_URL",
  "SITE_URL",
  "GMAIL_OAUTH_REDIRECT_URI",
  "MICROSOFT_CALENDAR_REDIRECT_URI",
];

/**
 * Is this a durable, user-shareable origin?
 *
 * 25-10 asked for "durable CUSTOM origins", which the 25-00 baseline found would block the phase on
 * a non-problem: the Convex HTTP-action origin is `*.convex.site` and is fixed by Convex domain
 * configuration, not by anything this repo sets. Durable is the real requirement; custom is not.
 *
 * What must be rejected is an EPHEMERAL origin — a per-deployment preview URL that stops resolving,
 * or a localhost that never resolved for anyone else. An unsubscribe link or an OAuth callback
 * pinned to one of those is dead the moment the deployment is superseded.
 */
export function isDurableOrigin(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return false;
  // Vercel preview deployments carry a per-build hash and are superseded on the next push.
  if (/-[a-z0-9]{6,}\.vercel\.app$/.test(host)) return false;
  return host.includes(".");
}
