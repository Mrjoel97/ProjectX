import { readFileSync } from "node:fs";
import { api } from "@pikar/backend/api";
import { VERTICAL_IDS, type VerticalId } from "@pikar/core/verticalPacks";
import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { z } from "zod";

// FREE CONTROL HARNESS, NOT WORKFLOW UAT. No model action, preview, publication or evidence writer.
// List without auth/network: playwright test e2e/vertical-packs.spec.ts --project=chromium --list
const enabled = process.env.PIKAR_VERTICAL_CONTROLS_E2E === "1";
test.use({ trace: "off", screenshot: "off", video: "off" });
const fixtureSchema = z
  .object({
    dedicatedDisposableTenant: z.literal(true),
    appOrigin: z.url(),
    convexUrl: z.url(),
    tenantId: z.string().min(1),
    candidates: z
      .array(
        z
          .object({
            id: z.enum(VERTICAL_IDS),
            candidateId: z.string().min(1),
            candidateVersion: z.number().int().positive(),
            sources: z.tuple([
              z.object({ docId: z.string().min(1), title: z.string().min(1).max(200) }).strict(),
              z.object({ docId: z.string().min(1), title: z.string().min(1).max(200) }).strict(),
            ]),
          })
          .strict(),
      )
      .length(6),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.candidates.map((candidate) => candidate.id)).size !== 6)
      ctx.addIssue({
        code: "custom",
        message: "Exactly one pin for each of the six verticals is required.",
      });
    for (const candidate of value.candidates) {
      if (new Set(candidate.sources.map((source) => source.docId)).size !== 2)
        ctx.addIssue({
          code: "custom",
          message: "Two distinct source ids are required for every vertical.",
        });
    }
  });
function loadFixture() {
  const path = process.env.PIKAR_VERTICAL_CONTROLS_FIXTURE;
  if (!path)
    throw new Error(
      "PIKAR_VERTICAL_CONTROLS_FIXTURE must name the dedicated tenant's exact fixture JSON.",
    );
  // Never print validator input: fixture files contain tenant/document references.
  const parsed = fixtureSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success)
    throw new Error("Vertical control fixture is invalid; check the closed schema in the spec.");
  return parsed.data;
}
const fixture = enabled ? loadFixture() : null;
type Candidate = z.infer<typeof fixtureSchema>["candidates"][number];
type Profile = NonNullable<FunctionReturnType<typeof api.tenantProfile.get>>;
type Discovery = FunctionReturnType<typeof api.verticalPacks.discover>;
type SourcePage = FunctionReturnType<typeof api.verticalPacks.workloadSources>;
const titles: Record<VerticalId, string> = {
  legal: "Review contract issues",
  hr: "Prepare onboarding materials",
  product: "Develop a product brief",
  design: "Review a design artifact",
  engineering: "Review a technical runbook",
  data: "Understand a dataset",
};
const viewports = [
  { name: "desktop", width: 1280, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];
const panel = (page: Page) =>
  page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Show work you do repeatedly" }) });
const recommendations = (page: Page) =>
  page.getByRole("region", { name: "Workflows for your work" });
const card = (page: Page, id: VerticalId) =>
  recommendations(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: titles[id], exact: true }) });

async function open(page: Page, id: VerticalId, baseURL: string | undefined) {
  if (!fixture) throw new Error("Explicit vertical control opt-in required.");
  if (!baseURL || new URL(baseURL).origin !== new URL(fixture.appOrigin).origin)
    throw new Error("Browser origin differs from the exact fixture target.");
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(new URL(socket.url()).host));
  await page.goto("/dashboard/profile?tab=shape");
  await expect(panel(page).locator("summary")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[aria-label="Workflow preferences"]')).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect.poll(() => sockets.includes(new URL(fixture.convexUrl).host)).toBe(true);
  const state = await page.context().storageState();
  const tokens = state.origins
    .filter((origin) => origin.origin === new URL(fixture.appOrigin).origin)
    .flatMap((origin) => origin.localStorage)
    .filter((entry) => entry.name.startsWith("__convexAuthJWT"));
  if (tokens.length !== 1 || !tokens[0])
    throw new Error("One unambiguous authenticated browser JWT is required.");
  const encoded = tokens[0].value.split(".")[1];
  if (!encoded) throw new Error("Browser identity is invalid.");
  const claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (
    typeof claims.sub !== "string" ||
    claims.sub.split("|")[0] !== fixture.tenantId ||
    !Number.isFinite(claims.exp) ||
    claims.exp * 1000 <= Date.now()
  )
    throw new Error("Browser tenant or session expiry differs from the configured fixture.");
  const client = new ConvexHttpClient(fixture.convexUrl);
  client.setAuth(tokens[0].value);
  const [profile, discovery] = await Promise.all([
    client.query(api.tenantProfile.get, {}),
    client.query(api.verticalPacks.discover, {}),
  ]);
  if (!profile || profile.tenantId !== fixture.tenantId)
    throw new Error("Confirmed dedicated tenant profile required.");
  const candidate = fixture.candidates.find((value) => value.id === id);
  const control = discovery.controls.find((value) => value.id === id);
  if (
    !candidate ||
    !control ||
    candidate.candidateId !== control.candidateId ||
    candidate.candidateVersion !== control.candidateVersion
  )
    throw new Error(
      "Exact candidate row/version precondition changed; no registry mutation is permitted.",
    );
  await panel(page).locator("summary").click();
  await expect(panel(page).getByLabel("Work you want help with")).toBeVisible();
  return { client, profile, discovery, candidate, control };
}

