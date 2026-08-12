import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "@pikar/backend/api";
import { expect, type Page, test } from "@playwright/test";
import { fetchMutation, fetchQuery } from "convex/nextjs";

// VALT-16 — connected Nord Edge coverage over the real authenticated Vault route. The fixture
// uses the shipped SMOKE:: ingest seam, so folder reservation, upload, reactive ingest, scoped
// search and preview all run without an embedding/model bill. Drive remains a real entry point;
// this spec deliberately does not fake a successful external Drive import.

type Auth = { token: string; url: string };

const backendDir =
  process.env.PIKAR_E2E_BACKEND_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/backend");
const convexBin = resolve(backendDir, "node_modules/convex/bin/main.js");
const CLI_FAILURE = /Failed to run function|Uncaught Error|isn't running|not listening/;

function convexRun(fn: string, args: Record<string, unknown>): void {
  const result = spawnSync(process.execPath, [convexBin, "run", fn, JSON.stringify(args)], {
    cwd: backendDir,
    encoding: "utf8",
  });
  if (result.error) throw new Error(`spawn failed for ${fn}: ${result.error.message}`);
  const stderr = result.stderr ?? "";
  if (CLI_FAILURE.test(stderr)) throw new Error(`${fn} failed:\n${stderr.trim()}`);
}

function tenantIdFrom(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Malformed Convex Auth JWT (no payload segment).");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string };
  if (!claims.sub) throw new Error("Convex Auth JWT carries no `sub` claim.");
  const userId = claims.sub.split("|")[0];
  if (!userId) throw new Error("Convex Auth JWT subject carries no stable user id.");
  return userId;
}

async function authFor(page: Page): Promise<Auth> {
  const token = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((candidate) =>
      candidate.startsWith("__convexAuthJWT"),
    );
    return key ? window.localStorage.getItem(key) : null;
  });
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!token) throw new Error("Vault E2E has no Convex Auth JWT in storageState.");
  if (!url) throw new Error("Vault E2E needs NEXT_PUBLIC_CONVEX_URL from apps/web/.env.local.");
  return { token, url };
}

