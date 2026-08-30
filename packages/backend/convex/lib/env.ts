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

  // ── Phase 28 connector grants. A THIRD credential family, unrelated to sign-in or mailboxes. ──
  // Every one is `feature`: with none of them set, the app runs and the HubSpot rail simply refuses
  // to connect, loudly (`requireHubSpotConfig` throws naming the variable). There is deliberately no
  // development fallback — `p25-no-dev-fallback`.
  //
  // The credential ENCRYPTION key (`CONNECTOR_CREDENTIAL_KEY_V1`/`_V2`) is NOT here because it is
  // read through a computed `process.env[name]` in `connectorCredentials.requireCredentialKey`, so
  // the literal scan in `env.test.ts` cannot see it. Its operations live in
  // `docs/playbooks/revenue-connectors.md`.
  {
    name: "HUBSPOT_OAUTH_CLIENT_ID",
    tier: "feature",
    whatBreaks: "Connecting a HubSpot CRM, and therefore every HubSpot read.",
  },
  {
    name: "HUBSPOT_OAUTH_CLIENT_SECRET",
    tier: "feature",
    whatBreaks:
      "The HubSpot token exchange, refresh and revoke. Disconnect stops working upstream.",
  },
  {
    name: "HUBSPOT_OAUTH_REDIRECT_URI",
    tier: "feature",
    whatBreaks: "The HubSpot consent callback lands nowhere.",
  },
  {
    name: "QUICKBOOKS_CLIENT_ID",
    tier: "feature",
    whatBreaks: "Connecting a QuickBooks company, and therefore every accounting read.",
  },
  {
    name: "QUICKBOOKS_CLIENT_SECRET",
    tier: "feature",
    whatBreaks:
      "The Intuit token exchange, the rolling refresh and the revoke. Disconnect stops working upstream.",
  },
  {
    name: "QUICKBOOKS_REDIRECT_URI",
    tier: "feature",
    whatBreaks: "The Intuit consent callback lands nowhere.",
  },
  {
    // Not a secret and not an endpoint: the ISO 4217 code the company's books are kept in, which
    // QuickBooks omits from every row when multicurrency is off. Unset, reads assume USD — right
    // for Intuit's sandbox companies and wrong for a euro-denominated tenant, which is a WRONG
    // FIGURE rather than an outage, so it is classified even though nothing throws without it.
    name: "QUICKBOOKS_HOME_CURRENCY",
    tier: "feature",
    whatBreaks:
      "Nothing visibly. Amounts from a non-USD company are labelled USD, which mislabels money rather than failing.",
  },

  // ── The tenant's own Stripe account, READ-ONLY ──────────────────────────────────────────────
  //
  // `STRIPE_APP_*` is this repo's read-only Stripe App, reading a TENANT'S account. It is NOT
  // Pikar's own merchant account: that is the write-capable `BILLING_STRIPE_*` family and it must
  // never be substituted here. The prefix split is the boundary.
  {
    name: "STRIPE_APP_CLIENT_ID",
    tier: "feature",
    whatBreaks: "Connecting a tenant's Stripe account, and therefore every payment-rail read.",
  },
  {
    name: "STRIPE_APP_SECRET_KEY",
    tier: "feature",
    whatBreaks:
      "The Stripe Apps token exchange and the rolling refresh. A connection cannot be made or renewed.",
  },
  {
    name: "STRIPE_APP_REDIRECT_URI",
    tier: "feature",
    whatBreaks: "The Stripe Apps consent callback lands nowhere.",
  },
  {
    // Not a secret: the Stripe API version this lane's parsers were written against. Unset, the
    // lane REFUSES to read rather than silently taking whichever version the connected account's
    // dashboard is on — Stripe ships breaking changes per version and the tenant can move it.
    name: "STRIPE_APP_API_VERSION",
    tier: "feature",
    whatBreaks: "Every Stripe read fails closed rather than running against an unpinned shape.",
  },

  // ── The tenant's own PayPal merchant, READ-ONLY ─────────────────────────────────────────────
  //
  // ONE name, and it is not a credential. There is deliberately no `PAYPAL_CLIENT_ID`/`_SECRET`
  // here because nothing in this repository mints a PayPal token: a client-credentials token reads
  // PIKAR'S OWN PayPal account, and storing one against a tenant is the exact defect the lane
  // exists to prevent. See `paypalAuth.ts`.
  {
    // Pikar's OWN merchant id — the account a bare client-credentials token would reach. It is what
    // `classifyGrantSubject` compares against, so unset, the app's own account and a tenant's
    // merchant become indistinguishable. Not a secret; it is a public payer id.
    name: "PAYPAL_PARTNER_MERCHANT_ID",
    tier: "feature",
    whatBreaks:
      "Every PayPal read fails closed rather than risk attributing Pikar's own transactions to a tenant.",
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
    whatBreaks: "The Gemini model lane AND vault embeddings — vaultRag.ts pins Gemini embeddings.",
  },
  {
    // "required" rather than "feature" because DEFAULT_MODEL and RESEARCH_MODEL both point at
    // `stealth/ox-alpha` (the 2026-08-24 trial, packages/cost/src/cost.ts). While that is true this
    // key IS the model lane, and a readiness screen that called it optional would be lying. It drops
    // back to "feature" the moment the pins revert.
    name: "OPENROUTER_API_KEY",
    tier: "required",
    whatBreaks:
      "Every agent turn and every eval, while the model pins sit on stealth/ox-alpha. The OpenAI fallback absorbs nothing here — that account is the exhausted one.",
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
    name: "PEXELS_API_KEY",
    tier: "feature",
    whatBreaks:
      "Free stock scenes (`stock_video` / `stock_image`). Absent, those scenes fail with a governed code and the fix menu can swap them for a card or a still — no cent is at risk, because a stock line reserves $0. Everything else in the media rail is unaffected.",
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

  // ── Phase 28.1 Pikar's OWN merchant account (billing*, NOT the Phase 28 stripe* connector) ──
  // A FOURTH credential family. It charges money OUT of Pikar's Stripe account; STRIPE_APP_* (the
  // Phase 28 connector) reads a TENANT's. Keeping the prefixes apart is what stops the wrong
  // secret reaching the wrong code path.
  {
    name: "BILLING_STRIPE_WEBHOOK_SECRET",
    tier: "feature",
    whatBreaks:
      "The Stripe billing webhook refuses every delivery, so no subscription, invoice or payment outcome is ever recorded.",
  },
  {
    // The write-capable key. It CHARGES CARDS, so there is deliberately no development fallback
    // (`p25-no-dev-fallback`) — `billingApi.ts` throws before `fetch` rather than degrading.
    // Classified in the SAME commit as its first literal read: `env.test.ts` is bidirectional and
    // a row with no consumer is as red as a consumer with no row.
    name: "BILLING_STRIPE_SECRET_KEY",
    tier: "feature",
    whatBreaks:
      "Every outbound Stripe call from Pikar's own account. No tenant can start Checkout or open the Customer Portal; the surface refuses loudly rather than half-working.",
  },
  {
    // Not a secret — deployment CONFIG. It lives here rather than in `packages/billing/src/config.ts`
    // (which mirrors the rest of the Dashboard) for one reason: a TEST price id must never be
    // readable as a live one, and the two deployments hold different objects under this one name.
    name: "BILLING_STRIPE_PRICE_ID",
    tier: "feature",
    whatBreaks:
      "Subscribing. `startCheckout` throws naming this variable rather than opening a Checkout against a guessed or stale price.",
  },

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
    // `lib/models.offlineSeamAvailable()` — the OPERATOR HALF of the vault-digest / voice-doc
    // fixture gate. It was the ABSENCE of both model keys alone, which made a deployment that
    // merely LOST its keys fabricate digests silently instead of failing; consent is now positive
    // and it is reported here, on the same footing as the media fixtures.
    name: "PIKAR_OFFLINE_FIXTURES",
    tier: "fixture",
    whatBreaks:
      'Nothing. Set to "1" ON A KEYLESS deployment = folder digests and voice-doc review are FAKED from a local fixture with no model call. Ignored while either model key is set.',
  },
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
 * THE ONE CONSENT TEST FOR THE OFFLINE-FIXTURE SEAM. Both deciders call it; neither owns a rule.
 *
 * "Is this fixture seam on?" was answered in two places with two rules: `lib/models.ts`
 * `offlineSeamAvailable()` required the literal `"1"`, while `fixturesActive` below used the
 * generic `!read(name)?.trim()`. So `PIKAR_OFFLINE_FIXTURES=on` — the spelling every other fixture
 * flag in this repo accepts — gave an operator all three of: a readiness screen saying a
 * fabrication seam is LIVE, a fixture that is silently OFF, and an unexplained
 * `OPENROUTER_API_KEY is not set`. One question, one predicate.
 *
 * The rule is the literal `"1"`, which is what this manifest row's `whatBreaks` string tells the
 * operator to set. `""` and a leftover `"0"` are the operator saying NO, so a `!== undefined` check
 * is wrong in the unsafe direction. A value that is neither (`on`, `true`) reads as OFF in BOTH
 * places now, which is coherent and fails toward the loud missing-key throw.
 *
 * NOT re-exported as a `process.env` read: `lib/models.ts` keeps the LITERAL
 * `process.env.PIKAR_OFFLINE_FIXTURES`, because `env.test.ts`'s "no manifest entry is dead" drift
 * scan only sees literal reads and a helper indirection would make this row look dead.
 *
 * Pinned by `lib/models.test.ts` — a table of literal values run through BOTH sites, which fails if
 * either grows its own rule again.
 */
