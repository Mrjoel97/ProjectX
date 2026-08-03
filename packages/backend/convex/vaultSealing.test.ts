// SEALING (VALT-07, 15.3-05) — a folder's members are excluded from retrieval until the folder is
// `complete`, at EVERY site that can hand a doc id to a reader.
//
// This whole file is made of ABSENCES, which is the reason every test below names the mutation that
// makes it go red. An absence test passes for free when the thing it guards was never reachable in
// the first place, so each one first proves the document IS reachable (the unseal half, the
// unsealed-neighbour control, the pre-folder count) and only then proves it is not.
//
// Everything runs offline through the shipped `SMOKE::` seams (`vaultGround.ts:48-60`,
// `vault.ts:618`): the seed doc ids ride in the query and no embedding call is made, so this file
// costs nothing to run.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);

const TENANT = "tenant_seal";
const asTenant = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: TENANT });

type Harness = ReturnType<typeof convexTest>;

/** A folder row at an explicit status. `ingesting` is the sealed window; `complete` is not. */
const seedFolder = (t: Harness, status: "reserving" | "ingesting" | "complete" | "refused") =>
  t.run((ctx) =>
    ctx.db.insert("vaultFolders", {
      tenantId: TENANT,
      name: "Company docs",
      source: "upload" as const,
      status,
      memberCount: 1,
      terminalCount: 0,
      failedCount: 0,
      reservedCents: 10,
      spentCents: 0,
      createdAt: Date.now(),
    }),
  );

/**
 * A doc that has genuinely finished ingest: `status: "ready"` AND a `ragEntryId`. Both matter —
 * sealed members really do embed during the sealed window (that is why sealing is a filter and not
 * an ingest skip), so a fixture that left them unembedded would prove nothing.
 */
const seedDoc = (
  t: Harness,
  title: string,
  folderId?: Id<"vaultFolders">,
): Promise<Id<"vaultDocuments">> =>
  t.run((ctx) =>
    ctx.db.insert("vaultDocuments", {
      tenantId: TENANT,
      title,
      kind: "upload",
      category: "my-uploads",
      source: "upload",
      mimeType: "text/plain",
      size: 1,
      contentHash: `c-${title}`,
      status: "ready",
      ragEntryId: `entry-${title}`,
      text: `${title} body`,
      createdAt: Date.now(),
      folderId,
    }),
  );

/** Ground through the shipped offline seam and return only the doc ids. */
const ground = async (t: Harness, ...seeds: Id<"vaultDocuments">[]): Promise<string[]> =>
  (
    await t.action(internal.vaultGround.vaultGroundHydrated, {
      tenantId: TENANT,
      query: `SMOKE::${seeds.join(",")}`,
    })
  ).docIds;

/** Attribute one edge (from—to) to a source doc through the REAL upsert, so the graph is real. */
const seedEdge = (t: Harness, sourceDocId: Id<"vaultDocuments">, from: string, to: string) =>
  t.mutation(internal.vaultGraph.upsertGraph, {
    tenantId: TENANT,
    sourceDocId,
    nodes: [
      { type: "topic", name: from },
      { type: "topic", name: to },
    ],
    edges: [{ from, to, rel: "rel" }],
  });

// ── 1. Sealed, then UNSEALED ─────────────────────────────────────────────────
//
// The second half is the load-bearing one. A filter that dropped folder members FOREVER — or a
// predicate accidentally keyed on `folderId != null` alone — passes the first assertion and fails
// the product: the whole point of ingesting a folder is that it becomes groundable when it lands.
//
// Mutation RUN: delete the seed filter from `runVaultGround` -> RED (the sealed doc is returned).
describe("a folder member is unretrievable while ingesting, and retrievable once complete", () => {
  test("the same document, the same query, on both sides of completion", async () => {
    const t = convexTest(schema, modules);
    const folderId = await seedFolder(t, "ingesting");
    const member = await seedDoc(t, "Member", folderId);

    expect(await ground(t, member)).toEqual([]);

    await t.run((ctx) => ctx.db.patch(folderId, { status: "complete" }));

    expect(await ground(t, member)).toEqual([member]);
  });

  test("a document with no folder at all is untouched by any of this", async () => {
    // The regression control for the whole plan: an existing tenant with zero folders must see
    // byte-identical grounding. If this goes red, sealing has leaked into the ordinary path.
    const t = convexTest(schema, modules);
    const loose = await seedDoc(t, "Loose");
    expect(await ground(t, loose)).toEqual([loose]);
  });
});

// ── 2. The graph neighbour — an INDEPENDENT leak path ────────────────────────
//
// `vaultGraph.expand` resolves neighbours straight out of `graphEdges` with no status, origin or
// folder filter of its own. A seeds-only fix cannot catch this, which is exactly what makes this
// test worth its lines: it is the one that fails on the plausible half-fix.
//
// Mutation RUN: filter only the seeds in `runVaultGround` (drop the `sealedNeighbors` filter)
// -> RED, the sealed member comes back as a graph neighbour of an unsealed document.
describe("a sealed member cannot be reached as a graph neighbour", () => {
  test("grounding an unsealed doc does not pull its sealed neighbour in", async () => {
    const t = convexTest(schema, modules);
    const folderId = await seedFolder(t, "ingesting");
    const outsider = await seedDoc(t, "Outsider");
    const member = await seedDoc(t, "Member", folderId);

    // The chain fixture from `vaultGraph.test.ts`: the documents are linked by a SHARED NODE, not
    // a shared edge. Giving both the identical pair does NOT work — `upsertGraph` dedups edges
    // cross-doc, so the second document would never own a `graphEdges` row and `expand` (which
    // resolves neighbours by `sourceDocId`) could not see it for a reason unrelated to sealing.
    // That is what the non-vacuity assertion below caught.
    await seedEdge(t, outsider, "Alice", "Bob");
    await seedEdge(t, member, "Bob", "Carol");

    expect(await ground(t, outsider)).toEqual([outsider]);

    // NON-VACUITY: the identical fixture with the folder complete DOES return the neighbour, so
    // the assertion above is measuring the seal and not a graph that never connected.
    await t.run((ctx) => ctx.db.patch(folderId, { status: "complete" }));
    expect(await ground(t, outsider)).toContain(member);
  });
});