test("root/category search → folder-scoped search → preview → empty/no-results recovery", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const rootDump = `SMOKE::graph::VaultRoot${suffix}|Acme${suffix}|owns`;
  const folderPath = mkdtempSync(join(tmpdir(), "vault-e2e-"));
  const folderName = basename(folderPath);
  const folderFilename = `scoped-${suffix}.txt`;
  writeFileSync(
    join(folderPath, folderFilename),
    `SMOKE::graph::VaultFolder${suffix}|Initech${suffix}|works_at`,
  );

  let auth: Auth | null = null;

  try {
    await page.goto("/dashboard/vault");
    auth = await authFor(page);

    // A fresh local signup is intentionally held behind onboarding. Use the repository's shipped,
    // internal-only E2E seam for this authenticated tenant, then reload the same real route. The
    // seeder writes a ready profile without embedding/model spend and preserves the production gate.
    convexRun("onboarding:__seedOnboardedTenant", { tenantId: tenantIdFrom(auth.token) });
    await page.goto("/dashboard/vault");
    await expect(page.getByRole("heading", { name: "Knowledge Vault" })).toBeVisible({
      timeout: 15_000,
    });

    // The connected root keeps every retained entry point. Category tabs intentionally carry no
    // fabricated counts: each accessible name is exactly its bounded category label.
    const tabs = page.getByRole("tablist", { name: "Vault categories" });
    for (const name of [
      "My Uploads",
      "Workspace Docs",
      "Images",
      "Videos",
      "Google Docs",
      "Brain Dumps",
    ]) {
      await expect(tabs.getByRole("tab", { name, exact: true })).toBeVisible();
    }
    const addPanel = page.getByLabel("Add to your vault");
    await expect(addPanel.getByRole("button", { name: "Upload a file" })).toBeVisible();
    await expect(addPanel.getByRole("button", { name: "Choose a folder" })).toBeVisible();
    await expect(addPanel.getByRole("button", { name: "Import from Drive" })).toBeVisible();

    // Root/category fixture through the real paste mutation.
    await page.getByRole("button", { name: "+ Paste a Brain Dump" }).click();
    await page.getByLabel("Brain Dump text").fill(rootDump);
    await page.getByRole("button", { name: "Save Brain Dump" }).click();
    await tabs.getByRole("tab", { name: "Brain Dumps" }).click();
    const rootCard = page.getByRole("button").filter({ hasText: rootDump });
    await expect(rootCard).toBeVisible({ timeout: 20_000 });

    // Folder fixture through the real directory picker, pre-flight, upload and reserve path.
    await page.getByLabel("Choose a folder to upload").setInputFiles(folderPath);
    const preflight = page.getByRole("region", { name: "FOLDER UPLOAD · REVIEW BEFORE START" });
    await expect(preflight).toContainText(folderName);
    await expect(preflight.getByText("1", { exact: true }).first()).toBeVisible();
    await expect(preflight.getByRole("button", { name: "Start" })).toBeEnabled({
      timeout: 15_000,
    });
    await preflight.getByRole("button", { name: "Start" }).click();

    const folderControl = page.getByRole("button", { name: `Open folder: ${folderName}` });
    await expect(folderControl).toBeVisible({ timeout: 30_000 });

    const folder = await expect
      .poll(
        async () => {
          const rows = await fetchQuery(api.vaultFolders.listFolders, {}, auth!);
          return rows.find((row) => row.name === folderName && row.status === "complete") ?? null;
        },
        { timeout: 45_000 },
      )
      .not.toBeNull()
      .then(async () => {
        const rows = await fetchQuery(api.vaultFolders.listFolders, {}, auth!);
        const row = rows.find((candidate) => candidate.name === folderName);
        if (!row) throw new Error("Vault E2E folder disappeared after completion.");
        return row;
      });

    const folderDoc = await expect
      .poll(
        async () => {
          const rows = await fetchQuery(api.vault.listVaultDocs, { folderId: folder._id }, auth!);
          return rows.find((row) => row.title === folderFilename && row.status === "ready") ?? null;
        },
        { timeout: 45_000 },
      )
      .not.toBeNull()
      .then(async () => {
        const rows = await fetchQuery(api.vault.listVaultDocs, { folderId: folder._id }, auth!);
        const row = rows.find((candidate) => candidate.title === folderFilename);
        if (!row) throw new Error("Vault E2E folder document disappeared after ingest.");
        return row;
      });

    const rootDoc = await expect
      .poll(
        async () => {
          const rows = await fetchQuery(
            api.vault.listVaultDocs,
            { category: "brain-dumps" },
            auth!,
          );
          return rows.find((row) => row.title === rootDump && row.status === "ready") ?? null;
        },
        { timeout: 30_000 },
      )
      .not.toBeNull()
      .then(async () => {
        const rows = await fetchQuery(api.vault.listVaultDocs, { category: "brain-dumps" }, auth!);
        const row = rows.find((candidate) => candidate.title === rootDump);
        if (!row) throw new Error("Vault E2E root document disappeared after ingest.");
        return row;
      });

    // Root search remains category-aware, and a no-result state can recover without losing browse.
    const search = page.getByLabel("Search my uploads");
    await search.fill(`SMOKE::${rootDoc._id}`);
    await search.press("Enter");
    await expect(rootCard).toBeVisible();
    await search.fill(`SMOKE::${folderDoc._id}`);
    await search.press("Enter");
    await expect(page.getByText(/No documents match/)).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(rootCard).toBeVisible();

    // A folder replaces category context. Passing BOTH IDs is the non-vacuity anchor: only the
    // member survives the server folderId predicate, while the same-tenant root document does not.
    await folderControl.click();
    await expect(page.getByRole("region", { name: "Current folder" })).toContainText(folderName);
    await expect(tabs).toHaveCount(0);
    const folderSearch = page.getByLabel("Search my uploads");
    await folderSearch.fill(`SMOKE::${rootDoc._id},${folderDoc._id}`);
    await folderSearch.press("Enter");
    const folderCard = page.getByRole("button").filter({ hasText: folderFilename });
    await expect(folderCard).toBeVisible();
    await expect(page.getByRole("button").filter({ hasText: rootDump })).toHaveCount(0);

    await folderSearch.fill(`SMOKE::${rootDoc._id}`);
    await folderSearch.press("Enter");
    await expect(page.getByText(/No documents match/)).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(folderCard).toBeVisible();

    // Preview retains identity, provenance, original download and governed two-step removal. Escape
    // closes the in-place dialog and restores the invoking document control's focus.
    await folderCard.click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Document identity")).toBeVisible();
    await expect(dialog.getByText("Entities & citations")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Download original" })).toBeVisible();
    await dialog.getByRole("button", { name: "Close preview" }).click();
    await expect(dialog).toBeHidden();

    await folderCard.click();
    dialog = page.getByRole("dialog");
    await dialog.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(folderCard).toBeFocused();

    await folderCard.click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Remove from vault" }).click();
    const confirmation = dialog.getByRole("group", { name: "Confirm document removal" });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "Yes, remove it" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: "This folder has no documents." })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "← All documents" }).click();
    await expect(page.getByRole("button", { name: `Open folder: ${folderName}` })).toBeVisible();
  } finally {
    if (auth) {
      const folders = await fetchQuery(api.vaultFolders.listFolders, {}, auth).catch(() => []);
      const folder = folders.find((row) => row.name === folderName);
      if (folder) {
        const members = await fetchQuery(
          api.vault.listVaultDocs,
          { folderId: folder._id },
          auth,
        ).catch(() => []);
        for (const member of members) {
          await fetchMutation(api.vault.deleteVaultDoc, { vaultDocId: member._id }, auth).catch(
            () => undefined,
          );
        }
        await fetchMutation(api.vaultFolders.cancelFolder, { folderId: folder._id }, auth).catch(
          () => undefined,
        );
      }

      const roots = await fetchQuery(
        api.vault.listVaultDocs,
        { category: "brain-dumps" },
        auth,
      ).catch(() => []);
      for (const root of roots.filter((row) => row.title === rootDump)) {
        await fetchMutation(api.vault.deleteVaultDoc, { vaultDocId: root._id }, auth).catch(
          () => undefined,
        );
      }
    }
    rmSync(folderPath, { recursive: true, force: true });
  }
});
