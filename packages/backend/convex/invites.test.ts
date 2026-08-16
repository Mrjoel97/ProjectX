// BETA-01: the beta admission trust boundary, proven at the transaction that creates identities.
//
// Every test here is $0 — convex-test only, no model call, no network.
//
// The load-bearing claim of this whole plan is NEGATIVE: an uninvited identity leaves NOTHING
// behind. A test that only checks `users` would pass while orphaned rows piled up in
// `authAccounts` / `authVerificationCodes` / `authSessions`, so `identityRowCounts` reads EVERY
// auth-plane table and the refusal cases compare the whole record before and after.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  admitIdentity,
  formatInviteCode,
  maskEmail,
  normalizeCode,
  normalizeEmail,
} from "./invites";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

/** Every table an admission attempt could write to. The zero-persistence assertion reads all of
 *  them — `users` alone would miss an orphaned account or a live verification code. */
const IDENTITY_TABLES = [
  "users",
  "authAccounts",
  "authSessions",
  "authRefreshTokens",
  "authVerificationCodes",
  "authVerifiers",
  "authRateLimits",
  "betaInvites",
  "betaWaitlist",
] as const;

type Harness = Awaited<ReturnType<typeof harness>>;

async function harness() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) => ctx.db.insert("users", { owner: true }));
  const strangerId = await t.run((ctx) => ctx.db.insert("users", {}));
  return {
    t,
    ownerId,
    strangerId,
    asOwner: t.withIdentity({ subject: `${ownerId}|session_owner` }),
    asStranger: t.withIdentity({ subject: `${strangerId}|session_stranger` }),
  };
}

/** A full census of the identity plane, for byte-unchanged comparison across a refusal. */
async function identityRows(t: Harness["t"]) {
  return await t.run(async (ctx) => {
    const out: Record<string, unknown[]> = {};
    for (const table of IDENTITY_TABLES) {
      out[table] = await ctx.db.query(table).collect();
    }
    return out;
  });
}

/** Mint an approved invite for `email` and return its raw code. */
async function approvedInvite(h: Harness, email: string) {
  const waitlistId = await h.t.mutation(api.invites.requestAccess, { email });
  const invite = await h.asOwner.mutation(api.invites.approve, { waitlistId });
  return invite;
}

const googleProvider = { id: "google", type: "oauth" } as const;
const entraProvider = { id: "microsoft-entra-id", type: "oauth" } as const;
const passwordProvider = { id: "password", type: "credentials" } as const;

/** Drive the admission callback exactly as `auth.ts` does, inside one real transaction. */
function admit(
  t: Harness["t"],
  args: {
    existingUserId?: Id<"users"> | null;
    type?: "oauth" | "credentials" | "email" | "phone" | "verification";
    provider?: { id: string; type: string };
    profile: Record<string, unknown>;
  },
) {
  return t.run((ctx) =>
    // biome-ignore lint/suspicious/noExplicitAny: the callback's ctx is the auth package's
    // AnyDataModel mutation ctx; convex-test hands us the concrete one.
    admitIdentity(ctx as any, {
      existingUserId: args.existingUserId ?? null,
      type: args.type ?? "oauth",
      provider: (args.provider ?? googleProvider) as never,
      profile: args.profile,
    }),
  );
}