export const OFFLINE_FIXTURES_ENV = "PIKAR_OFFLINE_FIXTURES";
export const isOfflineFixtureConsent = (value: string | undefined): boolean =>
  value?.trim() === "1";

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
    //
    // `PIKAR_OFFLINE_FIXTURES` is read through `isOfflineFixtureConsent`, the SAME value test its
    // consumer `offlineSeamAvailable()` uses, so the two agree on WHETHER THE VALUE IS CONSENT.
    // They still differ deliberately on one thing: this screen reports the flag alone, while the
    // seam ANDs it with "neither model key is set". On a keyed deployment the screen therefore
    // reports the flag ACTIVE while the seam is inert — a fixture warning louder than the seam is
    // the safe direction. Both halves are pinned by the literal-value table in `models.test.ts`.
    // Every OTHER fixture-tier name keeps the generic non-blank test below.
    fixturesActive: ENV_MANIFEST.filter((e) =>
      e.tier !== "fixture"
        ? false
        : e.name === OFFLINE_FIXTURES_ENV
          ? isOfflineFixtureConsent(read(e.name))
          : !unset(e.name),
    )
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
  // Same class as the two above: an OAuth callback minted from an ephemeral preview URL stops
  // resolving, and the consent that used it can never come back.
  "HUBSPOT_OAUTH_REDIRECT_URI",
  // Intuit matches the redirect URI EXACTLY against the one registered on the app, so an ephemeral
  // origin here does not merely fail to resolve — the exchange is refused before the browser moves.
  "QUICKBOOKS_REDIRECT_URI",
  // Stripe matches the redirect against the app manifest's `allowed_redirect_uris`, so an ephemeral
  // preview origin is refused at the consent screen rather than merely failing to resolve later.
  "STRIPE_APP_REDIRECT_URI",
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
