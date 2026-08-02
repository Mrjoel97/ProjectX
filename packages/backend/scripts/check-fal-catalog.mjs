#!/usr/bin/env node
/**
 * check-fal-catalog — D5(b): is the price table still the VENDOR's price? (plan 20-19)
 *
 * `packages/cost/src/media.ts` is a hand-maintained price table. The shipped fixture test proves
 * the table agrees with `media.fixtures.json` — i.e. that a table edit did not forget the fixture.
 * **It cannot detect that fal changed a price, because both sides of that comparison are ours.**
 * The only thing that can is a read of fal's own catalog, which is unauthenticated and free.
 *
 * The same response carries `status` / `deprecated` / `removed`, so this is simultaneously the
 * detector for the risk `docs/playbooks/media.md` names: `fal-ai/wan-25-preview/*` is a PREVIEW
 * endpoint, and preview paths get renamed and retired. A rename turns every generation into
 * `unknown_model` — the correct failure (loud, free, fail-closed) but one we would otherwise learn
 * about from a user.
 *
 * THREE OUTCOMES, and the third is the whole point:
 *   0  AGREE       every pinned id present, flags clean, every pinned vendor string byte-identical
 *   1  DRIFT       a price string changed, a flag flipped, or a pinned id is GONE from the catalog
 *   2  UNREACHABLE the catalog could not be read at all
 *
 * Exit 2 must NEVER collapse into 0: a monitor that reports green when it could not reach the thing
 * it monitors manufactures confidence, which is worse than having no monitor. It must not collapse
 * into 1 either — waking someone for a network blip trains them to ignore the alarm that matters.
 *
 * This is deliberately NOT a vitest test: a network call in the unit suite would make `pnpm test`
 * flaky, non-offline and non-free, and CI would go red on a vendor outage that says nothing about
 * our code.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE = process.env.FAL_CATALOG_BASE ?? "https://fal.ai/api/models";
const TIMEOUT_MS = Number(process.env.FAL_CATALOG_TIMEOUT_MS ?? 10_000);
/** The keywords that cover every id in the fixture — `_how_to_refresh` names these four. */
const KEYWORDS = ["wan-25", "inworld", "scribe", "schnell"];

const fixturePath = fileURLToPath(new URL("../../cost/src/media.fixtures.json", import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

/** Fetch one keyword page. Throws on ANY failure — the caller turns that into exit 2. */
async function fetchKeyword(keyword) {
  const url = `${BASE}?keywords=${encodeURIComponent(keyword)}&page=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const body = await res.json(); // a non-JSON body throws here, which is also unreachable
  if (!Array.isArray(body?.items)) throw new Error(`${url} → no items[] in response`);
  return body.items;
}

/** Every pinned id we could read, or `null` if the catalog could not be read at all. */
async function loadCatalog() {
  const catalog = new Map();
  try {
    for (const keyword of KEYWORDS) {
      for (const item of await fetchKeyword(keyword)) {
        if (item?.id) catalog.set(item.id, item);
      }
    }
    return catalog;
  } catch (err) {
    console.error("UNREACHABLE — could not read fal's catalog. This is NOT a price verdict:");
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    console.error("  Nothing is asserted about the price table. Re-run when the network is back.");
    return null;
  }
}

// `process.exitCode` throughout, never `process.exit()` — the latter can truncate stdout, and a
// truncated diff is the second-most-annoying failure mode of a check like this.
const catalog = await loadCatalog();
if (catalog === null) {
  process.exitCode = 2;
} else {
  const drift = [];
  console.log(
    `fal catalog check — ${fixture.entries.length} pinned ids, fixture read ${fixture.readAt}`,
  );

  for (const entry of fixture.entries) {
    const item = catalog.get(entry.id);
    if (!item) {
      // The `-preview` retirement, or a rename. This is the one that silently breaks the product.
      drift.push(`MISSING  ${entry.id} — not in the catalog. Renamed or retired?`);
      console.log(`  MISSING  ${entry.id}`);
      continue;
    }

    const problems = [];
    const flags = entry.vendor;
    if (item.status !== flags.status) problems.push(`status ${flags.status} → ${item.status}`);
    if (Boolean(item.deprecated) !== flags.deprecated)
      problems.push(`deprecated → ${item.deprecated}`);
    if (Boolean(item.removed) !== flags.removed) problems.push(`removed → ${item.removed}`);

    // The GENERAL rule, which handles FLUX schnell without a special case: an entry with no pinned
    // price string is checked for flags and presence only. If the vendor STARTS publishing one,
    // that IS a drift — the number becomes confirmable and the MEDIUM confidence must be resolved.
    for (const field of ["pricingInfoOverride", "billingMessage"]) {
      const pinned = flags[field] ?? null;
      const live = item[field] ?? null;
      if (pinned === null && live === null) continue;
      if (pinned === null) {
        problems.push(
          `${field} is NOW PUBLISHED (was absent) — resolve confidence:${entry.confidence}\n      vendor: ${live}`,
        );
        continue;
      }
      if (live === null) {
        problems.push(`${field} DISAPPEARED\n      fixture: ${pinned}`);
        continue;
      }
      // DIFF THE STRING, never a parsed number: a regex that extracts $0.05 silently passes a
      // vendor edit that changes the UNIT ("per second" → "per generated second") — exactly the
      // class of change ADR-011 exists to refuse, and it moves no number at all.
      if (pinned !== live) {
        problems.push(`${field} CHANGED\n      fixture: ${pinned}\n      vendor:  ${live}`);
      }
    }

    if (problems.length) {
      drift.push(`DRIFT    ${entry.id}\n    ${problems.join("\n    ")}`);
      console.log(`  DRIFT    ${entry.id}`);
    } else {
      console.log(`  OK       ${entry.id}`);
    }
  }

  if (drift.length) {
    console.error(
      `\nDRIFT — ${drift.length} of ${fixture.entries.length} pinned ids disagree with the vendor:\n`,
    );
    for (const d of drift) console.error(`  ${d}\n`);
    console.error(
      "The printed diff IS the patch instruction: update packages/cost/src/media.ts AND",
    );
    console.error("packages/cost/src/media.fixtures.json together, then re-run. See");
    console.error("docs/playbooks/media.md § Reconciliation.");
    process.exitCode = 1;
  } else {
    console.log(
      "\nAGREE — every pinned id is live, public, and priced exactly as the fixture records.",
    );
    process.exitCode = 0;
  }
}
