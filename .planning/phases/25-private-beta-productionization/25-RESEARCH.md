# Phase 25: Private Beta Productionization - Research

**Researched:** 2026-08-09
**Domain:** Convex Auth invite reconciliation · multi-tenant isolation proof · Microsoft Graph mail adapter · production go-live
**Confidence:** HIGH on the four blocking unknowns (all resolved from pinned package source + official docs); MEDIUM on the Graph read plane (endpoints verified, wire behaviour needs one live call)

<user_constraints>
## User Constraints (from `25-CONTEXT.md`)

### Locked Decisions

**Invite & signup flow (BETA-01)**
- **Code model:** single-use, **EMAIL-BOUND** codes. One code = one invited email = one signup, then dead.
- **Issuance:** **public waitlist → owner approves.** A visitor requests access; the owner approves a pending entry on the owner-only admin page, which mints the single-use code.
- **Approval surface:** the **owner-only admin page**, behind the already-shipped Phase 22 `requireOwner`. Same page hosts the three gated Phase-8 controls. One admin surface, one auth primitive.
- **Provider gating:** **both** Google and password sign-up are invite-gated. A Google or Microsoft sign-in arriving **without a redeemed invite is blocked at the door with NO user/tenant row persisted.** No orphan tenants.
- **Signup UX:** invite is a **link that pre-fills an editable code field** (`/signup?invite=CODE`); no link → the user pastes into the same field. One field, one query-param read, code stays visible and auditable.
- Redemption is a three-part check (Roadmap SC#2): the code is valid and unredeemed, the authenticating identity's email matches the invited email, and the OAuth **subject** is recorded immutably so a second subject can never re-redeem the same code — **tested against both Google and Microsoft subject formats.**

**Onboarding to first result (BETA-03)**
- **Shape:** **scripted first-run cockpit conversation.** No separate wizard, no new route, no onboarding-state table.
- **Interaction with Phase 11/15.1 onboarding:** they **already ship a first-run path.** Phase 25 does **not** build a second one — it extends the existing path with the first-send offer. Planner must read Phase 11 and 15.1 before touching onboarding. **Idea-stage profiles are thin by design** — only `oneLineDescription` and persona are required. The first-send offer must work on a thin profile.
- **Mailbox connect timing:** **inline at first Approve (soft).** Reuses the existing connect flow + `ReconnectBanner`. No hard pre-cockpit gate.
- **"First delivered result" =** a **real email to the user's own address**. Real send, real audit, real telemetry, real per-recipient report.
- **Hand-holding:** the agent **offers one concrete first action**, one tap runs resolve → PLAN → Approve → delivered. No persistent checklist widget.

**Microsoft Graph as second provider (DLVR-02)**
- **Parity:** **FULL** — send AND read plane (inbox search, briefing, reply threading, contact resolution).
- **Provider model:** **connect both + choose per send.** Not one-active-provider.
- **Account types:** personal + work via the `/common` authority from a single Azure app registration. Unverified-publisher consent is acceptable for the beta.
- **The adapter is built in the SAME commit as the Graph implementation, not before.** `gmailTokens` has no `provider` column and is indexed `by_tenant` only; `gmail.ts:45-46` hardcodes `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`; `gmail.ts:19` hardcodes the Google token endpoint. The widening ships **with** the Microsoft adapter. **An abstraction with one implementation is what CLAUDE.md §8 forbids**; a plan that lands the seam in an earlier wave than the Graph adapter is wrong on its face.
- **Seam to rewrite:** `deliverApprovedPlan.ts` currently calls `internal.gmail.send` **directly**.
- **Re-auth:** the MS side needs its own equivalent; MS token lifetime differs and must be verified, not assumed.

**BETA-02 / BETA-05 shape — the isolation gate**
- **BETA-02 is a VERIFICATION exercise, not a build.**
- **The two-user test DERIVES its table/index list from `schema.ts` at execution time.** The test must **fail when a table exists that it does not cover.**
- **Precedent to follow, not duplicate:** 19-02's 40-test BETA-05 isolation block in `contacts.test.ts`.
- **Must also assert** a non-owner cannot reach `optimizerConfig.setOptimizerEnabled`, `skills.activateCandidate`, `skills.candidatesForReview`.
- **`packages/pii` names-in-prose ceiling is a hard gate.** Decision: **gate grounded-prose export owner-only** for the beta and record the scrub gap as the named unlock. Do not attempt to close the scrub in this phase.

**Go-live posture**
- **Launch on Gmail Testing mode + an unverified Azure app + a live Vercel deploy.** Verification stays OFF the critical path.
- **Custom domain (roadmap SC#6) is a BLOCKING OWNER DECISION inside this phase** — a `checkpoint:decision` task. **Only Branch A completes the phase:** durable custom domain + DNS + TLS releases deployment and the mandatory BETA-03/DLVR-02 live sends. Branch B records that no user-shareable URL ships and explicitly BLOCKS deployment, live qualification, requirement closure, and Phase 25 completion.
- **Production secrets are part of go-live and are NOT all in place.** The deploy plan must enumerate every required secret and fail closed on a missing one.

**Inherited deltas that WIN over `09-CONTEXT.md`**
1. `requireOwner` is **BUILT** (Phase 22) — consume it, do not re-derive it. Phase 22's `/ops` DOM UAT half is still outstanding and this phase's admin page is the natural place to close it.
2. Invites are **EMAIL-BOUND** (reverses 09's "any-email").
3. Outlook is **FULL PARITY** — the de-scope lever was offered 2026-08-09 and **declined**. Sequence it as the heaviest lane; **the multi-tenant safety work lands FIRST.**
4. The isolation surface grew by an order of magnitude — a hand-authored table list is stale before it executes.

**Bookkeeping defects to correct in this phase**
- `REQUIREMENTS.md:160` marks BETA-05 `[x]` Complete and the trace table (`:348`) says "Complete". **The culminating two-user test does not exist.** The requirement must not read Complete before this phase closes.
- `ROADMAP.md` Phase 25 row reads `0/TBD` and must carry the real plan count once planned.

### Claude's Discretion
- Exact schema of the `betaInvites` / waitlist rows and the owner-admin page layout.
- Where the invite-redemption reconciliation attaches inside the Convex Auth callback.
- The provider-routing seam's concrete shape (in-`convex` dispatch vs a `packages/delivery` module) — a technical call, resolved by research, constrained by the "same commit" rule above.
- Onboarding copy and the exact "offer one action" prompt wording.
- The mechanism by which the isolation test enumerates tables from `schema.ts`.

### Deferred Ideas (OUT OF SCOPE)
- **Billing, public/open signup, abuse protection, legal pages** — next milestone, explicitly out.
- **Full Google/Microsoft OAuth verification, verified custom domain + Search Console** — the legal-entity-blocked track. Does not gate the beta opening.
- **Closing the `packages/pii` names-in-prose scrub** — this phase gates prose export owner-only and records the gap as the named unlock; it does not close it.
- **Waitlist auto-approve-to-a-cap** — rejected (removes owner curation).
- **Multi-use / cohort invite codes** — rejected in favour of single-use email-bound.
- **Password strength/breach checks, email verification, password reset** — needs a transactional email sender; deferred past the closed beta.
- **Admin roles beyond owner** — the Phase 22 primitive extends later; not built now.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **BETA-01** | New users can sign up only with a valid invite code (Convex Auth) | §1 resolves the block-at-door mechanism definitively: `callbacks.createOrUpdateUser` runs **inside the single `auth:store` mutation, before any row is inserted** — a throw rolls the whole transaction back, so nothing persists. §1.3 shows the OAuth subject must be smuggled through a widened `profile()` because Convex Auth strips `id`. §1.5 shows the invite CODE cannot ride the OAuth round-trip — email-binding is what makes the design work at all. §1.6 gives the credentials-flow asymmetry (unverified email → require the code too). |
| **BETA-02** | All data isolated per user across every table and index | §3: `schema.tables` is a public runtime property and `TableDefinition[" indexes"]()` returns `{indexDescriptor, fields}[]`. §3.2 gives the three-bucket enumeration (COVERED / EXEMPT_AUTH / EXEMPT_GLOBAL) that fails on an uncovered table. §3.4 gives the convex-test memory ceiling that a naive per-table harness will hit. |
| **BETA-03** | First delivered result within minutes via guided conversational onboarding | §6 maps the EXISTING first-run path (`onboarding.status` → `/dashboard/onboarding` → `converse` → `saveFacts` → `commitProfile`) and names the exact attach point (after `commitProfile`, in the cockpit — **not** inside `converse`). §6.2 is the phase's hardest hidden blocker: `postalAddress` is deliberately NOT an onboarding slot, and `cockpit.executePlan:820-826` refuses `no_postal_address`, so a new user's first Approve is refused today. §6.3 gives the §5 skill-gate cost and a gate-free alternative. |
| **BETA-05** | Culminating two-user cross-tenant test | §3 (enumeration) + §3.3 (the 19-02 template verbatim at `contacts.test.ts:697-729`) + §7 (the three already-`ownerMutation`/`ownerQuery` functions the test must prove reject a non-owner) + §1.4 (both subject formats, with concrete shapes). |
| **DLVR-02** | Deliver via Microsoft Graph (Outlook) through the same adapter | §4 maps every `gmail.ts` export to its Graph counterpart. §4.2 is the highest-leverage finding: `POST /me/sendMail` accepts a **base64 RFC-2822 MIME body**, so `buildMime()` is reused verbatim and only `base64Url()` is swapped. §4.3 lists four hard parity gaps (no message id in the 202, 4 MB cap, `conversationId` ≠ `threadId`, `$search`/`$filter` mutual exclusion). §5 gives the token model (90-day inactivity, not Gmail's 7 days). §8 gives the seam shape and the two — not one — production callers. |
</phase_requirements>

## Summary

Four of the six flagged unknowns are now **resolved at HIGH confidence from the pinned packages' own source**, not from training data. The invite gate has a clean, transactional mechanism (`callbacks.createOrUpdateUser`, verified in `@convex-dev/auth@0.0.94` source), the Microsoft subject format is settled (`sub`, pairwise, app-scoped, immutable — and explicitly *not* the `oid` GUID), the schema-derived table enumeration has a public Convex API (`schema.tables` + `TableDefinition[" indexes"]()`), and Microsoft Graph accepts raw base64 MIME on `/me/sendMail`, which means the existing byte-pinned `buildMime()` is reusable verbatim.

Three findings change the shape of the plan and are the reason to read this document before writing tasks. **(a) The invite code physically cannot travel through the Convex Auth OAuth round-trip** — `handleOAuthProvider` forwards only `redirectTo`, and the verifier row stores only a signature. The owner's email-binding decision is therefore not a preference, it is the *only* mechanism that works for OAuth; the typed code is a pre-flight UX check for OAuth and a real second factor only for the password flow. **(b) A brand-new user cannot complete BETA-03's first send today.** 19-05 made `cockpit.executePlan` refuse `no_postal_address` at the Approve gate, and 19-03 deliberately kept `postalAddress` out of the onboarding slot set — so the two locked decisions are in direct conflict and the resolution must be designed, not discovered at UAT. **(c) `internal.gmail.send` has two production callers** (`deliverApprovedPlan.ts:37` and `pipeline.ts:379`), plus a third consumer of `SEND_ENDPOINT`/`buildMime` in `notifyExternal.ts`; a routing rewrite that touches only `deliverApprovedPlan` leaves the pipeline lane silently Gmail-only.

The sequencing the context locks — safety first, Outlook last — is confirmed by the dependency graph: nothing in the invite gate, the isolation test or the admin page touches `gmail.ts`, `gmailTokens` or the delivery seam, and nothing in the Graph adapter touches `auth.ts`, `schema.ts`'s auth tables or `lib/functions.ts`. The two lanes are genuinely disjoint and can be planned as such.

**Primary recommendation:** land the invite gate in `callbacks.createOrUpdateUser` with a widened provider `profile()` that preserves `sub`; write the BETA-05 suite as a three-bucket enumeration over `schema.tables` that fails on an unclassified table; resolve the `postalAddress`-vs-first-send conflict by surfacing the address inline in the cockpit's first-send offer (not by adding an onboarding slot); and ship the `provider` column, the `by_tenant_provider` index, the `internal.delivery.send` switch and `convex/graph.ts` in one commit at the end.

## Standard Stack

Everything needed is already installed. **No new dependency is warranted** (CLAUDE.md §8, rung 5).

### Core — already pinned, reuse as-is
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@convex-dev/auth` | 0.0.94 (exact) | Sign-in providers + the `callbacks.createOrUpdateUser` transaction hook | Already the auth spine; the hook is the only pre-persist seam that exists |
| `@auth/core` | 0.41.2 (exact) | `providers/google`, `providers/microsoft-entra-id` | `microsoft-entra-id` ships in the installed version — **nothing to add** |
| `convex` | 1.42.1 | `SchemaDefinition.tables`, `TableDefinition[" indexes"]()` | The enumeration API BETA-05 needs is already public |
| `convex-test` | 0.0.54 | In-memory backend for the two-user isolation suite | The 19-02 precedent runs on it |
| `@convex-dev/migrations` | 0.3.5 (exact) | The `gmailTokens.provider` backfill (OPSG-06 pattern) | Established; ad-hoc backfills are banned |
| `vitest` | ^3.2.7 | Test runner, `environment: "edge-runtime"` | Configured in `packages/backend/vitest.config.ts` |
| `@playwright/test` | (apps/web) | `pnpm test:e2e` — the DOM half of the admin/onboarding proofs | Existing `auth.setup.ts` storage-state pattern |

### Explicitly NOT to add
| Tempting | Why not |
|----------|---------|
| `@microsoft/microsoft-graph-client` | The whole Graph surface this phase needs is five `fetch` calls. `gmail.ts` uses bare `fetch`; a client SDK would be a second HTTP idiom in the same subsystem for zero gain, and it pulls a large dep into a `"use node"` action. |
| `@azure/msal-node` | The refresh-token grant is one `POST` to `/common/oauth2/v2.0/token` with four form fields — `freshAccessToken` already does exactly this shape for Google. MSAL brings a token cache we do not want (the DB is the cache). |
| `zod` / `envalid` for the secret check | The check is `const missing = REQUIRED.filter(k => !process.env[k])`. One line. |
| A `packages/delivery` package | An abstraction with one *consumer shape* and two implementations that share a MIME builder. The switch is three lines in `convex/`. See §8. |

**Installation:** none. `pnpm install` only.

## Architecture Patterns

### 1. The invite gate — `callbacks.createOrUpdateUser` (BETA-01) — **HIGH confidence, source-verified**

#### 1.1 The mechanism, and why it satisfies "no row persists"

`convexAuth({ providers, callbacks })` accepts `createOrUpdateUser` (`@convex-dev/auth@0.0.94`, `dist/server/types.d.ts:146`). Its own doc comment:

> *"Completely control account linking via this callback. This callback is called during the sign-in process, **before account creation and token generation**. If specified, this callback is responsible for creating or updating the user document."*

The call chain, verified in `dist/server/implementation/`:

```
POST /api/auth/callback/<provider>   (httpAction, index.js:~190)
  └─ handleOAuth(...)                → verified profile + tokens
  └─ const { id, ...profileFromCallback } = await provider.profile(profile, tokens)   // index.js:207
  └─ callUserOAuth(ctx, { provider, providerAccountId: id, profile, signature })
       └─ ctx.runMutation("auth:store", { args: { type: "userOAuth", ... } })   ← ONE Convex mutation
            └─ userOAuthImpl → upsertUserAndAccount → defaultCreateOrUpdateUser
                 └─ config.callbacks.createOrUpdateUser(ctx, { existingUserId, type, provider, profile })
                 └─ createOrUpdateAccount  → ctx.db.insert("authAccounts", ...)
                 └─ ctx.db.insert("authVerificationCodes", ...)
```

Everything downstream of the callback happens **in the same Convex mutation transaction**. Convex mutations are atomic: **a throw inside `createOrUpdateUser` rolls back the entire `auth:store` mutation** — no `users` row, no `authAccounts` row, no `authVerificationCodes` row, no session. That is literally the "blocked at the door, NO user/tenant row persisted" guarantee, and it needs no delete-on-no-invite compensation.

**`afterUserCreatedOrUpdated` is the wrong hook here** — `users.js:76` calls it only in the *default* branch, i.e. **it is not invoked at all when `createOrUpdateUser` is supplied**, and it runs *after* `ctx.db.insert("users", ...)`. (It would still roll back on a throw, but it is dead code the moment we take the other callback.) Use one, not both.

#### 1.2 What `createOrUpdateUser` receives — and what it does NOT

```ts
{
  existingUserId: Id<"users"> | null,      // ONLY from an existing authAccounts row (same provider + same providerAccountId)
  type: "oauth" | "credentials" | "email" | "phone" | "verification",
  provider: AuthProviderMaterializedConfig, // .id === "google" | "microsoft-entra-id" | "password"
  profile: Record<string, unknown> & { email?, phone?, emailVerified?, phoneVerified? },
  shouldLink?: boolean,
}
```

Two consequences the planner must design around:

- **`providerAccountId` (the OAuth subject) is NOT in the args.** `index.js:207` destructures `id` OUT of the profile before it ever reaches the mutation.
- **Taking this callback means we own account linking.** The default implementation's verified-email linking (`uniqueUserWithVerifiedEmail`, `users.js:88`) lives *below* our callback and never runs. `existingUserId` is non-null only for a returning identity on the *same* provider. So a user who signs up with Google and later clicks "Sign in with Microsoft" arrives as `existingUserId === null` → a **new user, a new tenant**, unless we replicate the linking ourselves.
  - **Recommendation (fail closed, lazy):** do not replicate linking. A second provider for an already-redeemed invite hits the "invite already redeemed by a different subject" rejection and is refused. Record it as a known beta limitation ("sign in with the provider you signed up with"). Cross-provider account linking is a real feature with real merge semantics and does not belong in this phase.
  - Note this is *decoupled from DLVR-02*: mailbox connection runs through the separate `/gmail/callback` HTTP route, **not** Convex Auth. A Google-signed-in user can still connect an Outlook mailbox.

#### 1.3 Getting the OAuth subject into the callback — widen `profile()`

`provider_utils.js:78-84` supplies `defaultProfile` when a provider declares none:

```js
const defaultProfile = (profile) => ({
  id:    profile.sub ?? profile.id ?? crypto.randomUUID(),
  name:  profile.name ?? profile.nickname ?? profile.preferred_username,
  email: profile.email ?? undefined,
  image: profile.picture ?? undefined,
});
```

Google (`@auth/core/providers/google.js`) is `type: "oidc"` with **no** `profile()`, so `defaultProfile` applies and `providerAccountId === profile.sub`. Microsoft Entra ID **ships** a `profile()` that also returns `id: profile.sub` — but it additionally `fetch`es `https://graph.microsoft.com/v1.0/me/photos/48x48/$value` and base64s it with `Buffer`, on every sign-in. Override it for both reasons.

```ts
// convex/auth.ts — the subject must be carried under a NON-`id` key, because
// Convex Auth strips `id` before the callback ever sees the profile (index.js:207).
import Google from "@auth/core/providers/google";
import MicrosoftEntraID from "@auth/core/providers/microsoft-entra-id";

const google = Google({
  authorization: { params: { scope: "openid email profile" } },
  profile: (p: any) => ({
    id: p.sub,            // → providerAccountId (Convex Auth strips this)
    oauthSubject: p.sub,  // → survives into callbacks.createOrUpdateUser's `profile`
    email: p.email,
    name: p.name,
    image: p.picture,
  }),
});

const microsoft = MicrosoftEntraID({
  // /common = personal + any work/school directory. This is the DEFAULT issuer in
  // @auth/core 0.41.2 (microsoft-entra-id.js) — stated here because it is load-bearing.
  authorization: { params: { scope: "openid profile email offline_access User.Read" } },
  profile: (p: any) => ({
    id: p.sub,
    oauthSubject: p.sub,
    // The `email` claim is NOT guaranteed on Entra tokens — see §1.4. preferred_username
    // is the documented fallback and is what a work account almost always carries.
    email: p.email ?? p.preferred_username,
    name: p.name,
  }),
  // ponytail: overriding profile() also drops @auth/core's per-sign-in Graph photo fetch,
  // which needs `Buffer` (absent in Convex's default runtime) and buys us nothing.
});
```

⚠️ Because `oauthSubject` now rides in `profile`, and `defaultCreateOrUpdateUser` spreads `...profile` into the `users` row, **our** `createOrUpdateUser` must strip it before inserting — or the `users` table validator will reject the write. Strip it; do not add a `users.oauthSubject` column (the subject's home is the invite row, which is where SC#2 wants it immutable).

#### 1.4 The two subject formats (SC#2's test matrix) — **HIGH confidence**

| Provider | `providerAccountId` source | Shape | Stability |
|----------|---------------------------|-------|-----------|
| Google | `sub` (OIDC) | 21-digit decimal string, e.g. `"110169484474386276334"` | Stable per Google account, app-independent |
| Microsoft Entra ID | `sub` (v2.0 id_token) | Opaque base64url-ish string, ~43-44 chars, e.g. `"AAAAAAAAAAAAAAAAAAAAAJp9j..."` — **not a GUID** | *"immutable and can't be reassigned or reused… a pairwise identifier and is unique to an application ID"* |

The Entra **`oid`** claim is the GUID and is the cross-application id; **`sub`** is per-app pairwise. Convex Auth binds `sub`. That is the right choice for an immutable per-app binding, but say it in the code comment so nobody "fixes" it to `oid` later.

**⚠️ The email half is the risk, not the subject half.** Microsoft's own id-token reference on the `email` claim:

> *"Present by default for guest accounts that have an email address. Your app can request the email claim for managed users… This value isn't guaranteed to be correct and is mutable over time. **Never use it for authorization** or to save data for a user."*

Mitigations, all cheap, all recommended together:
1. Keep `email` in the requested scopes (it is in the default Entra scope set) — this is what makes the claim appear for managed users on the v2.0 endpoint.
2. Fall back to `preferred_username` when `email` is absent (see the `profile()` above).
3. Normalise both sides before comparing: `trim().toLowerCase()`.
4. Reject with an explicit `INVITE_NO_EMAIL` code when neither claim is present, rather than matching against `undefined`.
5. Frame it correctly in the code comment: **the email is the *matching* key for a first redemption; the recorded `sub` is the *authorization* root thereafter.** That is consistent with Microsoft's warning.

#### 1.5 The invite code cannot ride the OAuth round-trip — **HIGH confidence, and it is the design's load-bearing fact**

`signIn.js → handleOAuthProvider` builds the redirect as:

```js
const redirect = new URL((process.env.CUSTOM_AUTH_SITE_URL ?? requireEnv("CONVEX_SITE_URL")) + `/api/auth/signin/${provider.id}`);
redirect.searchParams.set("code", verifier);
if (args.params?.redirectTo !== undefined) redirect.searchParams.set("redirectTo", args.params.redirectTo);
return { kind: "redirect", redirect: redirect.toString(), verifier };
```

**`redirectTo` is the only caller-supplied value that survives.** The `authVerifiers` row stores `{ signature, sessionId }` and nothing else. There is no extra-params channel for OAuth.

⇒ **For the OAuth providers the invite is matched on the verified email alone.** The typed code on `/signup` is a pre-flight validation (public query: "is this code live, and which email is it for?") plus an audit trail — it is *not* the OAuth gate. This is exactly what the owner's email-binding decision buys, and it is why the reversal of `09-CONTEXT.md`'s any-email model was necessary rather than merely preferable.

#### 1.6 The password flow is asymmetric — and needs the code as a real factor

For `type: "credentials"`, `profile` is whatever the existing `Password({ profile(params) })` returns — and **extra `signIn` params DO reach it** (`createAccountFromCredentials` → `upsertUserAndAccount`). But the email is **unverified**: anyone who knows an invited person's address could type it with any password and consume their invite.

**Recommended asymmetry** (state it in one comment at the callback):

```
type === "oauth"       → email is provider-verified ⇒ email match alone admits.
type === "credentials" → email is self-asserted     ⇒ require BOTH the email match
                          AND the single-use code (carried through Password's profile()).
```

This closes the hole with zero new infrastructure and without the transactional email sender that `<deferred>` explicitly pushes past the beta.

#### 1.7 The refusal UX — a silent bounce unless you plan for it

The OAuth callback handler wraps everything in `try { … } catch (error) { logError(error); return Response.redirect(destinationUrl); }`. A thrown invite refusal therefore lands the user **back at the app, signed out, with no message**.

**Recommendation:** always start OAuth sign-up as `signIn("google", { redirectTo: "/signup?invite=<code>&r=1" })`. `defaultRedirectCallback` permits a relative path, so it round-trips intact. `/signup` then renders "That invite could not be redeemed — check the address you signed in with" when `?r=1` and `isAuthenticated === false`. It is a heuristic (a genuine cancel looks the same), so word the copy so it is true in both cases.

#### 1.8 Sketch of the callback

```ts
// convex/auth.ts — the whole invite gate, in the one place that runs before any row exists.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [google, microsoft, password],
  callbacks: {
    async createOrUpdateUser(ctx, { existingUserId, type, provider, profile }) {
      // Returning identity on the SAME provider: never re-check the invite.
      if (existingUserId !== null) {
        await ctx.db.patch(existingUserId, userFieldsFrom(profile)); // strips oauthSubject
        return existingUserId;
      }

      const email = String(profile.email ?? "").trim().toLowerCase();
      if (!email) throw new Error("INVITE_NO_EMAIL");

      // OAuth: `sub`. Credentials: no OAuth subject exists — bind the account id form.
      const subject = String(profile.oauthSubject ?? "");

      const invite = await ctx.db
        .query("betaInvites")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      if (!invite) throw new Error("INVITE_REQUIRED");

      // Credentials: the self-asserted email is not proof — the code is (see §1.6).
      if (type === "credentials" && profile.inviteCode !== invite.code) throw new Error("INVITE_REQUIRED");

      // SC#2: cross-subject re-redemption is refused, immutably.
      if (invite.redeemedSubject && invite.redeemedSubject !== `${provider.id}|${subject}`) {
        throw new Error("INVITE_ALREADY_REDEEMED");
      }

      const userId = await ctx.db.insert("users", userFieldsFrom(profile));
      await ctx.db.patch(invite._id, {
        redeemedSubject: `${provider.id}|${subject}`, // qualified: a Google sub and an Entra sub
        redeemedUserId: userId,                       // live in different namespaces
        redeemedAt: Date.now(),
        status: "redeemed",
      });
      return userId;
    },
  },
});
```

`invite.redeemedSubject` being provider-qualified is deliberate: an unqualified subject string from two different issuers is a collision waiting to be argued about, and the qualification costs nothing.

**⚠️ CLAUDE.md §2 note:** `auth.ts` is already on the raw-builder allowlist and the callback receives a `GenericMutationCtx` from the auth package — it is not a `tenantMutation` and cannot be. That is fine and already precedented (the file's existing header says so), but the *waitlist* and *admin* functions this phase adds must be `tenantMutation`/`ownerMutation` as normal.

### 2. The owner-admin page (BETA-01 issuance + Phase 22 residue)

The three functions to host are **already** owner-gated — verified:

| Function | Builder |
|----------|---------|
| `optimizerConfig.setOptimizerEnabled` (`optimizerConfig.ts:93`) | `ownerMutation` |
| `skills.activateCandidate` (`skills.ts:183`) | `ownerMutation` |
| `skills.candidatesForReview` (`skills.ts:203`) | `ownerQuery` |

So this phase adds **zero** guards for them; it adds the *page* and the *assertions*. `owner.viewer` (`owner.ts:24`, a `tenantQuery`) is the existing hook for hiding the surface client-side. `apps/web/app/(app)/ops/page.tsx` is the pattern; the `(app)` route group is already default-deny via `apps/web/middleware.ts`.

**Note `middleware.ts`'s `isPublic` set is `["/", "/privacy", "/terms", "/signin", "/signup"]`.** A public **waitlist request** page needs a matcher edit — a security-sensitive file. The lazier option is to put the waitlist form on the existing `/signup` page (already public) with a "no code? request access" panel. **Recommend that**: one fewer public route, one fewer matcher edit, and the invite/waitlist story lives on one page.

### 3. The BETA-05 isolation suite — schema-derived enumeration — **HIGH confidence, API-verified**

#### 3.1 The API exists and is public

`convex@1.42.1`:
- `SchemaDefinition.tables` is a **public property** (`dist/esm-types/server/schema.d.ts:352`). `import schema from "./schema"; Object.keys(schema.tables)`.
- `TableDefinition.validator` is public.
- `TableDefinition[" indexes"]()` — a quoted method with a **leading space** — returns `{ indexDescriptor: string; fields: string[] }[]`. Present at runtime (`dist/esm/server/schema.js:38`). Its doc comment says *"This API is experimental: it may change or disappear."*
  - **Ponytail call:** use it, and pin the risk with a **non-vacuity assertion** — assert a known index (`contacts.by_tenant_email` or `gmailTokens.by_tenant`) appears in the result. If Convex ever removes the accessor the assertion fails loudly instead of the suite silently checking zero indexes. That is the same "the scan can see a violation when there is one" floor `contacts.test.ts:662-670` already establishes.
- The `TS-private` `indexes` array field is *also* present at runtime, but the quoted accessor is the documented one. Use the accessor.

#### 3.2 The three-bucket pattern that fails on an uncovered table

`schema.ts:11` spreads `...authTables`, so `Object.keys(schema.tables)` includes Convex Auth's own tables. Those are **not** tenant-scoped and must be exempted **explicitly and with a reason**, never skipped silently.

```ts
// convex/isolation.test.ts — the BETA-05 gate. The list is DERIVED, not authored:
// a table added in a later phase lands in neither bucket and fails HERE.
import schema from "./schema";

const ALL = Object.keys(schema.tables).sort();

/** Convex Auth's own identity plane. Not tenant-scoped BY CONSTRUCTION — tenantId is
 *  DERIVED from `users._id` (lib/functions.ts:41), so scoping them would be circular. */
const EXEMPT_AUTH = ["users", "authSessions", "authAccounts", /* … authTables */];

/** Deliberately GLOBAL. Each entry carries the reason it is not a leak. */
const EXEMPT_GLOBAL = [
  "skills",            // the registry is global by design (CLAUDE.md §5); bodies are owner-gated
  "guardrailConfig",   // ONE row, deployment-wide kill switch (schema.ts comment)
  "optimizerConfig",   // owner-gated (optimizerConfig.ts:93)
  // …
];

test("every table is either isolation-covered or explicitly exempt", () => {
  expect([...COVERED, ...EXEMPT_AUTH, ...EXEMPT_GLOBAL].sort()).toEqual(ALL);
});

/** Structural floor: a "tenant-owned" table is one whose validator carries tenantId.
 *  This catches the reverse mistake — a new tenant-owned table parked in EXEMPT_GLOBAL. */
test("no exempt-global table declares a tenantId field", () => {
  for (const name of EXEMPT_GLOBAL) {
    expect(Object.keys((schema.tables[name].validator as any).fields ?? {})).not.toContain("tenantId");
  }
});

/** Index half of "every table AND index". Every index on a tenant-owned table must lead
 *  with tenantId, or a `.withIndex` on it can range across tenants. */
test("every index on a tenant-owned table is tenant-prefixed", () => {
  for (const name of COVERED) {
    for (const ix of (schema.tables[name] as any)[" indexes"]()) {
      expect(ix.fields[0], `${name}.${ix.indexDescriptor}`).toBe("tenantId");
    }
  }
});
```

That last test is the highest-value cheap assertion in the phase: it is a **static** proof over *every index on every tenant table*, it needs no `convexTest` harness at all, and it is exactly what "covers every table and index" means in a form that cannot rot. Expect it to surface one or two legitimate exceptions on first run (a lookup index keyed on a hash or a global id) — each becomes a named, commented allow-entry, which is the honest outcome.

#### 3.3 The behavioural half — reuse 19-02's shape verbatim

`contacts.test.ts` is the template on three axes, all worth copying:
- **The harness** (`:39-51`): `convexTest(schema, modules)`, two real `users` rows, `t.withIdentity({ subject: \`${userId}|session_x\` })`. The `|session` suffix matters — `lib/functions.ts:41` derives `tenantId` from `getAuthUserId`, which splits on it.
- **The isolation describe** (`:69-180`): one test per public function, each asserting both *"B cannot read/patch A's row"* **and** *"A's row is byte-unchanged / no audit row was written"*.
- **The surface-coverage scan** (`:697-729`): `import.meta.glob("./**/*.ts", { query: "?raw", eager: true })` → regex `export const (\w+) = tenant(?:Query|Mutation|Action)\(` → `expect(found.sort()).toEqual(COVERED)`. Generalising this repo-wide (every module, not just `contacts.ts`) gives the *function*-level twin of the table-level enumeration.

#### 3.4 The pitfall that will bite: convex-test memory

`contacts.test.ts:29-38` documents it explicitly — each `convexTest(...)` boots a whole in-memory backend, `registerComponent("auditCounts", …)` loads the aggregate component tree on top, and doing that 40 times **pushed the shared vitest fork over its memory budget and killed an unrelated test file mid-run under parallel load**. A phase-wide isolation suite that spins one harness per table across ~36 tables will reproduce that failure and it will present as a flake in someone else's file.

**Recommendation:** ONE harness for the whole behavioural suite, driven table by table inside it. Register components only in the handful of tests that reach an audit path. Keep the static tests (§3.2) harness-free entirely — they are pure imports.

`vitest.config.ts` already sets `environment: "edge-runtime"`, `server.deps.inline: ["convex-test"]`, and `testTimeout: 20_000` (raised for exactly this fixed cost). **edge-runtime has no `node:fs`** — hence the `import.meta.glob(..., "?raw")` idiom for any source scan.

### 4. Microsoft Graph — the mapping (DLVR-02)

#### 4.1 Auth model

| | Gmail (today) | Microsoft Graph (this phase) |
|---|---|---|
| Authority | `https://oauth2.googleapis.com/token` (`gmail.ts:19`) | `https://login.microsoftonline.com/common/oauth2/v2.0/token` |
| Authorize | Google OAuth | `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` |
| Scopes | `gmail.modify` (restricted → CASA) | `offline_access Mail.Send Mail.Read` (+ `openid profile email User.Read` if the same app also signs in) |
| Refresh grant | `client_id`+`client_secret`+`refresh_token`+`grant_type` | Same four fields, **plus `scope`** — Entra requires the scope on the refresh call |
| Refresh-token rotation | Google returns none | **Entra returns a NEW `refresh_token` on each redemption — persist it** |
| Consent screen | "unverified app" (Testing mode) | "unverified publisher" |
| Multi-account | one Google app | `/common` covers personal MSA **and** any work/school directory from one registration |

**`/common` caveat worth writing into the plan:** an org admin can disable user consent for third-party apps, in which case a work-account user sees "Need admin approval" and cannot connect. That is a *support* outcome for the beta, not a bug — but the connect page's error copy should name it, mirroring the existing `?gmailError=` bounce in `http.ts:27`.

#### 4.2 Send — the high-leverage finding

`POST https://graph.microsoft.com/v1.0/me/sendMail` accepts **either** a JSON `message` object **or** a raw MIME body:

> *"When specifying the body in MIME format, provide the MIME content as a base64-encoded string in the request body."* · `Content-Type: text/plain` · Response `202 Accepted`, empty body.

⇒ **`buildMime()` is reused verbatim.** Same RFC-2822 string, same `multipart/mixed`, same attachment parts, same `In-Reply-To`/`References` threading headers, same CAN-SPAM footer appended at the same call site. The *only* difference in the whole send path:

```ts
// Gmail wants base64URL of the raw message (gmail.ts:142 base64Url).
// Graph wants STANDARD base64. One line, and it is the entire body difference.
const mime = buildMime(req.recipient, req.subject, req.body + footer.text, parts, threading);
const body = /* google */ base64Url(mime)
           : /* graph  */ btoa(unescape(encodeURIComponent(mime)));  // or Buffer.from(mime).toString("base64") — the module is "use node"
```

This keeps `gmail.test.ts`'s V4 byte-identity tests meaningful for both providers and means the 19-05 footer invariant (appended at the `buildMime` **call site**, never inside it) transfers with zero re-argument.

#### 4.3 Four hard parity gaps in the send path

1. **No message id.** Graph's `202 Accepted` returns an empty body. `gmail.send` audits `{ messageId: sent.id }` (`gmail.ts:~268`). The MS arm has nothing to put there.
   - **Recommendation:** omit `messageId` on the MS arm and record the gap in the audit-payload contract + `cockpit.md`. The two-call alternative (`POST /me/messages` → id → `POST /me/messages/{id}/send`) doubles the calls, doubles the failure surface, and creates a draft that survives a mid-sequence failure. Not worth it for an audit ref.
2. **4 MB limit on the MIME `/sendMail` body.** The repo's existing cap is **8 MB per plan** (`gmail.ts:78-80` ponytail note). A plan under the Gmail cap but over Graph's will 400. **The MS arm needs its own lower cap, enforced before the send.**
3. **`conversationId` ≠ `threadId`.** Gmail's send POST carries `{ raw, threadId }`; Graph's MIME send has **no** thread field — the `In-Reply-To`/`References` headers do the work (which `buildMime` already writes). But `requests.threadId` currently holds a *Gmail* thread id. Sending an MS reply with a Gmail `threadId` in the row is a silent mis-thread. **Provider-qualify the stored thread handle**, or clear it when the provider differs.
4. **`ErrorMimeContentInvalidBase64String` / 400** is the documented malformed-MIME failure. Treat 4xx as terminal (no retry) and ≥500 as transient-throw, mirroring `gmail.ts:257-263`.

#### 4.4 Read plane — endpoint mapping (MEDIUM confidence; endpoints verified, wire shapes need one live call)

| `gmail.ts` export | Gmail call | Graph counterpart | Notes |
|---|---|---|---|
| `freshAccessToken` | `POST oauth2.googleapis.com/token` | `POST login.microsoftonline.com/common/oauth2/v2.0/token` | Must re-send `scope`; must persist the returned rotated `refresh_token` |
| `send` | `POST gmail/v1/users/me/messages/send` `{raw[,threadId]}` | `POST /v1.0/me/sendMail`, `Content-Type: text/plain`, base64 MIME | §4.2-4.3 |
| `search` (contact resolution by name) | `messages?q=<name>` + per-id `format=metadata` | `GET /v1.0/me/messages?$search="<KQL>"&$select=from,subject,receivedDateTime&$top=N`, header `ConsistencyLevel: eventual` | Gmail `q=` is **not** KQL. `$search` and `$filter` **cannot combine**; `$orderby` is ignored under `$search`; result set capped (~250). |
| `listInbox` (date range) | `messages?q=after:…` | `GET /v1.0/me/mailFolders/inbox/messages?$filter=receivedDateTime ge <ISO8601>&$select=id,from,subject,receivedDateTime,bodyPreview&$orderby=receivedDateTime desc&$top=N` | **`$filter` here, not `$search`** — mutually exclusive, and the range read is exactly the case needing `$filter`. `bodyPreview` replaces Gmail's `snippet`. |
| `fetchInboxBodies` | per-id `format=full` + `pickPlainText` MIME walk | `GET /v1.0/me/messages/{id}?$select=body` with header `Prefer: outlook.body-content-type="text"` | **`pickPlainText` has no Graph analogue and must not be ported** — Graph returns HTML by default and the `Prefer` header is the supported way to get plain text. Keep `BODY_TRUNCATE_CHARS`. |
| `getReplyTarget` | `format=metadata` + `Message-ID`/`References` headers + `threadId` | `GET /v1.0/me/messages/{id}?$select=from,subject,internetMessageId,conversationId` | `internetMessageId` **is** the RFC `Message-ID` → feeds `inReplyTo`/`references` unchanged. `conversationId` is the Graph thread handle (see gap 3). |
| `buildMime` / `base64Url` | shared | **shared** (only the base64 flavour differs) | The whole point of §4.2 |

Each read-plane action already has a **`SMOKE::` / fixture-first branch** checked *before* the token (`listInbox`, `fetchInboxBodies`, `getReplyTarget` all read `internal.smoke.getInboxFixture` first). Mirror that ordering in the Graph module — it is what lets the eval/E2E paths run with no live mailbox and it is why offline verification of the MS read plane is possible at all.

### 5. Token lifetime and re-auth (DLVR-02) — **HIGH confidence**

| | Gmail (Testing mode) | Microsoft Entra |
|---|---|---|
| Access token | ~1 h | **60-90 min** (random; up to 24-28 h with CAE) |
| Refresh token | **expires in 7 days** (Testing mode) | **Max Inactive Time 90 days; Max Age "Until-revoked"** — and *not configurable* since 2021-01-30 |

⇒ **The 7-day rule is Google-Testing-mode-specific and must not be generalised.** Concretely:
- `flagExpiringTokens` (`gmailAuth.ts:217`, wired as a `crons.daily` at `crons.ts:14`) computes an age threshold. It must become **provider-aware** or it will nag every Outlook user weekly for no reason.
- `SEND_TIME_HORIZON_MS` (7 days, the far-future scheduled-send cap at `cockpit.ts:836`) was chosen *because* of the Gmail token life. **Leave it at 7 days.** Do not widen it for Outlook: the horizon must hold for the *worst* connected provider on the plan, and a mixed-provider fan-out makes per-provider horizons a correctness trap for one saved day.
- MS rotates refresh tokens. If the adapter does not persist the returned `refresh_token`, the 90-day inactivity clock runs against a token that is being silently replaced — and the user is disconnected out of nowhere ~90 days in. One line; easy to miss.

### 6. BETA-03 — where the first-send offer attaches

#### 6.1 The existing path (do not build a second one)

```
onboarding.status (tenantQuery, onboarding.ts:142) → { needsOnboarding }   ← runs on EVERY authenticated page render
   └─ apps/web/app/(app)/dashboard/onboarding/page.tsx
        └─ onboarding.converse (tenantAction, :394)   ← 15.1; STATELESS, writes nothing;
        │     system prompt = the UNGATED `onboarding-agent` skill row (§5, fails closed)
        │     `done` = canComplete(slots), NEVER read off the model's reply
        ├─ api.tenantProfile.saveFacts   ← the ONLY tier writer
        └─ onboarding.commitProfile (tenantMutation, :565)
              throws INCOMPLETE_ONBOARDING; writes the profile vault doc + ONE audit row
```

**The first-send offer attaches AFTER `commitProfile`, in the cockpit.** It must **not** go inside `converse`: that function's `done` is a closed contract (`canComplete(slots)` over `REQUIRED_SLOTS`), and 15.1's design §6 explicitly forbids putting a completion guarantee in the prompt. Adding a step there re-opens a settled invariant.

`onboarding.status`'s `needsOnboarding` is the natural "is this a brand-new user" signal the cockpit can read to decide whether to make the offer — it is already a tenantQuery, already called on every render, and already documented as running hot (`by_tenant_kind`, "must never widen to the whole vault again").

#### 6.2 ⚠️ THE BLOCKER: a new user's first Approve is refused today

Two locked decisions collide:

- **19-03 / `docs/playbooks/onboarding.md`:** `tenantProfiles.postalAddress` is *"deliberately absent from `missingSlots`/`canComplete`: enrichment, not an onboarding slot… never a question in the onboarding conversation."* Its only typing surface is a textarea on `/dashboard/profile`.
- **19-05 / `cockpit.ts:820-826`:** `executePlan` returns `{ ok: false, reason: "no_postal_address" }` **at the human Approve gate** when the address is blank. And `gmail.ts:240-244` throws `"no unsubscribe footer could be built"` if it somehow got past.

⇒ **A brand-new user who reaches PLAN → Approve is refused.** BETA-03's "first delivered result in minutes" is unreachable without resolving this, and it is not discoverable offline (it looks fine in every test that uses `__seedOnboardedTenant`, which seeds a postal address at `onboarding.ts:655` precisely for this reason).

Options, with a recommendation:

| Option | Verdict |
|---|---|
| Add `postalAddress` to `missingSlots`/`canComplete` | **No.** Breaks 19-03's stated invariant, changes onboarding-completeness semantics for every existing tenant, and `commitProfile`'s `INCOMPLETE_ONBOARDING` contract with it. |
| **Surface it inline in the cockpit's first-send offer, triggered by the existing `no_postal_address` refusal reason** | **Recommended.** Reuses the `tenantProfile.saveFacts` write boundary (already trim-validated, 500-char-capped), reuses the refusal reason as the trigger, adds no table, no route, no gate — and keeps 19-03's "not an onboarding slot" literally true. Structurally identical to the already-locked "connect the mailbox inline at first Approve (soft)" decision. |
| Route the welcome email through a footer-exempt path | **No.** `notifyExternal`'s exemption exists because it is the *owner's own service notice*. Making the welcome send exempt would mean BETA-03's "first delivered result" is not a real governed send — which the context explicitly forbids ("Not a sandbox, not a no-op"). |

Whichever the planner picks, this belongs in an **early task with an explicit verification**, not a late discovery: it is the difference between BETA-03 passing and BETA-03 failing at live UAT.

#### 6.3 The §5 skill-gate cost of the greeting

Changing the `cockpit-agent` **skill body** to add a first-run greeting/offer is a **GATED** edit: `pnpm eval:golden`, plus reading back the **live** version before activating (`seedSkills` writes `maxVersion + 1`, and optimizer dry-run candidates occupy versions — the recorded version-collision gotcha). The live body was certified at **v17** by gate `14feb4b7` (34/34, 2026-08-08), **but 18-09/18-10, 20-12 and 20.1 all edit the same single candidate stream**, so *do not pin a version number in the plan* — read it at execution time.

**Cheaper alternative worth a `checkpoint:decision` or a planner call:** deliver the greeting as a **seeded first thread message / UI-side opener** rather than a skill-body edit. The offer's wording is Claude's discretion per CONTEXT, and a seeded opening message is not an agent prompt in the §5 sense (it is content, not a system prompt), so it needs no eval gate. If the offer must *change the agent's behaviour* (e.g. it must know to run resolve → PLAN in one tap), the skill edit is unavoidable — budget the gate.

### 7. What BETA-05 must additionally assert

Beyond the table matrix: a **non-owner** identity calling each of `optimizerConfig.setOptimizerEnabled`, `skills.activateCandidate`, `skills.candidatesForReview` must reject with `OWNER_REQUIRED` (`lib/functions.ts:58`). All three are already `ownerMutation`/`ownerQuery`, so these are three short `rejects.toThrow(/OWNER_REQUIRED/)` tests — cheap, and they are the regression net if anyone ever "simplifies" a builder.

Also assert the **owner's pre-existing single-tenant data stays attributed to the owner** once user B exists. No backfill is needed (`tenantId` was always written), but the assertion is the whole point of the culminating test.

### 8. The provider seam — shape and the callers that must all move

**Current call sites of the send action (verified by grep, non-test):**

| File | Line | Role |
|---|---|---|
| `deliverApprovedPlan.ts` | 37 | `step.runAction(internal.gmail.send, { requestId })` — the cockpit fan-out |
| `pipeline.ts` | 379 | `step.runAction(internal.gmail.send, { requestId })` — **the second production caller**, explicitly recorded in 19-05 as the one a prior plan missed |
| `notifyExternal.ts` | — | imports `SEND_ENDPOINT` + `buildMime` directly — the owner's own service notice, **no footer** |

A routing change that edits only `deliverApprovedPlan` leaves the pipeline lane Gmail-only, silently. **Both must move in the same commit.** `notifyExternal` should be left alone and the decision recorded: it is a service notice to the owner's own mailbox, it has no recipient to route for, and giving it provider choice is scope with no user.

**Recommended shape (smallest thing that works, per §8):**

```
convex/delivery.ts   ← NEW. `export const send = internalAction({ args:{requestId}, … })`
                        reads the request row, switches on its `provider`, and calls
                        internal.gmail.send / internal.graph.send. ~15 lines.
convex/graph.ts      ← NEW. The MS mirror of gmail.ts. "use node".
convex/gmail.ts      ← unchanged except the shared MIME/base64 export.
deliverApprovedPlan.ts:37 / pipeline.ts:379  ← one identifier each.
```

Not a `packages/delivery` package (no pure-domain logic to host — it is all HTTP + tokens), not a `DeliveryProvider` interface, not a registry. The switch **and** `graph.ts` ship in one commit; the switch has two arms from the moment it exists.

**Schema widening — and the trap in it:**

```ts
gmailTokens: defineTable({
  tenantId: v.string(),
  provider: v.string(),      // "google" | "microsoft"  ← REQUIRED, backfilled by migration
  refreshToken: v.string(),
  accessToken: v.optional(v.string()),
  expiresAt: v.optional(v.number()),
  scope: v.string(),
  updatedAt: v.number(),
}).index("by_tenant", ["tenantId"])
  .index("by_tenant_provider", ["tenantId", "provider"]),
```

⚠️ **Do not make `provider` optional to dodge the migration.** A Convex index treats an absent field as `undefined`, so `.withIndex("by_tenant_provider", q => q.eq("tenantId", t).eq("provider", "google"))` **will not match pre-widening rows** — and the visible symptom is *the owner's live Gmail connection disappearing*. Ship a tracked `@convex-dev/migrations` backfill (OPSG-06, the established pattern) setting `provider: "google"` on every existing row, and keep `by_tenant` (five existing readers use it: `getTokens`, `getForDelivery`, `gmailStatus`, `disconnectGoogle`, `flagExpiringTokens`).

**Where the per-send provider choice lives:** put it on the **`requests` row** at seed time, alongside `recipient`/`draft`. Both `gmail.send` and `graph.send` already read that row as their first act (`gmail.ts:164`), so the dispatcher reads it from a row it was going to read anyway — no new argument threaded through workflow steps, no signature churn in `deliverApprovedPlan`/`pipeline`, and a mixed-provider fan-out is free.

**Table `gmailTokens` should probably be renamed** — but renaming a Convex table is a migration with no upside for the beta. `// ponytail: the table is named gmailTokens and now holds Microsoft rows too; renaming costs a full data migration for a name. Upgrade path: rename when a third provider arrives.`

### Anti-Patterns to Avoid

- **Landing the provider seam in an earlier wave than `graph.ts`.** CLAUDE.md §8 and Roadmap SC#5 both forbid it explicitly. Same commit.
- **Deleting an orphan user after the fact.** Unnecessary — the transaction rollback is complete and free. A delete-on-no-invite path would be a compensating action for a problem that does not exist.
- **Authorizing on the Microsoft `email` claim after first redemption.** Microsoft says never to. The recorded `sub` is the authorization root.
- **Hand-authoring the BETA-05 table list.** The whole point of the owner's decision is that the list rots.
- **One `convexTest` harness per table.** It will OOM the shared vitest fork and present as a flake in someone else's file (§3.4).
- **Porting `pickPlainText` to Graph.** Graph has no MIME-part tree; `Prefer: outlook.body-content-type="text"` is the supported mechanism.
- **Widening `SEND_TIME_HORIZON_MS` for Outlook.** The horizon must hold for the worst connected provider on the plan.
- **Adding `postalAddress` to the onboarding slot set.** Breaks a documented 19-03 invariant and `commitProfile`'s contract.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Blocking an uninvited OAuth sign-in with no residue | Post-hoc orphan sweeper / delete-on-no-invite | `callbacks.createOrUpdateUser` + `throw` | The Convex mutation transaction already rolls back the user row, the account row and the verification code atomically |
| Getting the OAuth subject to the gate | Parsing `authAccounts` after the fact, or a second lookup mutation | A widened provider `profile()` carrying `oauthSubject` | Convex Auth strips `id` at `index.js:207`; nothing else survives |
| Enumerating tables and indexes | A hand-written array, or parsing `schema.ts` with a regex | `schema.tables` + `TableDefinition[" indexes"]()` | Public runtime API; a regex over the source cannot see index field ORDER, which is the thing that matters |
| Sending Outlook mail | A second MIME builder, or Graph's JSON `message` shape | `buildMime()` + base64 → `POST /me/sendMail` `Content-Type: text/plain` | Reuses the byte-pinned builder, the attachment parts, the threading headers and the 19-05 footer call-site invariant for free |
| MS token refresh | `@azure/msal-node` | The four-field form POST `freshAccessToken` already implements | MSAL's token cache duplicates the DB, which is the actual cache |
| Required-env validation | A schema library, or a build-time check | One array + `.filter(k => !process.env[k])` in a `convex run`-able internal function | Convex env is **per-deployment and read at call time** — a build-time check would validate the wrong environment |
| Cross-provider account linking | Replicating `uniqueUserWithVerifiedEmail` | Nothing — refuse and defer | Merge semantics are a feature, not a side effect of an invite gate |

**Key insight:** every hard part of this phase already has a mechanism sitting in an installed package or an existing module. The phase's difficulty is *sequencing and verification*, not construction.

## Common Pitfalls

### Pitfall 1: The silent OAuth bounce
**What goes wrong:** an invite refusal throws, Convex Auth catches it and `Response.redirect(destinationUrl)`s — the user lands back in the app with no explanation and no error.
**Why:** `implementation/index.js`'s callback handler wraps the whole flow in `try/catch { logError; redirect }`.
**How to avoid:** always pass `redirectTo: "/signup?invite=<code>&r=1"` on OAuth sign-up and render the refusal copy on `/signup`. Word it to be true for a genuine cancel too.
**Warning sign:** UAT reports "clicking Sign in with Google does nothing."

### Pitfall 2: The optional `provider` column that reads as `undefined`
**What goes wrong:** existing `gmailTokens` rows do not match `.eq("provider", "google")`; the owner's live mailbox appears disconnected.
**Why:** a Convex index stores absent as `undefined`, which is not `"google"`.
**How to avoid:** required column + tracked `@convex-dev/migrations` backfill.
**Warning sign:** `gmailStatus` flips to not-connected right after the deploy.

### Pitfall 3: Only one send call site rewritten
**What goes wrong:** cockpit sends route by provider, pipeline sends silently stay Gmail.
**Why:** `internal.gmail.send` has **two** production callers; 19-05 already caught a plan asserting one.
**How to avoid:** a static test asserting `internal.gmail.send` appears in zero non-test files after the seam lands (the `importGuard.test.ts` / `contacts.test.ts:707` scan idiom).
**Warning sign:** an Outlook-selected plan delivers from Gmail with no error.

### Pitfall 4: The 4 MB Graph MIME ceiling under an 8 MB app cap
**What goes wrong:** a plan with attachments passes the app's cap and 400s at Graph.
**Why:** `/sendMail` MIME bodies cap at 4 MB; the repo caps at 8 MB per plan.
**How to avoid:** provider-aware cap enforced before the send, with a nameable refusal reason.
**Warning sign:** `ErrorMimeContentInvalidBase64String` or a bare 400 on attachment-bearing MS sends.

### Pitfall 5: convex-test memory blowup presenting as someone else's flake
**What goes wrong:** the new isolation suite passes alone, and `vaultDigest.test.ts` dies mid-file under full-suite parallel load.
**Why:** each `convexTest` boots an in-memory backend; `registerComponent` loads the aggregate tree. Documented at `contacts.test.ts:29-38`.
**How to avoid:** one harness, components registered only where needed, static tests kept harness-free.
**Warning sign:** an unrelated test file fails in CI and passes locally.

### Pitfall 6: `$search` and `$filter` used together on Graph messages
**What goes wrong:** the date-ranged inbox list 400s.
**Why:** Graph forbids combining them on message collections; `$orderby` is also ignored under `$search`.
**How to avoid:** `$search` for name resolution, `$filter` for the date range. Two different calls, deliberately.

### Pitfall 7: The postal-address refusal discovered at live UAT
**What goes wrong:** every offline test passes (they use `__seedOnboardedTenant`, which seeds an address), and the first real beta user's first Approve is refused.
**How to avoid:** a test that drives the first-send offer against a tenant with **no** `postalAddress` and asserts the flow reaches a delivered send. §6.2.

### Pitfall 8: Pinning `cockpit-agent`'s version in the plan
**What goes wrong:** the plan activates the wrong body, or the eval gate certifies a version the optimizer already occupies.
**Why:** `seedSkills` writes `maxVersion + 1`; dry-run candidates occupy versions; three other phases edit the same candidate stream.
**How to avoid:** read the live version at execution time; never write a number into the plan.

### Pitfall 9: A new file with no playbook, blocking the turn
**What goes wrong:** the Stop hook (`scripts/check-playbooks.mjs` + `docs/playbooks/watch.json`) blocks finishing a turn that adds `convex/invites.ts`, `convex/graph.ts`, `convex/delivery.ts` or `apps/web/app/(app)/admin/` with no covering playbook.
**How to avoid:** plan for **one new playbook (`beta-admission.md`)** covering invites + waitlist + the admin page, registered in `watch.json`; extend `cockpit.md`'s list for `graph.ts`/`delivery.ts`. See §Playbook Obligations.

## Code Examples

### Enumerate every table and index from `schema.ts` at test time
```ts
// Source: convex@1.42.1 dist/esm-types/server/schema.d.ts:352 (`tables`), dist/esm/server/schema.js:38 (`" indexes"`)
import schema from "./schema";

const tables = Object.keys(schema.tables);                       // includes ...authTables
const indexesOf = (t: string) =>
  (schema.tables[t] as any)[" indexes"]() as { indexDescriptor: string; fields: string[] }[];
const fieldsOf = (t: string) =>
  Object.keys((schema.tables[t].validator as any).fields ?? {});

// Non-vacuity floor — if Convex ever drops the accessor, fail LOUDLY.
expect(indexesOf("gmailTokens").map((i) => i.indexDescriptor)).toContain("by_tenant");
```

### The two-tenant harness (19-02's shape — copy it)
```ts
// Source: packages/backend/convex/contacts.test.ts:39-51
async function harness() {
  const t = convexTest(schema, modules);
  const userA = await t.run((ctx) => ctx.db.insert("users", {}));
  const userB = await t.run((ctx) => ctx.db.insert("users", {}));
  return {
    t,
    tenantA: String(userA), tenantB: String(userB),
    // the `|session` suffix is load-bearing: lib/functions.ts:41 splits on it
    asA: t.withIdentity({ subject: `${userA}|session_a` }),
    asB: t.withIdentity({ subject: `${userB}|session_b` }),
  };
}
```

### Graph send — the whole difference from Gmail
```ts
// Source: https://learn.microsoft.com/en-us/graph/api/user-sendmail (Example 4, MIME format)
const mime = buildMime(req.recipient, req.subject, req.body + footer.text, parts, threading);
const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
  method: "POST",
  headers: { Authorization: `Bearer ${access.token}`, "Content-Type": "text/plain" },
  body: Buffer.from(mime, "utf8").toString("base64"),   // STANDARD base64, not base64url
});
// 202 Accepted, EMPTY body — there is no message id to audit (see §4.3.1).
if (res.status >= 500) throw new Error(`graph.send: transient ${res.status}`);   // retrier retries
if (res.status !== 202) throw new Error(`graph.send: ${res.status} ${await res.text()}`); // terminal
```

### Graph refresh — mirrors `freshAccessToken` exactly, plus two fields
```ts
// Source: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
const r = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: process.env.MS_OAUTH_CLIENT_ID ?? "",
    client_secret: process.env.MS_OAUTH_CLIENT_SECRET ?? "",
    refresh_token: token.refreshToken,
    grant_type: "refresh_token",
    scope: "offline_access Mail.Send Mail.Read",   // REQUIRED by Entra on refresh; Google omits it
  }),
});
const t = await r.json();
// Entra ROTATES: persist the new refresh_token or the 90-day inactivity clock runs on a stale one.
await ctx.runMutation(internal.gmailAuth.updateAccess, {
  tenantId, provider: "microsoft",
  accessToken: t.access_token,
  refreshToken: t.refresh_token,                    // ← the line that is easy to omit
  expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000,
});
```

## Production Secret Inventory (research Q5)

Enumerated from `process.env` references across `packages/backend/convex` + `apps/web`, plus the two auth packages' own `requireEnv`/`setEnvDefaults` reads (which never appear as source literals).

### Convex deployment env (`npx convex env set`) — hosted deployment
| Key | Consumer | Failure if missing |
|---|---|---|
| `SITE_URL` | Convex Auth `requireEnv` (`redirects.js`), `http.ts:24` gmail bounce | **Auth throws.** Sign-in dead. |
| `CONVEX_SITE_URL` | Convex Auth OAuth redirect; `contacts.footerFor:535` | **Every send refused** (footer unbuildable) |
| `JWT_PRIVATE_KEY` | Convex Auth token signing | Sign-in dead. **Not inherited by a fresh prod deployment** |
| `JWKS` | Convex Auth token verification | Sign-in dead. Same |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | `@auth/core` `setEnvDefaults` (`AUTH_${ID}_ID` / `_SECRET`) | Google sign-in dead |
| **NEW** `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET` | same convention (`microsoft-entra-id` → `MICROSOFT_ENTRA_ID`) | MS sign-in dead |
| *(opt)* `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | defaults to `https://login.microsoftonline.com/common/v2.0` | leave unset for `/common` |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `GMAIL_OAUTH_REDIRECT_URI` | `http.ts:46-48`, `gmail.ts:45-46` | **Mailbox** connect + every refresh dead. **Distinct from the sign-in app.** |
| **NEW** `MS_OAUTH_CLIENT_ID` / `_SECRET` / `MS_OAUTH_REDIRECT_URI` | the new `graph.ts` / `/ms/callback` | Outlook connect dead |
| `UNSUBSCRIBE_SECRET` | `contacts.ts:389`, `resolveUnsubToken` | **Every unsubscribe link 404s AND every send is refused** (19-04/19-05). Currently LOCAL-only. |
| `SKILLOPT_TOKEN` | `http.ts:90,111` | `/skillopt/*` 401 (fail-closed — safe, but the optimizer loop is dead) |
| `SKILLOPT_OWNER_TENANT` | `http.ts:132` | writeback inserts the candidate but skips audit+notify |
| `OPENAI_API_KEY` | `llm.ts` | every agent turn dead |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini paths | those paths dead |
| `GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_VERTEX_LOCATION` | Vertex | those paths dead |
| `TAVILY_API_KEY` | Phase 16 web research | research dead |
| `FAL_WEBHOOK_SECRET` (+ the fal API key) | `http.ts` fal webhook, media submit | media dead |
| `MEDIA_RENDER_SECRET` | `http.ts:409` | render blob route 401 |
| `AWS_REGION` + AWS credentials, `WORM_BUCKET` | `worm.ts` daily export cron | WORM export dead (silent until audited) |

### Vercel env (client/deploy only)
`NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOY_KEY`. **Nothing else** (README "Secrets plane").

### Post-deploy step that is NOT a secret but IS a go-live gate
`pnpm --filter @pikar/backend seed` — `npx convex deploy` does **not** run functions, and an unseeded deployment **dead-letters EVERY request** with `NO_ACTIVE_SKILL: executive-router`. This belongs in the deploy runbook next to the env list, not in a footnote.

### The fail-closed check — recommended shape
There is no env manifest in the repo today. Convex env is **per-deployment and read at call time**, so a build-time check would validate the wrong environment.

```ts
// convex/lib/env.ts — ONE array, ONE filter. Run it against the DEPLOYMENT, after deploy.
export const REQUIRED_ENV = ["SITE_URL", "JWT_PRIVATE_KEY", "JWKS", "AUTH_GOOGLE_ID", /* … */] as const;

// convex/ops.ts (ownerQuery — the list of KEYS is not secret, the VALUES never leave)
export const envCheck = ownerQuery({
  args: {},
  handler: async () => ({ missing: REQUIRED_ENV.filter((k) => !process.env[k]) }),
});
```
Then `npx convex run ops:envCheck` as a deploy-runbook step, and surface `missing` on the owner-admin page (empty list = green). Do **not** throw at module scope — a module-scope throw in a Convex deployment makes *every* function unloadable, which turns one missing optional key into a total outage.

## Custom-domain decision brief (SC#6) — facts for the `checkpoint:decision`

Hand the owner these four, then let them choose:

1. **`http.ts:12` — `auth.addHttpRoutes(http)`.** The OAuth sign-in and callback routes live on the **Convex site origin**, the same host as `/unsubscribe/`, `/fal/callback/`, `/media/blob/`, `/skillopt/*`. A spam or reputation flag on `*.convex.site` therefore breaks **SIGN-IN**, not merely a page.
2. **Every email already ships that host.** `contacts.footerFor:535` builds the CAN-SPAM unsubscribe URL from `CONVEX_SITE_URL`. Every governed send today embeds a `*.convex.site` link in a stranger's inbox. This is not a future exposure; it is live.
3. **Deployment-scoped URLs do not survive a migration.** A link a beta user emailed a client dies if the deployment changes.
4. **Convex supports custom domains** on both the `.convex.cloud` (API) and `.convex.site` (HTTP action) origins — **on paid plans**. *(MEDIUM confidence: confirm the account's current plan tier before the checkpoint, since it decides whether "yes" is even available today.)*

Both outcomes may be recorded, but only Branch A is completion-capable. Branch B is an explicit
phase blocker: disabling user-shareable URLs also disables the governed BETA-03 self-send and
DLVR-02 Outlook-send evidence, so no deploy/live gate or bookkeeping closure may proceed.

## Playbook Obligations (CLAUDE.md §9 — Stop-hook enforced)

Touching a watched path without updating its playbook **in the same commit** blocks the turn. From `docs/playbooks/watch.json`:

| Playbook | Watched paths this phase will touch |
|---|---|
| `authorization.md` | `convex/lib/functions.ts`, `convex/owner.ts`, `apps/web/app/(app)/ops/` |
| `cockpit.md` | `convex/gmail.ts`, `convex/gmailAuth.ts`, `convex/http.ts`, `convex/deliverApprovedPlan.ts`, `convex/pipeline.ts`, `convex/cockpit.ts`, `apps/web/app/(app)/connect-gmail/`, `apps/web/e2e/` |
| `contacts-crm.md` | `convex/contacts.ts` |
| `onboarding.md` | `convex/onboarding.ts`, `convex/tenantProfile.ts`, `apps/web/app/(app)/dashboard/onboarding/`, `.../profile/` |
| `skill-registry.md` | `convex/skills.ts`, `packages/contracts/skills/` |
| `ci-gate.md` | `package.json`, `.github/workflows/ci.yml` |

**New files with no coverage will BLOCK the turn.** Expected new files: `convex/invites.ts`, `convex/delivery.ts`, `convex/graph.ts`, `convex/isolation.test.ts`, `apps/web/app/(app)/admin/`.
**Recommendation:** one new playbook, `beta-admission.md`, registered in `watch.json` covering `convex/invites.ts`, `convex/auth.ts`, `apps/web/app/(auth)/signup/`, `apps/web/app/(app)/admin/`; extend `cockpit.md`'s array with `convex/delivery.ts` + `convex/graph.ts`. Note `convex/auth.ts` is currently in **no** watch entry despite being the authorization front door — folding it into `beta-admission.md` closes that gap.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| `afterUserCreatedOrUpdated` as the sign-in hook | `createOrUpdateUser` when you need to run **before** the insert | present in `@convex-dev/auth@0.0.94` | The two are mutually exclusive (`users.js:76` is in the default branch). Pick one. |
| `@auth/core/providers/azure-ad` | **`microsoft-entra-id`** | Auth.js renamed it; both ship in 0.41.2 | Use `microsoft-entra-id`; `azure-ad` is the legacy id and defaults to a v1.0-era config |
| Configurable Entra refresh-token lifetime policies | **Retired 2021-01-30** — defaults only (90-day inactivity, until-revoked max age) | 2021 | Any plan assuming a tunable MS refresh window is wrong; use Conditional Access sign-in frequency if it ever matters |
| Graph JSON `message` body for sending | **Raw base64 MIME on `/me/sendMail`** is fully supported | v1.0, long-standing | Lets `buildMime` be shared — the single biggest scope reduction available in DLVR-02 |

**Deprecated / not applicable here:**
- Gmail's `format=metadata` MIME-part walk (`pickPlainText`): no Graph analogue; `Prefer: outlook.body-content-type="text"` replaces it.
- `SKILLOPT_OWNER_TENANT` as an owner primitive: superseded by `users.owner` + `requireOwner` (Phase 22). It survives **only** as the writeback audit tenant (`http.ts:132`) and must stay set.

## Open Questions

1. **Does Graph's raw-MIME send honour `In-Reply-To`/`References` for threading in Outlook's UI?**
   - Known: the headers are standards-compliant and Graph accepts arbitrary internet message headers; `sendMail`'s MIME body is passed through.
   - Unclear: whether Outlook's conversation view groups on them, or only on `conversationId`/`conversationIndex`.
   - **Recommendation:** verify with ONE live reply during the MS UAT checkpoint. If it does not thread, the fallback is `POST /me/messages/{id}/createReply` → patch body → `/send`, which is a different (three-call) shape — so do **not** discover this at the end of the lane. **MEDIUM confidence.**

2. **Does `ConsistencyLevel: eventual` help or hurt `$search` on `/me/messages`?**
   - Sources conflict: the header is documented as required for `$search` on **directory** objects; mail `$search` docs do not require it. Sending it appears harmless.
   - **Recommendation:** send it; assert on the result shape, not on the header.

3. **How many Convex Auth `authTables` does the pinned version define, and are any of them tenant-relevant?**
   - Resolve mechanically at plan time: `Object.keys(schema.tables)` minus the 36 tables defined in `schema.ts` **is** the answer, and the enumeration test forces it to be written down.

4. **What is the Convex account's plan tier?**
   - Decides whether the custom-domain "yes" branch of SC#6 is even available today. **Confirm before the checkpoint task runs.**

5. **Does the Azure app registration need `signInAudience: AzureADandPersonalMicrosoftAccount` set explicitly for `/common` to admit personal accounts?**
   - Almost certainly yes (it is the registration-time audience, not a runtime parameter), and note that token-lifetime policies are **unsupported** for that audience — which does not matter here since we accept the defaults.
   - **Recommendation:** fold into the Azure-registration task's checklist; it is a portal setting, not code.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `vitest` ^3.2.7 + `convex-test` 0.0.54 (backend) · `@playwright/test` (web e2e) |
| Config file | `packages/backend/vitest.config.ts` — `environment: "edge-runtime"`, `server.deps.inline: ["convex-test"]`, `include: ["convex/**/*.test.ts"]`, `testTimeout: 20_000` |
| Quick run command | `pnpm --filter @pikar/backend exec vitest run convex/<file>.test.ts` |
| Full suite command | `pnpm test` (turbo, all packages) |
| E2E command | `pnpm test:e2e` (Playwright, `apps/web/e2e/`, storage-state via `auth.setup.ts`) |
| Skill gate | `pnpm eval:golden` — **required** if the `cockpit-agent` body changes (§6.3) |
| Boot gate | `pnpm boot:check` (install → codegen → typecheck) · `pnpm lint` (biome ci) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| BETA-01 | A sign-in whose email has no approved invite throws and **persists zero rows** (`users`, `authAccounts`, `authVerificationCodes` all empty after) | unit | `pnpm --filter @pikar/backend exec vitest run convex/invites.test.ts` | ❌ Wave 0 |
| BETA-01 | A valid invite admits, records `redeemedSubject` + `redeemedAt`, and flips the row to `redeemed` | unit | same | ❌ Wave 0 |
| BETA-01 | **Cross-subject re-redemption is refused** — driven twice, once with a Google-shaped `sub` (21-digit decimal) and once with an Entra-shaped `sub` (opaque ~44-char) | unit | same | ❌ Wave 0 |
| BETA-01 | A returning identity on the same provider (`existingUserId !== null`) skips the invite check entirely | unit | same | ❌ Wave 0 |
| BETA-01 | Password sign-up with a matching email but the **wrong code** is refused (§1.6 asymmetry) | unit | same | ❌ Wave 0 |
| BETA-01 | Waitlist request → `ownerMutation` approve → single-use code minted; a non-owner approve throws `OWNER_REQUIRED` | unit | same | ❌ Wave 0 |
| BETA-01 | **Real Google + real Microsoft OAuth against the hosted deployment**, uninvited AND invited | **manual — live owner checkpoint** | — | n/a |
| BETA-02/05 | **Every table in `schema.tables` is COVERED or explicitly EXEMPT** — an unclassified table fails | unit (static, no harness) | `pnpm --filter @pikar/backend exec vitest run convex/isolation.test.ts` | ❌ Wave 0 |
| BETA-02/05 | **Every index on every tenant-owned table leads with `tenantId`** (via `TableDefinition[" indexes"]()`), with a non-vacuity floor | unit (static) | same | ❌ Wave 0 |
| BETA-02/05 | No `EXEMPT_GLOBAL` table declares a `tenantId` field (catches the reverse mistake) | unit (static) | same | ❌ Wave 0 |
| BETA-02/05 | Two-user behavioural cross-read/cross-write across every tenant-owned table — B reads nothing of A's and writes nothing into A's scope | unit (ONE `convexTest` harness) | same | ❌ Wave 0 |
| BETA-02/05 | The owner's pre-existing rows stay attributed to the owner once user B exists | unit | same | ❌ Wave 0 |
| BETA-02/05 | A non-owner is rejected by `optimizerConfig.setOptimizerEnabled`, `skills.activateCandidate`, `skills.candidatesForReview` (`OWNER_REQUIRED`) | unit | same | ❌ Wave 0 |
| BETA-02/05 | Grounded-prose export stays owner-gated (the `packages/pii` names-in-prose unlock) | unit | `... vitest run convex/skilloptExport.test.ts` | ⚠️ extend existing |
| BETA-03 | `onboarding.status` → cockpit first-send offer appears for `needsOnboarding === true` and not otherwise | unit | `... vitest run convex/onboarding.test.ts` | ⚠️ extend existing |
| BETA-03 | **A tenant with NO `postalAddress` can complete the first-send offer** — the §6.2 blocker, proven not assumed | unit | `... vitest run convex/cockpit.test.ts` | ⚠️ extend existing |
| BETA-03 | The offer works on a **thin idea-stage profile** (only `oneLineDescription` + persona) | unit | same | ⚠️ extend existing |
| BETA-03 | One tap runs resolve → PLAN → Approve → delivered against the `SMOKE::` fixture spine | e2e | `pnpm test:e2e -- e2e/onboarding-first-send.spec.ts` | ❌ Wave 0 |
| BETA-03 | A brand-new invited human reaches a **real delivered email to their own address within minutes** | **manual — live owner checkpoint** | — | n/a |
| BETA-03 | If the `cockpit-agent` body changes: the gate passes at the LIVE version | gate | `pnpm eval:golden` | ✅ exists |
| DLVR-02 | `graph.send` builds the SAME `buildMime` bytes as `gmail.send` for identical input (only the base64 flavour differs) | unit | `... vitest run convex/graph.test.ts` | ❌ Wave 0 |
| DLVR-02 | `graph.send` refuses a suppressed recipient before minting a credential, and appends the CAN-SPAM footer at the call site (19-05 parity) | unit | same | ❌ Wave 0 |
| DLVR-02 | ≥500 throws (retrier retries); non-202 4xx is terminal | unit | same | ❌ Wave 0 |
| DLVR-02 | Provider-aware attachment cap: an >4 MB MIME is refused before the Graph POST | unit | same | ❌ Wave 0 |
| DLVR-02 | The MS refresh persists the **rotated** `refresh_token` | unit | same | ❌ Wave 0 |
| DLVR-02 | Per-send routing: a `provider: "microsoft"` request reaches `graph.send`, `"google"` reaches `gmail.send` | unit | `... vitest run convex/delivery.test.ts` | ❌ Wave 0 |
| DLVR-02 | **`internal.gmail.send` appears in ZERO non-test source files** after the seam lands (catches the missed `pipeline.ts` caller) | unit (static scan, `import.meta.glob "?raw"`) | same | ❌ Wave 0 |
| DLVR-02 | `gmailTokens.provider` backfill migration sets `"google"` on every pre-existing row | unit | `... vitest run convex/migrations.test.ts` | ⚠️ extend existing |
| DLVR-02 | Read plane against the `SMOKE::` fixtures: search / listInbox / fetchBodies / getReplyTarget all fixture-first, before the token | unit | `... vitest run convex/graph.test.ts` | ❌ Wave 0 |
| DLVR-02 | **A real Outlook send lands in a real inbox; a real reply threads in Outlook's conversation view** | **manual — live owner checkpoint** | — | n/a |
| Go-live | `ops:envCheck` returns `missing: []` on the hosted deployment | smoke | `npx convex run ops:envCheck` | ❌ Wave 0 |
| Go-live | Skill registry seeded post-deploy (`executive-router` active) | smoke | `pnpm --filter @pikar/backend seed` | ✅ exists |
| Go-live | Phase 22's outstanding `/ops` DOM UAT half, closed on the new admin page | e2e | `pnpm test:e2e -- e2e/admin.spec.ts` | ❌ Wave 0 |
| SC#6 | Branch A durable domain/DNS/TLS is implemented and evidenced; Branch B is recorded only as a phase blocker and releases no deploy/live/closure task | **checkpoint:decision + live** | — | n/a |

**Automatable vs live** — stated plainly so no plan pretends otherwise:
- **Automatable offline:** every invite-callback rule (drive `createOrUpdateUser` directly with synthetic Google- and Entra-shaped subjects — no network), the entire isolation matrix, the postal-address/thin-profile onboarding paths, every `graph.ts` unit including MIME byte-parity and the error taxonomy, the routing seam and its static scans, the migration.
- **Requires a live owner checkpoint (cannot be proven offline):** real Google/Microsoft OAuth against the hosted deployment (uninvited *and* invited), the real Vercel deploy + `envCheck` green, a real Outlook send landing in a real inbox, a real Outlook reply threading in the conversation view, and the unverified-publisher consent screen being acceptable in practice. **Open Question 1 (MIME threading in Outlook) is the one whose failure changes the design** — schedule it as the FIRST live MS check, not the last.

### Sampling Rate
- **Per task commit:** `pnpm --filter @pikar/backend exec vitest run convex/<touched>.test.ts` + `pnpm lint`
- **Per wave merge:** `pnpm test` (full turbo suite) + `pnpm typecheck`; add `pnpm test:e2e` on any wave touching `apps/web`
- **Skill-body waves only:** `pnpm eval:golden` before activating, reading back the live version first
- **Phase gate:** full suite + e2e green, `ops:envCheck` empty on the hosted deployment, and every live checkpoint recorded before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `packages/backend/convex/invites.test.ts` — covers BETA-01 (all six automatable rows)
- [ ] `packages/backend/convex/isolation.test.ts` — covers BETA-02 + BETA-05 (the enumeration, the index-prefix scan, the two-user matrix, the three owner assertions)
- [ ] `packages/backend/convex/graph.test.ts` — covers DLVR-02 send + read plane + token rotation
- [ ] `packages/backend/convex/delivery.test.ts` — covers DLVR-02 routing + the zero-remaining-`internal.gmail.send` static scan
- [ ] `apps/web/e2e/onboarding-first-send.spec.ts` — covers BETA-03 DOM path
- [ ] `apps/web/e2e/admin.spec.ts` — covers BETA-01 issuance DOM + closes Phase 22's `/ops` UAT residue
- [ ] `packages/backend/convex/lib/env.ts` + `ops:envCheck` — the fail-closed secret manifest
- [ ] Extensions (no new file): `onboarding.test.ts`, `cockpit.test.ts` (the no-postal-address first send), `skilloptExport.test.ts` (owner-gated prose), `migrations.test.ts` (provider backfill)
- [ ] **No framework install needed** — vitest, convex-test, edge-runtime and Playwright are all present and configured.

## Sources

### Primary (HIGH confidence)
- `node_modules/@convex-dev/auth@0.0.94/dist/server/types.d.ts:75-250` — `callbacks.createOrUpdateUser` / `beforeSessionCreation` / `afterUserCreatedOrUpdated` contracts
- `…/dist/server/implementation/users.js:1-90` — `upsertUserAndAccount`, `defaultCreateOrUpdateUser`, the `afterUserCreatedOrUpdated`-only-in-default-branch fact
- `…/dist/server/implementation/index.js:195-230` — the `{ id, ...profileFromCallback }` strip, `providerAccountId`, the `catch → Response.redirect` silent bounce
- `…/dist/server/implementation/mutations/userOAuth.js` — the single `auth:store` transaction boundary
- `…/dist/server/implementation/signIn.js` (`handleOAuthProvider`) + `redirects.js` — only `redirectTo` survives the OAuth round-trip
- `…/dist/server/provider_utils.js:78-115` — `defaultProfile` (`id: profile.sub`)
- `node_modules/@auth/core@0.41.2/providers/google.js`, `providers/microsoft-entra-id.js`, `lib/utils/env.js:44-60` — provider shapes, `/common` default issuer, the `AUTH_${ID}_ID`/`_SECRET` convention
- `node_modules/convex@1.42.1/dist/esm-types/server/schema.d.ts:351-360` + `dist/esm/server/schema.js:38` — `SchemaDefinition.tables`, `TableDefinition[" indexes"]()`
- https://learn.microsoft.com/en-us/graph/api/user-sendmail — MIME send, `Content-Type: text/plain`, `202 Accepted`, `Mail.Send` delegated for work **and** personal accounts
- https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference — `sub` pairwise/immutable, `oid` GUID, `email` not guaranteed + "never use it for authorization", `preferred_username`
- https://learn.microsoft.com/en-us/entra/identity-platform/configurable-token-lifetimes — access 60-90 min (24-28 h with CAE), refresh 90-day inactivity / until-revoked, policies retired 2021-01-30
- Repo, read directly: `convex/auth.ts`, `convex/http.ts`, `convex/lib/functions.ts`, `convex/gmail.ts`, `convex/gmailAuth.ts`, `convex/cockpit.ts:805-845`, `convex/onboarding.ts`, `convex/contacts.test.ts`, `convex/schema.ts`, `convex/crons.ts`, `apps/web/middleware.ts`, `docs/playbooks/watch.json`, `docs/playbooks/onboarding.md`, `README.md`

### Secondary (MEDIUM confidence)
- https://learn.microsoft.com/en-us/graph/search-query-parameter + https://learn.microsoft.com/en-us/graph/api/mailfolder-list-messages — `$search` KQL on messages, `$search`/`$filter` mutual exclusion, `ConsistencyLevel` (sources conflict on whether mail requires it)
- Graph `/sendMail` 4 MB MIME ceiling — widely documented; not restated on the `sendMail` reference page itself. **Verify with one oversized live send.**
- Entra refresh-token rotation on redemption — consistent across MS docs; the adapter should persist the returned token unconditionally, which is safe either way

### Tertiary (LOW confidence — flagged for live validation)
- Outlook conversation-view threading from raw-MIME `In-Reply-To`/`References` (Open Question 1)
- Convex custom-domain availability on the account's current plan tier (Open Question 4)
- Entra `sub` character length (~43-44) — the *format class* (opaque, non-GUID, pairwise) is HIGH; the exact length is illustrative only. **Do not assert a length in a test** — assert non-numeric and non-GUID, or better, assert only inequality between two subjects.

## Metadata

**Confidence breakdown:**
- Invite reconciliation (Q1): **HIGH** — read from the pinned package's own source, including the transaction boundary and the `id`-strip
- Microsoft subject format (Q2): **HIGH** — official Entra claims reference; the standing `STATE.md` blocker is resolved on paper and needs only a live confirmation of the *email claim's presence*, not the subject's shape
- Schema enumeration (Q3): **HIGH** — public Convex API located in the installed version; mitigated for the "experimental" label by a non-vacuity assertion
- Graph send (Q4a): **HIGH** — official reference, Example 4
- Graph read plane (Q4b): **MEDIUM** — endpoints and constraints verified; wire shapes need one live call each
- Secret inventory (Q5): **HIGH** for what the code reads; **MEDIUM** on completeness for third-party keys not referenced as `process.env` literals (e.g. the fal API key) — the `envCheck` array should be assembled by grep at plan time, not copied from this table
- Onboarding attach point (Q6): **HIGH** — the path and the `postalAddress` conflict were read directly from source and the playbook
- Provider seam / callers: **HIGH** — grep-verified, and corroborated by 19-05's own recorded correction

**Research date:** 2026-08-09
**Valid until:** 2026-09-08 (30 days). Shorten to 7 days for anything touching `@convex-dev/auth` — it is pre-1.0 and pinned exactly for that reason (CLAUDE.md §6); re-read `dist/server/types.d.ts` before acting on §1 if the pin ever moves.
