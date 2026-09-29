// Phase 25 baseline probe: inspect Convex's parsed schema, including authTables.
// Run with PIKAR_SCHEMA_INVENTORY=1 to print the full table/index manifest.
import { expect, test } from "vitest";
import schema from "./schema";

type Index = { indexDescriptor: string; fields?: readonly string[] };
type ParsedTable = {
  indexes?: Index[];
  searchIndexes?: Index[];
  vectorIndexes?: Index[];
};

test("Phase 25 parsed schema inventory has unique table/index descriptors", () => {
  const tables = schema.tables as unknown as Record<string, ParsedTable>;
  const inventory = Object.entries(tables)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([table, definition]) => ({
      table,
      indexes: (definition.indexes ?? []).map((index) => ({
        name: index.indexDescriptor,
        fields: index.fields ?? [],
      })),
      searchIndexes: (definition.searchIndexes ?? []).map((index) => index.indexDescriptor),
      vectorIndexes: (definition.vectorIndexes ?? []).map((index) => index.indexDescriptor),
    }));

  expect(inventory.length).toBeGreaterThan(0);
  for (const entry of inventory) {
    const names = [
      ...entry.indexes.map((index) => index.name),
      ...entry.searchIndexes,
      ...entry.vectorIndexes,
    ];
    expect(new Set(names).size, `${entry.table} has duplicate index descriptors`).toBe(names.length);
  }

  if (process.env.PIKAR_SCHEMA_INVENTORY === "1") {
    console.log(`PHASE25_SCHEMA_INVENTORY=${JSON.stringify(inventory)}`);
  }
});
