"use client";

import { api } from "@pikar/backend/api";
import { useAction } from "convex/react";
import { useCallback } from "react";

// ── THE BROWSER'S TRUSTED CLOCK (§2-D) ────────────────────────────────────────────────────────────
// `cockpit.sendCockpitMessage` has taken an optional `clientContext: { tz, nowMs }` since the
// calendar tools landed, and the agent loop refuses EVERY time-bearing tool without it:
// `stageCrmWrite` → `no_clock`, `setSendTime`, `checkAvailability` and `proposeCalendarEvent` →
// their own "I couldn't read your timezone" exits. **NO WEB CALLER EVER SENT IT** (phase-19 UAT
// step 7, 2026-08-10), so ACTN-05 and every phase-17 calendar tool were unreachable from the
// product while the eval gate — which supplies its own `clientContext` — certified them green.
//
// The fix is this hook rather than five call-site literals ON PURPOSE: the defect was a caller
// forgetting a field, and five copies of the same field is five chances to forget it again. Every
// browser-originated turn goes through here, so a NEW caller cannot be born clockless. Raw
// `useAction(api.cockpit.sendCockpitMessage)` in a component is the mistake this replaces —
// `crmCard.test.ts` scans for it.
//
// `nowMs` is read at CALL time (inside the callback), never at render: a chat pane can sit mounted
// for hours and a render-time clock would send a stale instant to a tool that stages a due date.

/** Never `undefined`: `clientContext.tz` is a `v.string()`, so an environment where Intl resolves
 *  nothing must degrade to UTC rather than throw the whole turn away at the validator. */
function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function useSendCockpitMessage() {
  const send = useAction(api.cockpit.sendCockpitMessage);
  return useCallback(
    (args: { threadId?: string; text: string }): Promise<{ threadId: string }> =>
      send({ ...args, clientContext: { nowMs: Date.now(), tz: browserTimeZone() } }),
    [send],
  );
}
