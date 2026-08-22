"use client";

import CommandCenter from "./CommandCenter";

/**
 * The tenant's home: Command Center v2 (HOME-01, plans 26-19/26-20).
 *
 * A one-line boolean switch and a second, older home component stood here so that an
 * owner-unapproved surface could never be what a tenant landed on. The owner approved v2 in the
 * 26-20 UAT on 2026-08-23, so the fork was deleted rather than left as a second home nobody
 * renders. See `26-20-SUMMARY.md` and `docs/playbooks/dashboard-pages.md`.
 *
 * ROLLBACK IS NO LONGER A FLAG. To withdraw this presentation, revert the approval commit. The
 * source queries it composes are untouched by that revert and every source page keeps working
 * either way — presentation is reversible here, stored data is not affected.
 *
 * NOTE for future edits: two tests assert this file contains no fork, no build-time env switch and
 * no mailbox gate of its own (`commandCenter.test.ts`, `workspace/cockpitAccess.test.ts`). They
 * read the SOURCE TEXT, so naming the removed symbols here would fail them — hence the prose.
 */
export default function Dashboard() {
  return <CommandCenter />;
}
