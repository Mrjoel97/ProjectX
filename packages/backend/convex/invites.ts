// BETA-01: the beta admission trust boundary.
//
// Two halves that must not be confused with each other:
//
//   1. ISSUANCE (this file's Convex functions) — a public waitlist request, a public preflight
//      that says only "this code is live, for an address that looks like this", and owner-gated
//      approval. Preflight is a COURTESY, not a gate: it exists so the signup page can refuse
//      early instead of bouncing a user through an OAuth round trip. It authorizes nothing.
//
//   2. ADMISSION (`admitIdentity`, called from `auth.ts`) — the actual boundary. It runs INSIDE
//      the `auth:store` mutation, before any account, session or verification code is written,
//      and throwing rolls the whole transaction back. This is the only thing standing between a
//      stranger and a tenant.
//
// WHY THIS MODULE IS ON THE RAW-BUILDER ALLOWLIST (CLAUDE.md §2): the waitlist and preflight are
// reachable by an UNAUTHENTICATED visitor, which is what a public beta signup page requires and
// what no tenant wrapper can express — `tenantQuery` throws UNAUTHENTICATED by design. It is the
// first genuinely public entry in that list; see the note there. What keeps it safe is that
// neither public function reads or returns tenant-owned data, and neither returns a code, an id,
// a subject, or an unmasked address.
import type { AnyDataModel, GenericMutationCtx } from "convex/server";
import { v } from "convex/values";
import type { DataModel, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { ownerMutation, ownerQuery } from "./lib/functions";

/** Crockford-style: no I, L, O or U, so a code read off a screen cannot be mistyped into another
 *  live code. 32 symbols × 16 characters = 80 bits. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 16;
const GROUP = 4;

/** Free-text ceilings. These are self-asserted strings from an unauthenticated stranger; bounding
 *  them at the trust boundary is the whole reason they are safe to store. */
const MAX_NAME = 200;
const MAX_REFERRAL = 500;

/**
 * Trim + lowercase, and require something that is at least shaped like an address.
 *
 * The shape check is deliberately weak — `auth.ts` never trusts this value for authorization, it
 * only uses it to FIND a matching invite. Rejecting exotic-but-valid addresses would lock real
 * people out for no security gain, so this only rejects strings that cannot be an address at all.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 320) return null;
  // one @, something on each side, and a dot in the domain
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null;
  return email;
}

/** Canonical display form: ABCD-EFGH-JKMN-PQRS. */
export function formatInviteCode(body: string): string {
  return (body.match(new RegExp(`.{1,${GROUP}}`, "g")) ?? []).join("-");
}

/**
 * Accept whatever a human actually pastes — lowercase, spaces, missing or extra dashes — and
 * reduce it to the canonical stored form. Anything outside the alphabet is dropped rather than
 * rejected, because the common failure is a stray space or a soft-wrapped dash from an email
 * client, not an attack.
 */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const body = [...raw.toUpperCase()].filter((c) => ALPHABET.includes(c)).join("");
  if (body.length !== CODE_LENGTH) return null;
  return formatInviteCode(body);
}

/**
 * Enough for the invited person to recognise their own address, not enough for a stranger holding
 * a guessed code to learn whose it is. The local part is never partially revealed beyond its
 * first character, and a one-character local part reveals nothing.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "…";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return `${local.length > 1 ? local[0] : ""}…${domain}`;
}

/** Web Crypto, already in the Convex runtime — no package, no seeding, no fallback. Rejection
 *  sampling keeps the distribution uniform; a plain `% 32` would be biased for a non-power-of-two
 *  alphabet, and this one is 32 exactly, but the guard costs nothing and survives an alphabet edit. */
function mintCode(): string {
  const out: string[] = [];
  while (out.length < CODE_LENGTH) {
    const bytes = new Uint8Array(CODE_LENGTH);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (out.length === CODE_LENGTH) break;
      const limit = 256 - (256 % ALPHABET.length);
      if (b >= limit) continue;
      out.push(ALPHABET[b % ALPHABET.length] as string);
    }
  }
  return formatInviteCode(out.join(""));
}

// ---------------------------------------------------------------------------
// Issuance
// ---------------------------------------------------------------------------

/**
 * PUBLIC and unauthenticated: anyone may ask for access. Idempotent per normalized address, so a
 * double-submit or a retry cannot fill the table, and asking twice is indistinguishable from
 * asking once — no timing or count signal about who is already on the list.
 */