// ── 3. The browse search box ─────────────────────────────────────────────────
//
// Mutation RUN: drop the `sealedDocIds` filter from `vault.vaultSearch` -> RED. Without it the
// browse search surfaces documents the agent cannot see, which reads as a bug in whichever of the
// two surfaces the user happens to check second.
describe("a sealed member does not appear in browse search", () => {
  test("vaultSearch hides it while ingesting and shows it once complete", async () => {
    const t = convexTest(schema, modules);
    const folderId = await seedFolder(t, "ingesting");
    const member = await seedDoc(t, "Member", folderId);

    expect(await asTenant(t).action(api.vault.vaultSearch, { query: `SMOKE::${member}` })).toEqual(
      [],
    );

    await t.run((ctx) => ctx.db.patch(folderId, { status: "complete" }));

    const found = await asTenant(t).action(api.vault.vaultSearch, { query: `SMOKE::${member}` });
    expect(found.map((d) => d._id)).toEqual([member]);
  });
});

// ── 4. The blueprint drift count ─────────────────────────────────────────────
//
// The site that is easiest to miss and most expensive to miss: a folder's members reach
// `status: "ready"` at ingest step 6 DURING the sealed window, and `spineForTenant` runs
// `unincorporatedFor` on EVERY grounding call. Without the filter, uploading a folder makes the
// blueprint spine announce drift the user cannot act on, on every cockpit turn, for the whole
// ingest window.
//
// Asserted through `unincorporatedCountForTenant` rather than `spineForTenant`: it is the same
// `unincorporatedFor` helper, and `spineForTenant` returns null with no live blueprint — so a test
// driven through it would need a whole blueprint fixture to avoid being vacuous.
//
// Mutation RUN: drop `!sealed.has(doc._id)` from `unincorporatedFor` -> RED, the count jumps to 3.
describe("a sealed folder does not move the blueprint drift count", () => {
  test("the count is the same before the folder existed and while it ingests", async () => {
    const t = convexTest(schema, modules);
    await seedDoc(t, "Standalone");

    const before = await t.query(internal.blueprint.unincorporatedCountForTenant, {
      tenantId: TENANT,
      sourceDocIds: [],
    });
    expect(before).toBe(1);

    const folderId = await seedFolder(t, "ingesting");
    await seedDoc(t, "M1", folderId);
    await seedDoc(t, "M2", folderId);

    const during = await t.query(internal.blueprint.unincorporatedCountForTenant, {
      tenantId: TENANT,
      sourceDocIds: [],
    });
    expect(during).toBe(before);

    // And the drift the user CAN act on appears the moment the folder lands.
    await t.run((ctx) => ctx.db.patch(folderId, { status: "complete" }));
    expect(
      await t.query(internal.blueprint.unincorporatedCountForTenant, {
        tenantId: TENANT,
        sourceDocIds: [],
      }),
    ).toBe(3);
  });
});

// ── 5. Cancelled ⇒ groundable. THE ONE-WORD BUG ──────────────────────────────
//
// `cancelFolder` DELETES the folder row and writes ZERO document rows, so a cancelled folder's
// members stay as ordinary documents carrying a DANGLING `folderId`. A missing folder therefore
// has to read as folder-less.
//
// Mutation RUN: write the predicate as `folder?.status !== "complete"` -> RED. `undefined` is not
// `"complete"`, so every cancelled folder's members are sealed FOREVER, silently, with no row left
// anywhere to explain why the user's documents stopped answering.
describe("a document whose folder row no longer exists is folder-less, not sealed", () => {
  test("members survive the deletion of their folder and stay groundable", async () => {
    const t = convexTest(schema, modules);
    const folderId = await seedFolder(t, "ingesting");
    const member = await seedDoc(t, "Member", folderId);

    expect(await ground(t, member)).toEqual([]); // sealed while the folder is alive

    await t.run((ctx) => ctx.db.delete(folderId));

    // The dangling folderId is still on the row — that IS the cancel mechanism, not an oversight.
    expect(await t.run((ctx) => ctx.db.get(member))).toMatchObject({ folderId });
    expect(await ground(t, member)).toEqual([member]);

    // The other two sites agree, because they share the one predicate.
    const found = await asTenant(t).action(api.vault.vaultSearch, { query: `SMOKE::${member}` });
    expect(found.map((d) => d._id)).toEqual([member]);
    expect(
      await t.query(internal.blueprint.unincorporatedCountForTenant, {
        tenantId: TENANT,
        sourceDocIds: [],
      }),
    ).toBe(1);
  });
});
