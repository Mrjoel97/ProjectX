/**
 * ONE seeder for `providerGates` rows, shared by every suite that has to get past the connect-start
 * or callback gates.
 *
 * It exists because three test files need the same rows and the last time this repo let a fixture
 * be copied, a repair reached two of three copies and the third kept the defect (28.1-11 #10).
 *
 * WHAT "PASSED" ACTUALLY REQUIRES, and why a hand-rolled row usually is not one:
 * `resolveProviderEligibility` needs `lane === "passed"` AND an unexpired `reviewBy` AND an
 * admission that permits the environment AND `readPathCount > 0` AND every entry in
 * `PROVIDER_OPEN_CONDITIONS[provider]` present in `clearedConditions`. A row that sets `lane:
 * "passed"` and stops resolves to NOT passed, silently — which reads in a test as "the gate
 * refused" and sends you looking in the wrong place. `passedGate` clears the conditions from the
 * same source the resolver reads, so it cannot drift from them.
 */
import { PROVIDER_OPEN_CONDITIONS, PROVIDERS, type Provider } from "@pikar/revenue";

type Env = "sandbox" | "production";

/** Far enough out that a suite cannot expire mid-run; near enough to be a real date. */
const REVIEW_BY_MS = 365 * 86_400_000;

/** One fully-passed row. `now` is injected so a fake-timer suite gets a consistent expiry. */
export const passedGate = (provider: Provider, environment: Env, now = Date.now()) => ({
  provider,
  environment,
  admission: "approved_production" as const,
  lane: "passed" as const,
  evidenceRef: `docs/connectors/${provider}-suitability.md#test-fixture`,
  reviewBy: now + REVIEW_BY_MS,
  // FROM THE SOURCE OF TRUTH, never a typed literal: a renamed condition id must break the seeder
  // rather than leave a row that quietly resolves to `pending`.
  clearedConditions: PROVIDER_OPEN_CONDITIONS[provider].map((c) => c.id),
  revision: 1,
  updatedAt: now,
});

/**
 * Every provider passed in both environments — the "this suite is not about the gate" seed.
 *
 * PURE DATA, not a seeding function: handing back rows lets each suite insert them with its own
 * `ctx`, instead of this file re-declaring a Convex context shape that would drift from the real
 * one. Use it in suites that predate the gate and test something else; a suite that IS about the
 * gate should build its rows inline so the axis under test is visible in the test body.
 */
export const allPassedGates = (now = Date.now()) =>
  PROVIDERS.flatMap((provider) =>
    (["sandbox", "production"] as const).map((environment) =>
      passedGate(provider, environment, now),
    ),
  );