async function sourcePages(client: ConvexHttpClient, candidate: Candidate): Promise<SourcePage[]> {
  const pages: SourcePage[] = [];
  let cursor: string | undefined;
  const found = new Set<string>();
  for (let index = 0; index < 40; index++) {
    const result = await client.query(api.verticalPacks.workloadSources, cursor ? { cursor } : {});
    pages.push(result);
    for (const source of candidate.sources) {
      const match = result.docs.find((doc) => doc.docId === source.docId);
      if (match) {
        if (
          match.title !== source.title ||
          result.docs.filter((doc) => doc.title === source.title).length !== 1
        )
          throw new Error("Fixture title changed or is ambiguous on its source page.");
        found.add(source.docId);
      }
    }
    if (found.size === 2) return pages;
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  throw new Error("Exact ready, unsealed fixture sources were not found within 40 bounded pages.");
}

async function pickSources(form: Locator, pages: SourcePage[], candidate: Candidate) {
  await form.getByLabel("Work you want help with").selectOption(candidate.id);
  for (const [index, current] of pages.entries()) {
    if (current.docs[0])
      await expect(
        form.getByRole("checkbox", { name: current.docs[0].title, exact: true }),
      ).toBeVisible();
    else
      await expect(
        form.getByText("No available documents on this page.", { exact: true }),
      ).toBeVisible();
    for (const source of candidate.sources) {
      if (current.docs.some((doc) => doc.docId === source.docId))
        await form.getByRole("checkbox", { name: source.title, exact: true }).check();
    }
    if (index + 1 < pages.length)
      await form.getByRole("button", { name: "More documents", exact: true }).click();
  }
  await expect(form.getByText("2 of 2 examples selected", { exact: true })).toBeVisible();
}

async function restorePreferences(
  client: ConvexHttpClient,
  before: Profile,
  id: VerticalId,
  info: TestInfo,
) {
  const preferences = before.verticalPreferences;
  const prior = preferences?.confirmedWorkloads?.find((value) => value.verticalId === id);
  const originalChoices = {
    needs: preferences?.needs ?? [],
    reviewReady: preferences?.reviewReady ?? [],
    ...(preferences?.legalPlaybookDocId
      ? { legalPlaybookDocId: preferences.legalPlaybookDocId }
      : {}),
  };
  let refsRestored = true;
  try {
    if (prior) {
      try {
        await client.mutation(api.verticalPacks.configure, {
          ...originalChoices,
          needs: [...new Set([...originalChoices.needs, id])],
          confirmWorkload: { verticalId: id, artifactIds: prior.artifactIds },
        });
      } catch {
        refsRestored = false;
      }
    }
    // Still restore reversible choices when a historical source was deleted/sealed meanwhile.
    await client.mutation(api.verticalPacks.configure, originalChoices);
    const restored = await client.query(api.tenantProfile.get, {});
    expect(restored?.verticalPreferences?.needs).toEqual(preferences?.needs ?? []);
    expect(restored?.verticalPreferences?.reviewReady).toEqual(preferences?.reviewReady ?? []);
    expect(restored?.verticalPreferences?.legalPlaybookDocId).toBe(preferences?.legalPlaybookDocId);
    if (!refsRestored) throw new Error("Historical refs could not be restored.");
    info.annotations.push({
      type: "retained-history",
      description: `${id}: historical confirmation/server timestamp cannot be undone through the product API; dedicated tenant required.`,
    });
  } catch {
    info.annotations.push({
      type: "cleanup-failed",
      description: `${id}: preferences may remain modified; inspect the dedicated tenant before rerunning.`,
    });
    throw new Error("Preference restoration failed; dedicated tenant state may remain modified.");
  }
}

async function restoreDisabled(
  client: ConvexHttpClient,
  before: Profile,
  id: VerticalId,
  info: TestInfo,
) {
  try {
    const disabled = before.disabledVerticals?.includes(id) ?? false;
    await client.mutation(api.verticalPacks.setDisabled, { verticalId: id, disabled });
    expect(
      (await client.query(api.verticalPacks.discover, {})).controls.find((value) => value.id === id)
        ?.disabled,
    ).toBe(disabled);
  } catch {
    info.annotations.push({
      type: "cleanup-failed",
      description: `${id}: disabled preference may remain changed.`,
    });
    throw new Error("Disable preference restoration failed; inspect dedicated tenant state.");
  }
}

async function assertLayout(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}
async function assertStartGates(page: Page, discovery: Discovery) {
  await expect(page.locator('[aria-label="Workflow preferences"]')).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(discovery.recommendations.length).toBeLessThanOrEqual(2);
  // Give the subscription a positive settle signal when cards exist. No sleeping/reload loops.
  for (const recommendation of discovery.recommendations) {
    if (recommendation.state === "hidden") continue;
    await expect(card(page, recommendation.id)).toBeVisible();
    const start = card(page, recommendation.id).getByRole("button", {
      name: "Start workflow",
      exact: true,
    });
    if (recommendation.state === "available") await expect(start).toBeEnabled();
    else await expect(start).toHaveCount(0);
  }
  await expect(recommendations(page).getByRole("heading", { level: 3 })).toHaveCount(
    discovery.recommendations.filter((value) => value.state !== "hidden").length,
  );
  // Deliberately never click Start: a future released candidate could incur real provider spend.
}

test.describe("@vertical-controls opt-in authenticated control harness (no workflow UAT)", () => {
  test.describe.configure({ mode: "serial", retries: 0 });
  test.skip(
    !enabled,
    "Set PIKAR_VERTICAL_CONTROLS_E2E=1 and an exact dedicated-tenant fixture; no release evidence is earned by a skip.",
  );
  test.setTimeout(90_000);
  for (const viewport of viewports)
    for (const id of VERTICAL_IDS) {
      test(`${viewport.name} ${id}: confirm real examples, preserve approvals and verify start gates`, async ({
        page,
        baseURL,
      }, info) => {
        await page.setViewportSize(viewport);
        const { client, profile, candidate } = await open(page, id, baseURL);
        const pages = await sourcePages(client, candidate);
        const form = panel(page);
        await pickSources(form, pages, candidate);
        const consent = form.getByRole("checkbox", {
          name: "This work repeats in my business, and these two documents are relevant examples.",
          exact: true,
        });
        const save = form.getByRole("button", { name: "Save examples", exact: true });
        await expect(save).toBeDisabled();
        await consent.check();
        await expect(save).toBeEnabled();
        let submitted = false;
        try {
          submitted = true;
          await save.click();
          await expect(
            form.getByRole("status").filter({ hasText: "Examples saved." }),
          ).toBeVisible();
          await expect(consent).not.toBeChecked();
          const updated = await client.query(api.tenantProfile.get, {});
          expect(
            updated?.verticalPreferences?.confirmedWorkloads
              ?.find((value) => value.verticalId === id)
              ?.artifactIds.slice()
              .sort(),
          ).toEqual(candidate.sources.map((source) => source.docId).sort());
          expect(updated?.verticalPreferences?.reviewReady).toEqual(
            profile.verticalPreferences?.reviewReady ?? [],
          );
          expect(updated?.verticalPreferences?.legalPlaybookDocId).toBe(
            profile.verticalPreferences?.legalPlaybookDocId,
          );
          await expect(form.getByText(/Past examples recorded on/)).toBeVisible();
          await assertStartGates(page, await client.query(api.verticalPacks.discover, {}));
          await assertLayout(page);
        } finally {
          if (submitted) await restorePreferences(client, profile, id, info);
        }
      });

      test(`${viewport.name} ${id}: independently disable and restore an actually eligible suggestion`, async ({
        page,
        baseURL,
      }, info) => {
        await page.setViewportSize(viewport);
        const { client, profile, candidate, control, discovery } = await open(page, id, baseURL);
        test.skip(
          control.prerequisite === "native_evidence",
          `${id}@${candidate.candidateVersion}: native release evidence absent; disable/start UAT not exercised.`,
        );
        expect(
          control.activeVersion,
          "A different active version cannot qualify this exact candidate.",
        ).toBe(candidate.candidateVersion);
        const recommendation = discovery.recommendations.find((value) => value.id === id);
        test.skip(
          !recommendation || recommendation.state === "hidden",
          `${id}: not selected by genuine tenant eligibility; no exposure is manufactured.`,
        );
        expect(control.disabled, "Start from a fixture whose suggestion is enabled.").toBe(false);
        let changed = false;
        try {
          changed = true;
          await card(page, id)
            .getByRole("button", { name: "Turn off this suggestion", exact: true })
            .click();
          await expect
            .poll(
              async () =>
                (await client.query(api.verticalPacks.discover, {})).controls.find(
                  (value) => value.id === id,
                )?.disabled,
            )
            .toBe(true);
          await expect(
            card(page, id).getByRole("button", { name: "Start workflow", exact: true }),
          ).toHaveCount(0);
          const off = page
            .locator("details")
            .filter({ has: page.locator("summary", { hasText: "Suggestions you turned off" }) });
          await off.locator("summary").click();
          await off
            .getByRole("listitem")
            .filter({ hasText: titles[id] })
            .getByRole("button", { name: "Restore suggestion", exact: true })
            .click();
          await expect
            .poll(
              async () =>
                (await client.query(api.verticalPacks.discover, {})).controls.find(
                  (value) => value.id === id,
                )?.disabled,
            )
            .toBe(false);
          await assertStartGates(page, await client.query(api.verticalPacks.discover, {}));
          await assertLayout(page);
        } finally {
          if (changed) await restoreDisabled(client, profile, id, info);
        }
      });
    }
});
