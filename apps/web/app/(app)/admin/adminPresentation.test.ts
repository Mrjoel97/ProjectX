// BETA-01 presentation contract for `/admin`, rendered in the repository's DOM-free React runner.
//
// THIS IS THE PROOF THE PLAN WANTED FROM PLAYWRIGHT, AND IT IS A DIFFERENT PROOF. 25-02 asked for
// an authenticated two-identity spec, but `playwright.config.ts` declares ONE project with ONE
// `storageState`, `auth.setup.ts` signs in ONE seeded user, and `owner` is grantable only by hand
// through `owner.bootstrapOwner` — so there is no second identity to run as. Rewriting that harness
// is 23-06's owned work and the file-collision map forbids it landing mid-Phase-25.
//
// A browser spec would also have proved the WRONG thing. The `(app)` shell carries the ONBD-01
// first-run gate client-side, so a freshly seeded non-owner is redirected to
// `/dashboard/onboarding` before `/admin` ever mounts: the "no admin controls" assertion would
// pass because of the onboarding redirect, not because of the owner gate. That is precisely the
// vacuous-coverage shape this repo keeps logging.
//
// So this renders the REAL AdminPage and replaces only Convex's hook transport. Recording every
// hook reference proves the mount property that matters: a non-owner does not merely receive
// hidden markup — React never executes AdminView, so `invites.pending` never subscribes.
// Component evidence, not a browser/DOM claim, and it says so.
import { getFunctionName } from "convex/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import AdminPage from "./page";

const hooks = vi.hoisted(() => {
  const state = {
    queryCalls: [] as unknown[],
    mutationCalls: [] as unknown[],
    resolveQuery: (_reference: unknown): unknown => undefined,
  };
  return {
    state,
    useQuery: vi.fn((reference: unknown) => {
      state.queryCalls.push(reference);
      return state.resolveQuery(reference);
    }),
    useMutation: vi.fn((reference: unknown) => {
      state.mutationCalls.push(reference);
      return async () => undefined;
    }),
  };
});

vi.mock("convex/react", () => ({
  useQuery: hooks.useQuery,
  useMutation: hooks.useMutation,
}));

const PENDING = [
  {
    waitlistId: "w1",
    email: "hopeful@example.com",
    name: "A Hopeful Person",
    referral: "a friend told me",
    requestedAt: 1,
  },
];

function render(viewer: unknown, pending: unknown) {
  hooks.state.queryCalls = [];
  hooks.state.mutationCalls = [];
  hooks.state.resolveQuery = (reference) => {
    const name = getFunctionName(reference as never);
    if (name.startsWith("owner:viewer")) return viewer;
    if (name.startsWith("invites:pending")) return pending;
    return undefined;
  };
  return renderToStaticMarkup(createElement(AdminPage));
}

/** Which Convex functions this render actually subscribed to. */
function subscribed() {
  return hooks.state.queryCalls.map((r) => getFunctionName(r as never));
}

describe("the admin surface mounts only for a confirmed owner", () => {
  beforeEach(() => {
    hooks.useQuery.mockClear();
    hooks.useMutation.mockClear();
  });

  test("an OWNER sees the waitlist and its controls", () => {
    const html = render({ isOwner: true }, PENDING);

    expect(html).toContain("Beta waitlist");
    expect(html).toContain("hopeful@example.com");
    expect(html).toContain("Approve &amp; mint invite");
    expect(subscribed().some((n) => n.startsWith("invites:pending"))).toBe(true);
  });

  test("a NON-OWNER never executes AdminView, so invites.pending never subscribes", () => {
    const html = render({ isOwner: false }, PENDING);

    // Not merely hidden — absent.
    expect(html).not.toContain("Beta waitlist");
    expect(html).not.toContain("hopeful@example.com");
    expect(html).not.toContain("Approve");
    // The mount property. This is the assertion a CSS-hiding implementation would fail.
    expect(subscribed().some((n) => n.startsWith("invites:pending"))).toBe(false);
    expect(hooks.state.mutationCalls).toHaveLength(0);
  });

  test("the LOADING viewer is treated as a non-owner — no flash of the surface", () => {
    // `undefined` is what a slow query returns. Fail closed.
    const html = render(undefined, PENDING);

    expect(html).not.toContain("Beta waitlist");
    expect(subscribed().some((n) => n.startsWith("invites:pending"))).toBe(false);
  });

  test("the refusal copy does not confirm that an admin surface exists", () => {
    const nonOwner = render({ isOwner: false }, PENDING);
    const loading = render(undefined, PENDING);

    // Identical for "not the owner" and "still loading": a distinct message would tell a prober
    // which of the two they are.
    expect(nonOwner).toBe(loading);
    expect(nonOwner).toContain("isn&#x27;t available on your account");
    expect(nonOwner).not.toMatch(/owner/i);
  });

  test("an orphan viewer row is a non-owner, not a crash", () => {
    expect(() => render(null, PENDING)).not.toThrow();
    expect(render(null, PENDING)).not.toContain("Beta waitlist");
  });

  test("the owner view never renders a live code it was not given", () => {
    const html = render({ isOwner: true }, PENDING);
    // Codes come only from `approve`'s return value, held in memory. Nothing code-shaped may
    // appear from `pending`, which deliberately does not return one.
    expect(html).not.toMatch(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
  });

  test("an empty queue says so rather than rendering nothing", () => {
    const html = render({ isOwner: true }, []);
    expect(html).toContain("No one is waiting");
  });
});
