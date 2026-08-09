// The ONE place a folder refusal / skip code becomes prose — `failureCopy.ts`'s sibling.
//
// Same §4 rule, same reason: a refusal reason is a refs-only code that lives in `convex/` and is
// never shown to a user, so the wording belongs in the surface that renders it. `failureCopy.ts` is
// a flat `Record` of literal strings and CANNOT interpolate; this one takes NUMBERS, which is why
// it is a sibling module and not a new row there. Do NOT move either backend-side.
//
// Imports nothing on purpose — never the `@pikar/vault` barrel, which pulls xlsx into the bundle.

export type PreflightCopy = { title: string; remedy: string };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * NAMING BOTH NUMBERS IS THE DEFAULT, not a per-reason opt-in. Three reasons are the deny-list
 * because their numbers are meaningless — everything else, INCLUDING a refusal code added later,
 * names the estimate and what is left. That direction is the fail-safe one: a new code names real
 * figures rather than silently going quiet.
 *
 *   "This folder needs about $3.40 and you have $1.10 left today."
 *
 * NO-FIGURE DENY-LIST:
 *   kill_switch     — pricing never ran (guardrails.ts:510-511), so both numbers are 0.
 *   not_reserving   — a status CAS guard (vaultFolders.ts:114-117), zero-valued.
 *   manifest_short  — a manifest guard (vaultFolders.ts:128), zero-valued.
 */
export function refusalCopy(a: {
  reason: string;
  estimateCents: number;
  remainingCents: number;
}): PreflightCopy {
  switch (a.reason) {
    case "kill_switch":
      return {
        title: "Folder reading is paused right now.",
        remedy: "Nothing was read and nothing was charged. Try again later.",
      };
    case "not_reserving":
      return {
        title: "This folder has already been started.",
        remedy: "Refresh the page to see where it got to.",
      };
    case "manifest_short":
      return {
        title: "Your folder didn't match what reached us.",
        remedy: "Start over and pick the folder again.",
      };
  }

  // THE LOCKED SENTENCE. One template, one writer.
  const title = `This folder needs about ${money(a.estimateCents)} and you have ${money(
    a.remainingCents,
  )} left today.`;
  switch (a.reason) {
    case "over_folder_cap":
      return {
        title,
        remedy: "It's over one day's limit on its own. Remove some files and start again.",
      };
    case "over_deployment_cap":
      return {
        title,
        remedy: "It's over the limit for everyone today. Remove some files and start again.",
      };
    case "deployment_ingest_exhausted":
      return { title, remedy: "Reading is paused for everyone today. Start again tomorrow." };
    default:
      // `ingest_daily_exhausted` and any code added later.
      return {
        title,
        remedy: "Remove some files, or start again tomorrow when your allowance resets.",
      };
  }
}

/**
 * A per-file estimate reason -> the one line the skipped list shows, or `null` when the reason is
 * not a skip at all. `null` IS the membership test: it keeps the skip vocabulary
 * (`ingestEstimate.ts:114-121`) in the module that already owns code->prose, so the pre-flight
 * needs no literal set of its own.
 *
 * Never names a size — the surface scan bans any "100 MB" string, and a number here would go stale
 * against the constant the moment the cap moves.
 */
export function skipCopy(reason: string): string | null {
  switch (reason) {
    case "empty_file":
      return "This file is empty.";
    case "over_video_cap":
      return "This video is too large to read.";
    case "over_file_cap":
      return "This file is too large to read.";
    default:
      return null;
  }
}