export const requestAccess = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    referral: v.optional(v.string()),
  },
  returns: v.id("betaWaitlist"),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    if (!email) throw new Error("INVALID_EMAIL");
    const name = args.name?.trim() || undefined;
    const referral = args.referral?.trim() || undefined;
    if (name && name.length > MAX_NAME) throw new Error("NAME_TOO_LONG");
    if (referral && referral.length > MAX_REFERRAL) throw new Error("REFERRAL_TOO_LONG");

    const existing = await ctx.db
      .query("betaWaitlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) return existing._id;

    return await ctx.db.insert("betaWaitlist", {
      email,
      name,
      referral,
      status: "pending",
      requestedAt: Date.now(),
    });
  },
});

/**
 * PUBLIC and unauthenticated. Which sign-in providers this DEPLOYMENT can actually complete.
 *
 * The signup page needs this to avoid shipping a button that dead-ends at the provider.
 * `microsoft-entra-id` is configured in `auth.ts` but is inert without
 * `AUTH_MICROSOFT_ENTRA_ID_ID`/`_SECRET` and an Azure app registration, and those live on the
 * Convex deployment — nothing the browser or the Next build can see.
 *
 * Deliberately reading the Convex env HERE rather than adding a `NEXT_PUBLIC_…` flag: a build-time
 * mirror of a runtime secret is a second source of truth that can disagree with the first, and the
 * disagreement shows up as a broken sign-in button for a real invited user. This answer cannot
 * drift because it is read from the same place the auth package reads.
 *
 * Discloses nothing a rendered button would not: whether a provider exists, never a credential.
 */
export const authProviders = query({
  args: {},
  returns: v.object({ google: v.boolean(), microsoft: v.boolean(), password: v.boolean() }),
  handler: async () => ({
    // @auth/core derives credential names from the provider id, upper-snake-cased.
    google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
    microsoft: Boolean(
      process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
    ),
    // Credentials need no provider secret — it is always available.
    password: true,
  }),
});

/**
 * PUBLIC and unauthenticated. Returns the two bits the signup page needs and nothing more: is
 * this code live, and does it belong to the address you think it does. Never an id, a subject, a
 * user, another invite, or an unmasked address.
 *
 * An unknown code and a spent code are reported IDENTICALLY. Distinguishing them would turn this
 * into an oracle for "was this code ever real".
 */
export const preflight = query({
  args: { code: v.string() },
  returns: v.object({
    valid: v.boolean(),
    invitedEmailMasked: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const code = normalizeCode(args.code);
    const refused = { valid: false, invitedEmailMasked: null };
    if (!code) return refused;
    const invite = await ctx.db
      .query("betaInvites")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!invite || invite.redeemedAt !== undefined) return refused;
    return { valid: true, invitedEmailMasked: maskEmail(invite.email) };
  },
});

/** Owner-only. Pending waitlist rows, oldest first. Deliberately returns no invite code: a live
 *  code is handed back exactly once, by `approve`. */
export const pending = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("betaWaitlist")
      .withIndex("by_status_requested", (q) => q.eq("status", "pending"))
      .order("asc")
      .take(200);
    return rows.map((row) => ({
      waitlistId: row._id,
      email: row.email,
      name: row.name ?? null,
      referral: row.referral ?? null,
      requestedAt: row.requestedAt,
    }));
  },
});

/**
 * Owner-only. Approves a waitlist row and mints ONE invite for its address.
 *
 * REPLAY-SAFE, and that is a requirement rather than a nicety: the owner UI hands out a
 * `/signup?invite=…` link, and an owner who reloads the page, double-clicks, or comes back
 * tomorrow must get the SAME link — a second live code for one address would mean two ways in
 * and no way to tell which was used. Replay returns the existing invite untouched.
 */
export const approve = ownerMutation({
  args: { waitlistId: v.id("betaWaitlist") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.waitlistId);
    if (!row) throw new Error("WAITLIST_ROW_NOT_FOUND");

    const existing = await ctx.db
      .query("betaInvites")
      .withIndex("by_email", (q) => q.eq("email", row.email))
      .unique();
    if (existing) {
      return { inviteId: existing._id, code: existing.code, email: existing.email };
    }

    const code = mintCode();
    const inviteId = await ctx.db.insert("betaInvites", {
      email: row.email,
      code,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.waitlistId, { status: "approved", approvedAt: Date.now() });
    return { inviteId, code, email: row.email };
  },
});

// ---------------------------------------------------------------------------
// Admission — the boundary itself
// ---------------------------------------------------------------------------