describe("email and code normalization", () => {
  test("normalizes email by trim + lowercase so the matching key is stable", () => {
    expect(normalizeEmail("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail("   ")).toBeNull();
    // Not an address; admission must not accept it as one.
    expect(normalizeEmail("jane")).toBeNull();
  });

  test("normalizes a pasted code regardless of case, spacing or dashes", () => {
    const canonical = formatInviteCode("ABCDEFGHJKMNPQRS");
    expect(canonical).toBe("ABCD-EFGH-JKMN-PQRS");
    expect(normalizeCode("abcd-efgh-jkmn-pqrs")).toBe(canonical);
    expect(normalizeCode("ABCDEFGHJKMNPQRS")).toBe(canonical);
    expect(normalizeCode("  abcd efgh jkmn pqrs  ")).toBe(canonical);
    expect(normalizeCode("")).toBeNull();
  });

  test("masks the invited address without revealing the local part", () => {
    expect(maskEmail("jane.doe@example.com")).toBe("j…@example.com");
    // A one-character local part must not round-trip to itself.
    expect(maskEmail("a@example.com")).toBe("…@example.com");
  });
});

describe("waitlist capture and owner-gated issuance", () => {
  test("a public request stores a normalized row and creates no user or tenant", async () => {
    const h = await harness();
    const before = await identityRows(h.t);

    await h.t.mutation(api.invites.requestAccess, {
      email: "  New.Person@Example.COM ",
      name: "New Person",
      referral: "a friend",
    });

    const rows = await h.t.run((ctx) => ctx.db.query("betaWaitlist").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("new.person@example.com");
    expect(rows[0]?.status).toBe("pending");
    // No identity was created by asking.
    const after = await identityRows(h.t);
    expect(after.users).toEqual(before.users);
    expect(after.authAccounts).toEqual(before.authAccounts);
  });

  test("repeating the same address is idempotent and mints nothing", async () => {
    const h = await harness();
    const first = await h.t.mutation(api.invites.requestAccess, { email: "dup@example.com" });
    const second = await h.t.mutation(api.invites.requestAccess, { email: " DUP@example.com " });

    expect(second).toBe(first);
    expect(await h.t.run((ctx) => ctx.db.query("betaWaitlist").collect())).toHaveLength(1);
    expect(await h.t.run((ctx) => ctx.db.query("betaInvites").collect())).toHaveLength(0);
  });

  test("a rejected request never persists an oversized free-text field", async () => {
    const h = await harness();
    await expect(
      h.t.mutation(api.invites.requestAccess, {
        email: "long@example.com",
        referral: "x".repeat(501),
      }),
    ).rejects.toThrow(/REFERRAL_TOO_LONG/);
    expect(await h.t.run((ctx) => ctx.db.query("betaWaitlist").collect())).toHaveLength(0);
  });

  test("only an owner can approve, and a refusal leaves every row byte-unchanged", async () => {
    const h = await harness();
    const waitlistId = await h.t.mutation(api.invites.requestAccess, {
      email: "gated@example.com",
    });
    const before = await identityRows(h.t);

    await expect(h.asStranger.mutation(api.invites.approve, { waitlistId })).rejects.toThrow(
      /OWNER_REQUIRED/,
    );
    // Unauthenticated is refused at the same boundary.
    await expect(h.t.mutation(api.invites.approve, { waitlistId })).rejects.toThrow();

    expect(await identityRows(h.t)).toEqual(before);
  });

  test("owner approval mints one invite and replay returns the same one", async () => {
    const h = await harness();
    const waitlistId = await h.t.mutation(api.invites.requestAccess, { email: "ok@example.com" });

    const first = await h.asOwner.mutation(api.invites.approve, { waitlistId });
    const second = await h.asOwner.mutation(api.invites.approve, { waitlistId });

    expect(second.code).toBe(first.code);
    expect(second.inviteId).toBe(first.inviteId);
    expect(await h.t.run((ctx) => ctx.db.query("betaInvites").collect())).toHaveLength(1);
    expect(first.code).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
    const row = await h.t.run((ctx) => ctx.db.get(waitlistId));
    expect(row?.status).toBe("approved");
  });

  test("two approved addresses never receive the same code", async () => {
    const h = await harness();
    const codes = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const invite = await approvedInvite(h, `person${i}@example.com`);
      codes.add(invite.code);
    }
    expect(codes.size).toBe(25);
  });

  test("owner listing shows pending rows and never leaks a live code", async () => {
    const h = await harness();
    await h.t.mutation(api.invites.requestAccess, { email: "waiting@example.com" });
    const pending = await h.asOwner.query(api.invites.pending, {});

    expect(pending).toHaveLength(1);
    expect(pending[0]?.email).toBe("waiting@example.com");
    expect(JSON.stringify(pending)).not.toMatch(/-[A-Z0-9]{4}-/);
    await expect(h.asStranger.query(api.invites.pending, {})).rejects.toThrow(/OWNER_REQUIRED/);
  });
});

describe("public preflight", () => {
  test("a live code reports valid with a masked address and nothing else", async () => {
    const h = await harness();
    const invite = await approvedInvite(h, "preflight@example.com");

    const result = await h.t.query(api.invites.preflight, { code: invite.code.toLowerCase() });

    expect(result).toEqual({ valid: true, invitedEmailMasked: "p…@example.com" });
    // The whole point: no id, no subject, no raw email, no other invite.
    expect(JSON.stringify(result)).not.toContain("preflight@example.com");
  });

  test("an unknown or already-redeemed code reports invalid without saying which", async () => {
    const h = await harness();
    const invite = await approvedInvite(h, "used@example.com");
    await admit(h.t, { profile: { email: "used@example.com", oauthSubject: "g-1" } });

    expect(await h.t.query(api.invites.preflight, { code: invite.code })).toEqual({
      valid: false,
      invitedEmailMasked: null,
    });
    expect(await h.t.query(api.invites.preflight, { code: "ZZZZ-ZZZZ-ZZZZ-ZZZZ" })).toEqual({
      valid: false,
      invitedEmailMasked: null,
    });
  });
});

describe("admission inside the auth transaction", () => {
  test("an uninvited Google signup throws and persists nothing at all", async () => {
    const h = await harness();
    const before = await identityRows(h.t);

    await expect(
      admit(h.t, { profile: { email: "stranger@example.com", oauthSubject: "g-999" } }),
    ).rejects.toThrow(/INVITE_REQUIRED/);

    expect(await identityRows(h.t)).toEqual(before);
  });

  test("an uninvited Entra signup throws and persists nothing at all", async () => {
    const h = await harness();
    const before = await identityRows(h.t);

    await expect(
      admit(h.t, {
        provider: entraProvider,
        profile: { email: "stranger@contoso.com", oauthSubject: "AAbbCC-opaque" },
      }),
    ).rejects.toThrow(/INVITE_REQUIRED/);

    expect(await identityRows(h.t)).toEqual(before);
  });

  test("a Google-shaped numeric subject redeems its invite exactly once", async () => {
    const h = await harness();
    const invite = await approvedInvite(h, "g@example.com");

    const userId = await admit(h.t, {
      profile: { email: "g@example.com", oauthSubject: "104829301827364550192", name: "G" },
    });

    const row = await h.t.run((ctx) => ctx.db.get(invite.inviteId));
    expect(row?.redeemedUserId).toBe(userId);
    expect(row?.redeemedSubject).toBe("google|104829301827364550192");
    expect(typeof row?.redeemedAt).toBe("number");
    // The helper field must never reach the users row.
    const user = await h.t.run((ctx) => ctx.db.get(userId));
    expect(user).not.toHaveProperty("oauthSubject");
    expect(user?.email).toBe("g@example.com");
  });

  test("an Entra-shaped opaque non-GUID subject redeems too, and is provider-qualified", async () => {
    const h = await harness();
    const invite = await approvedInvite(h, "e@contoso.com");

    await admit(h.t, {
      provider: entraProvider,
      profile: { email: "e@contoso.com", oauthSubject: "AAAAAAAAAAAAAAAAAAAAAA" },
    });

    const row = await h.t.run((ctx) => ctx.db.get(invite.inviteId));
    expect(row?.redeemedSubject).toBe("microsoft-entra-id|AAAAAAAAAAAAAAAAAAAAAA");
  });

  test("Entra falls back to preferred_username when no email claim is present", async () => {
    const h = await harness();
    await approvedInvite(h, "upn@contoso.com");

    const userId = await admit(h.t, {
      provider: entraProvider,
      profile: { preferred_username: "UPN@contoso.com", oauthSubject: "sub-upn" },
    });

    expect((await h.t.run((ctx) => ctx.db.get(userId)))?.email).toBe("upn@contoso.com");
  });

  test("a profile with no usable email is refused before anything is written", async () => {
    const h = await harness();
    const before = await identityRows(h.t);

    await expect(
      admit(h.t, { provider: entraProvider, profile: { oauthSubject: "no-mail" } }),
    ).rejects.toThrow(/INVITE_NO_EMAIL/);

    expect(await identityRows(h.t)).toEqual(before);
  });

  test("a second, different subject cannot redeem a spent invite", async () => {
    const h = await harness();
    const invite = await approvedInvite(h, "once@example.com");
    await admit(h.t, { profile: { email: "once@example.com", oauthSubject: "first-sub" } });
    const spent = await h.t.run((ctx) => ctx.db.get(invite.inviteId));

    await expect(
      admit(h.t, { profile: { email: "once@example.com", oauthSubject: "second-sub" } }),
    ).rejects.toThrow(/INVITE_REQUIRED/);

    // Byte-unchanged: the first redemption's three fields are immutable.
    expect(await h.t.run((ctx) => ctx.db.get(invite.inviteId))).toEqual(spent);
  });

  test("cross-provider reuse of one invite fails closed rather than linking accounts", async () => {
    const h = await harness();
    await approvedInvite(h, "both@example.com");
    await admit(h.t, { profile: { email: "both@example.com", oauthSubject: "same-sub" } });

    // Same address, same raw sub, different provider: still a different identity, still refused.
    await expect(
      admit(h.t, {
        provider: entraProvider,
        profile: { email: "both@example.com", oauthSubject: "same-sub" },
      }),
    ).rejects.toThrow(/INVITE_REQUIRED/);
  });

  test("a mismatched email cannot redeem someone else's invite", async () => {
    const h = await harness();
    const invite = await approvedInvite(h, "owner@example.com");

    await expect(
      admit(h.t, { profile: { email: "attacker@example.com", oauthSubject: "atk" } }),
    ).rejects.toThrow(/INVITE_REQUIRED/);

    expect((await h.t.run((ctx) => ctx.db.get(invite.inviteId)))?.redeemedAt).toBeUndefined();
  });

  test("a returning identity signs in without consuming another invite", async () => {
    const h = await harness();
    const invite = await approvedInvite(h, "return@example.com");
    const userId = await admit(h.t, {
      profile: { email: "return@example.com", oauthSubject: "ret-1", name: "First" },
    });
    // A second invite exists and must NOT be touched by a returning sign-in.
    const spare = await approvedInvite(h, "spare@example.com");

    const again = await admit(h.t, {
      existingUserId: userId,
      profile: { email: "return@example.com", oauthSubject: "ret-1", name: "Renamed" },
    });

    expect(again).toBe(userId);
    expect((await h.t.run((ctx) => ctx.db.get(userId)))?.name).toBe("Renamed");
    expect((await h.t.run((ctx) => ctx.db.get(spare.inviteId)))?.redeemedAt).toBeUndefined();
    // And the original redemption is still the original.
    expect((await h.t.run((ctx) => ctx.db.get(invite.inviteId)))?.redeemedSubject).toBe(
      "google|ret-1",
    );
  });

  test("a returning identity keeps its owner bit — admission never rewrites authority", async () => {
    const h = await harness();
    await admit(h.t, {
      existingUserId: h.ownerId,
      profile: { email: "owner@example.com", oauthSubject: "owner-sub" },
    });
    expect((await h.t.run((ctx) => ctx.db.get(h.ownerId)))?.owner).toBe(true);
  });

  test("OAuth admission marks the address verified, as the default callback did", async () => {
    const h = await harness();
    await approvedInvite(h, "verified@example.com");
    const userId = await admit(h.t, {
      profile: { email: "verified@example.com", oauthSubject: "ver-1" },
    });
    expect(typeof (await h.t.run((ctx) => ctx.db.get(userId)))?.emailVerificationTime).toBe(
      "number",
    );
  });
});

describe("password admission is asymmetric — the code is required", () => {
  test("a matching email alone is not enough without the code", async () => {
    const h = await harness();
    const invite = await approvedInvite(h, "pw@example.com");
    const before = await identityRows(h.t);

    await expect(
      admit(h.t, {
        type: "credentials",
        provider: passwordProvider,
        profile: { email: "pw@example.com" },
      }),
    ).rejects.toThrow(/INVITE_CODE_REQUIRED/);

    await expect(
      admit(h.t, {
        type: "credentials",
        provider: passwordProvider,
        profile: { email: "pw@example.com", inviteCode: "ZZZZ-ZZZZ-ZZZZ-ZZZZ" },
      }),
    ).rejects.toThrow(/INVITE_CODE_REQUIRED/);

    expect(await identityRows(h.t)).toEqual(before);
    expect((await h.t.run((ctx) => ctx.db.get(invite.inviteId)))?.redeemedAt).toBeUndefined();
  });

  test("the correct code admits, binds the password subject, and is stripped from the row", async () => {
    const h = await harness();
    const invite = await approvedInvite(h, "pw2@example.com");

    const userId = await admit(h.t, {
      type: "credentials",
      provider: passwordProvider,
      // Deliberately lowercase and undashed: a human retypes it from an email.
      profile: {
        email: "pw2@example.com",
        inviteCode: invite.code.toLowerCase().replace(/-/g, ""),
      },
    });

    const user = await h.t.run((ctx) => ctx.db.get(userId));
    expect(user).not.toHaveProperty("inviteCode");
    // Self-asserted email, so password admission binds the address, not an OAuth subject.
    expect((await h.t.run((ctx) => ctx.db.get(invite.inviteId)))?.redeemedSubject).toBe(
      "password|pw2@example.com",
    );
    // Password email is self-asserted: it must NOT be marked verified.
    expect(user?.emailVerificationTime).toBeUndefined();
  });

  test("a code belonging to a different address does not admit", async () => {
    const h = await harness();
    const other = await approvedInvite(h, "other@example.com");
    await approvedInvite(h, "mine@example.com");

    await expect(
      admit(h.t, {
        type: "credentials",
        provider: passwordProvider,
        profile: { email: "mine@example.com", inviteCode: other.code },
      }),
    ).rejects.toThrow(/INVITE_CODE_REQUIRED/);
  });
});
