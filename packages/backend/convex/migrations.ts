// OPSG-06 migration harness. Install the component AND ship one migration that
// ACTUALLY RUNS — "a migration that has never run is a migration that does not
// work." Proven before Phase 3's first breaking change (see run-smoke-migration.mjs).
import { Migrations } from "@convex-dev/migrations";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

export const migrations = new Migrations<DataModel>(components.migrations);
export const run = migrations.runner();

// A migration that actually runs. Backfills the optional attachmentRefs default so
// the harness processes real rows once requests exist.
// ponytail: trivial backfill — Phase 3's first breaking change is the real exercise.
export const backfillRequestDefaults = migrations.define({
  table: "requests",
  migrateOne: async (_ctx, row) =>
    row.attachmentRefs === undefined ? { attachmentRefs: [] } : undefined,
});