/** Fields the auth callback is allowed to write onto a `users` row. Anything a provider profile
 *  carries beyond these — `oauthSubject`, `inviteCode` — is a transport helper and must never
 *  land in the table. `owner` is absent on purpose: authority is granted only by
 *  `owner.bootstrapOwner`, never by signing in. */
function userFields(profile: Record<string, unknown>) {
  const fields: {
    email?: string;
    name?: string;
    image?: string;
  } = {};
  const email = normalizeEmail(profile.email ?? profile.preferred_username);
  if (email) fields.email = email;
  if (typeof profile.name === "string" && profile.name.trim()) fields.name = profile.name.trim();
  if (typeof profile.image === "string" && profile.image.trim())
    fields.image = profile.image.trim();
  return fields;
}

type AdmitArgs = {
  existingUserId: Id<"users"> | null;
  type: "oauth" | "credentials" | "email" | "phone" | "verification";
  provider: { id: string; type: string };
  profile: Record<string, unknown>;
};

/**
 * THE admission transaction. Called from `callbacks.createOrUpdateUser` in `auth.ts`, which
 * @convex-dev/auth@0.0.94 invokes inside the single `auth:store` mutation BEFORE
 * `createOrUpdateAccount` — so throwing here leaves no user, no account, no verification code and
 * no session. That ordering is the entire security property; if the auth package is ever bumped,
 * re-read `dist/server/implementation/users.js` and re-run `invites.test.ts` before trusting it.
 *
 * Email is the FIRST-REDEMPTION MATCHING KEY ONLY. The persisted authorization root is
 * `${provider.id}|${oauthSubject}` — provider-qualified, because the same raw `sub` from two
 * different issuers is two different people.
 *
 * CROSS-PROVIDER LINKING IS DELIBERATELY UNSUPPORTED for the beta and fails closed: an invite is
 * spent by the first provider that redeems it, so "sign in with Google then again with Microsoft"
 * is refused rather than silently merged into one account. Mailbox connection is a separate
 * consent and is unaffected — a user can still connect both Gmail and Outlook.
 */
export async function admitIdentity(
  ctx: GenericMutationCtx<AnyDataModel>,
  args: AdmitArgs,
): Promise<Id<"users">> {
  const db = ctx.db as unknown as GenericMutationCtx<DataModel>["db"];

  // A returning identity on a provider that already has an account. The invite was spent at
  // signup; re-checking it here would lock every existing user out the moment their invite row
  // was consumed. Update the allowed profile fields and nothing else — notably NOT `owner`.
  if (args.existingUserId) {
    const userId = args.existingUserId as Id<"users">;
    await db.patch(userId, userFields(args.profile));
    return userId;
  }

  const email = normalizeEmail(args.profile.email ?? args.profile.preferred_username);
  if (!email) throw new Error("INVITE_NO_EMAIL");

  const invite = await db
    .query("betaInvites")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  // One refusal for "no invite", "wrong address" and "already used". The signup page maps it to
  // one generic message, so a stranger cannot use the error to learn whether an address is on
  // the list.
  if (!invite || invite.redeemedAt !== undefined) throw new Error("INVITE_REQUIRED");

  // Password email is SELF-ASSERTED — anyone can type an invited address — so credentials
  // admission additionally requires the code itself. OAuth cannot carry the typed code through
  // Convex Auth, but its email is provider-VERIFIED, which is the stronger fact.
  const isCredentials = args.provider.type === "credentials";
  if (isCredentials && normalizeCode(args.profile.inviteCode) !== invite.code) {
    throw new Error("INVITE_CODE_REQUIRED");
  }

  const subject = isCredentials
    ? `${args.provider.id}|${email}`
    : `${args.provider.id}|${String(args.profile.oauthSubject ?? "")}`;
  if (!isCredentials && !args.profile.oauthSubject) throw new Error("INVITE_NO_SUBJECT");

  const userId = await db.insert("users", {
    ...userFields(args.profile),
    // Reproduces the default callback's behaviour deliberately: an OAuth provider has verified
    // the address, a self-asserted password signup has not. Email verification for the password
    // provider is the separate fast-follow noted in auth.ts.
    ...(isCredentials ? null : { emailVerificationTime: Date.now() }),
  });

  // The three redemption fields are written together and never again. `by_email` found an
  // unredeemed row above; this patch is what makes the invite single-use.
  await db.patch(invite._id, {
    redeemedAt: Date.now(),
    redeemedSubject: subject,
    redeemedUserId: userId,
  });

  return userId;
}
