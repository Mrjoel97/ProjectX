# Connections Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Google Disconnect control findable by giving `/dashboard/profile` a fourth "Connections" tab, and name the three integration categories that cannot connect yet along with the real reason each is blocked.

**Architecture:** Pure frontend. Both backend functions already exist and are tenant-scoped (`gmailAuth.gmailStatus`, `gmailAuth.disconnectGoogle`). The disconnect button is extracted to a shared component so its confirm copy has one writer, a new `ConnectionsPanel` slots into the profile page's existing `TABS` array, and the rail's stale "Connect Gmail" footer item is relabelled to point at the tab.

**Tech Stack:** Next.js 16 (App Router, client components), React 19, Convex 1.42.1 (`useQuery`/`useAction`), Vitest (checks live in `packages/core`), inline style objects (no component library).

**Spec:** `docs/superpowers/specs/2026-08-02-connections-tab-design.md`

## Global Constraints

- **Zero backend change.** No new Convex function, no new table, no `schema.ts` edit, no `middleware.ts` edit. If a task seems to need one, stop — the design is wrong, not the constraint.
- **No component library and no new dependency.** BRAND §8.3: inline `React.CSSProperties` objects. Reuse `dashboard/profile/styles.ts` (`card`, `label`) rather than re-declaring them.
- **Use `globals.css` CSS variables; never hardcode a hex a token covers** (CLAUDE.md §10). Available here: `--ink`, `--ink-soft`, `--card`, `--rule`, `--released`, `--teal-600`, `--canvas`.
- **No provider abstraction.** No `Record<Provider, …>`, no `ConnectionRow` interface, no `providers.ts`. One live provider is written concretely. Phase 25 mints the lookup alongside the Microsoft Graph adapter.
- **`ponytail:` comment on every hardcoded blocker string**, naming what clears it.
- **CLAUDE.md §9:** a playbook covering a touched path is updated in the SAME commit, with its `Last verified` line bumped. Path ownership (from `docs/playbooks/watch.json`): `dashboard/profile/` → `onboarding.md`; `connect-gmail/` → `cockpit.md`; `_components/DisconnectGoogle.tsx` → **currently unwatched, Task 1 registers it**.
- **NEVER `git add -A` or `git commit -a`.** Another lane has uncommitted work in this shared working tree (including a red `packages/core/src/specialists.ts`). Stage explicit paths only, exactly as each Commit step lists them.
- **`packages/core` is currently RED** (5 failures in `specialists.test.ts`, foreign lane). When a step says "all tests pass", it means *your new test file passes and you introduced no new failures* — compare against that known-red baseline, do not try to fix it.

---

### Task 1: Extract the shared DisconnectGoogle button

The confirm copy warning that disconnect kills **calendar as well as mail** currently lives inline in `connect-gmail/page.tsx`. The Connections tab needs the same control. Two copies of one user-facing warning drift the moment the Google scope changes, so it gets one writer before there is a second caller.

**Files:**
- Create: `apps/web/app/(app)/_components/DisconnectGoogle.tsx`
- Modify: `apps/web/app/(app)/connect-gmail/page.tsx` (remove the inline disconnect handler + button, import the component)
- Modify: `docs/playbooks/watch.json` (register the new file under `cockpit.md`)
- Modify: `docs/playbooks/cockpit.md` (`Last verified` bump)
- Test: `packages/core/src/connectionsSurface.test.ts` (create)

**Interfaces:**
- Consumes: `api.gmailAuth.disconnectGoogle` — a `tenantAction` taking no args, returning `Promise<{ revoked: boolean }>`.
- Produces: `export function DisconnectGoogle(): JSX.Element` — no props. Task 2 renders it inside `GoogleRow`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/connectionsSurface.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// These files live in `apps/web`, outside this package. Reading them by path is the established
// repo idiom for asserting a guarantee that lives in the UI — see the profile source scan in
// `businessProfile.test.ts` and `traceParity.test.ts` in packages/backend.
const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8");

const WEB = "apps/web/app/(app)";
const button = read(`${WEB}/_components/DisconnectGoogle.tsx`);
const connectPage = read(`${WEB}/connect-gmail/page.tsx`);

// The exact user-facing sentence. If the Google scope changes, this string changes in ONE place.
const CONFIRM = "Disconnect Google? Pikar will lose access to your mail AND your calendar.";

describe("DisconnectGoogle is the single writer of the disconnect copy", () => {
  // Non-vacuity FIRST. Every assertion below is a `not.toContain`, and a `not.toContain` over an
  // empty or wrong string passes forever. `readFileSync` throws on a missing path; this catches
  // the subtler case of reading a file that no longer holds what we think it does.
  test("both files are really being scanned", () => {
    expect(button.length).toBeGreaterThan(300);
    expect(button).toContain("export function DisconnectGoogle");
    expect(connectPage.length).toBeGreaterThan(500);
    expect(connectPage).toContain("api.gmailAuth.gmailConnectUrl");
  });

  test("the confirm copy lives in the shared component", () => {
    expect(button).toContain(CONFIRM);
  });

  test("connect-gmail no longer declares its own copy of the confirm or the action", () => {
    expect(connectPage).not.toContain(CONFIRM);
    expect(connectPage).not.toContain("api.gmailAuth.disconnectGoogle");
    expect(connectPage).toContain("DisconnectGoogle");
  });

  test("a revoke that Google did not confirm is not reported as a clean disconnect", () => {
    // deleteTokens runs UNCONDITIONALLY in the action, so `revoked: false` means our copy is gone
    // but Google may still hold the grant. The component must branch on it.
    expect(button).toContain("revoked");
    expect(button).toContain("myaccount.google.com/permissions");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd packages/core && npx vitest run src/connectionsSurface.test.ts
```

Expected: FAIL — `ENOENT` on `_components/DisconnectGoogle.tsx`, because the file does not exist yet.

- [ ] **Step 3: Create the shared component**

Create `apps/web/app/(app)/_components/DisconnectGoogle.tsx`:

```tsx
"use client";

import { api } from "@pikar/backend/api";
import { useAction } from "convex/react";
import { useState } from "react";

// ONE writer for the disconnect confirm copy and for how a partial revoke is reported. This was
// inline in `connect-gmail/page.tsx` until the Connections tab needed the same control; two copies
// of a user-facing warning drift the moment the Google scope changes.
export function DisconnectGoogle() {
  const disconnect = useAction(api.gmailAuth.disconnectGoogle);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const onDisconnect = async () => {
    // ponytail: window.confirm — this app has no dialog pattern (BRAND §5 defines none). Native is
    // keyboard-accessible and costs no component. Build a real dialog when a SECOND destructive
    // control needs one.
    // The copy names calendar deliberately: it is ONE Google grant covering mail and calendar, so
    // a user who reads "disconnect Gmail" would not expect their events to stop working.
    const ok = window.confirm(
      "Disconnect Google? Pikar will lose access to your mail AND your calendar. " +
        "Any scheduled send will be held until you reconnect.",
    );
    if (!ok) return;
    setBusy(true);
    setNote(null);
    try {
      const { revoked } = await disconnect();
      // `deleteTokens` runs UNCONDITIONALLY in the action (gmailAuth.ts), so `revoked: false` means
      // our copy is deleted but Google may still hold the grant. Reporting a flat "Disconnected"
      // here would be a second false promise of exactly the kind this control exists to retire.
      if (!revoked) {
        setNote(
          "Pikar's copy of your token is deleted, but Google did not confirm the revocation. " +
            "Remove Pikar at myaccount.google.com/permissions to be certain.",
        );
      }
    } catch {
      // A thrown fetch aborts the action BEFORE deleteTokens, so the connection really is intact.
      setNote("Disconnect failed — your connection is unchanged. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: "0.4rem", justifyItems: "start" }}>
      <button
        type="button"
        onClick={() => void onDisconnect()}
        disabled={busy}
        style={{
          padding: "0.45rem 0.9rem",
          borderRadius: "0.375rem",
          border: "1px solid var(--rule)",
          background: "transparent",
          color: "var(--ink-soft)",
          fontWeight: 600,
          cursor: busy ? "default" : "pointer",
          width: "fit-content",
        }}
      >
        {busy ? "Disconnecting…" : "Disconnect Google"}
      </button>
      {note && (
        <p role="status" style={{ margin: 0, fontSize: "0.85rem", color: "var(--ink-soft)", maxWidth: "34rem" }}>
          {note}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rewire connect-gmail to use it**

In `apps/web/app/(app)/connect-gmail/page.tsx`:

1. Add the import beside the existing ones:

```tsx
import { DisconnectGoogle } from "../_components/DisconnectGoogle";
```

2. Delete the now-unused `disconnect`, `busy` and `onDisconnect` declarations (the `const disconnect = useAction(...)` line, the `const [busy, setBusy] = useState(false)` line, and the whole `onDisconnect` function including its comment block).

3. Replace the entire inline `<button type="button" onClick={() => void onDisconnect()} …>{busy ? "Disconnecting…" : "Disconnect Google"}</button>` element with:

```tsx
<div style={{ marginTop: "0.75rem" }}>
  <DisconnectGoogle />
</div>
```

4. Change the `useAction` import to drop it if nothing else on the page uses it — check first: if `useAction` has no remaining call, the import becomes `import { useQuery } from "convex/react";`.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd packages/core && npx vitest run src/connectionsSurface.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Typecheck the web app**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors. A leftover `busy` or `disconnect` reference surfaces here.

- [ ] **Step 7: Register the new file in watch.json**

`_components/DisconnectGoogle.tsx` is covered by no playbook, and the Stop hook rejects a new uncovered file under `apps/`. Add it to the `cockpit.md` path list in `docs/playbooks/watch.json` (that entry already owns `connect-gmail/` and `gmailAuth.ts`), immediately after the `"apps/web/app/(app)/connect-gmail/"` entry:

```json
"apps/web/app/(app)/_components/DisconnectGoogle.tsx",
```

- [ ] **Step 8: Bump cockpit.md**

Add a new `> Last verified: 2026-08-02 (…)` block at the top of the existing run of them in `docs/playbooks/cockpit.md`, and demote the previous top entry to `> Prior: …`. Content: the disconnect control moved to `_components/DisconnectGoogle.tsx` so its confirm copy and its partial-revoke branch have one writer; `connect-gmail/page.tsx` renders it and no longer calls `disconnectGoogle` itself; no backend behaviour changed.

> **Note:** `docs/playbooks/*.md` are CRLF. Anchor edits on a SINGLE line — a multi-line `\n` anchor silently matches nothing.

- [ ] **Step 9: Commit**

```bash
git add "apps/web/app/(app)/_components/DisconnectGoogle.tsx" "apps/web/app/(app)/connect-gmail/page.tsx" packages/core/src/connectionsSurface.test.ts docs/playbooks/watch.json docs/playbooks/cockpit.md
git commit -m "refactor(connections): one writer for the Google disconnect copy"
```

---

### Task 2: The Connections panel and its tab

**Files:**
- Create: `apps/web/app/(app)/dashboard/profile/connections.ts`
- Create: `apps/web/app/(app)/dashboard/profile/ConnectionsPanel.tsx`
- Modify: `apps/web/app/(app)/dashboard/profile/page.tsx` (one `TABS` entry, one `<div role="tabpanel">`)
- Modify: `docs/playbooks/onboarding.md` (`Last verified` bump)
- Test: `packages/core/src/connectionsSurface.test.ts` (extend)

**Interfaces:**
- Consumes: `DisconnectGoogle` from Task 1; `api.gmailAuth.gmailStatus` → `{ connected: boolean; expiresAt: number | null }`; `card` and `label` from `./styles`.
- Produces: `export const BLOCKED: readonly BlockedConnection[]` and `export function ConnectionsPanel(): JSX.Element`.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/connectionsSurface.test.ts`:

```ts
const panel = read(`${WEB}/dashboard/profile/ConnectionsPanel.tsx`);
const data = read(`${WEB}/dashboard/profile/connections.ts`);
const profilePage = read(`${WEB}/dashboard/profile/page.tsx`);

describe("the blocked rows are information, not decoration", () => {
  test("the data module and panel are really being scanned", () => {
    expect(data.length).toBeGreaterThan(300);
    expect(data).toContain("export const BLOCKED");
    expect(panel).toContain("export function ConnectionsPanel");
  });

  // `connections.ts` holds ONLY the array, so these two keys cannot collide with anything else in
  // the file — which is why the data lives in its own module instead of inside the .tsx.
  test("every blocked entry carries a non-empty blocker", () => {
    const labels = data.match(/^\s*label:/gm) ?? [];
    const blockers = data.match(/^\s*blocker:/gm) ?? [];
    expect(labels.length).toBeGreaterThanOrEqual(3);
    expect(blockers.length).toBe(labels.length);
    expect(data).not.toMatch(/blocker:\s*""/);
  });

  test("every blocked entry carries a ponytail comment naming what clears it", () => {
    const ponytails = data.match(/ponytail:/g) ?? [];
    const labels = data.match(/^\s*label:/gm) ?? [];
    expect(ponytails.length).toBe(labels.length);
  });

  // A dead "Connect" button that does nothing is the exact failure this tab exists to avoid.
  test("the blocked rows expose no interactive control", () => {
    const start = panel.indexOf("BLOCKED.map(");
    expect(start, "BLOCKED.map( not found — the scan below would be vacuous").toBeGreaterThan(-1);
    const block = panel.slice(start, panel.indexOf("</section>", start));
    expect(block.length).toBeGreaterThan(100);
    expect(block).not.toContain("onClick");
    expect(block).not.toContain("<button");
    expect(block).not.toContain("href");
  });

  test("loading is never rendered as disconnected", () => {
    // A false "Not connected" invites reconnecting an already-connected account.
    expect(panel).toContain("Checking…");
    expect(panel).toContain("status === undefined");
  });

  test("the profile page mounts the tab", () => {
    expect(profilePage).toContain('id: "connections"');
    expect(profilePage).toContain("<ConnectionsPanel />");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd packages/core && npx vitest run src/connectionsSurface.test.ts
```

Expected: FAIL — `ENOENT` on `dashboard/profile/connections.ts`.

- [ ] **Step 3: Create the data module**

Create `apps/web/app/(app)/dashboard/profile/connections.ts`:

```ts
// The integrations that cannot connect yet, and WHY. A row that cannot say why is decoration —
// see docs/superpowers/specs/2026-08-02-connections-tab-design.md §3.1.
//
// Plain data: no JSX, no "use client", nothing else in the file. That is deliberate — it lets the
// completeness check in packages/core/src/connectionsSurface.test.ts match on `label:`/`blocker:`
// without colliding with anything, and it keeps this list readable as a list.

export type BlockedConnection = {
  readonly id: string;
  readonly label: string;
  readonly blocker: string;
};

export const BLOCKED: readonly BlockedConnection[] = [
  {
    id: "social",
    // ponytail: hardcoded fact as of 2026-08-02. Clears when the legal entity exists — that ONE
    // step unblocks LinkedIn MDP, Meta Business Verification and Google OAuth verification at once.
    label: "Social accounts",
    blocker:
      "Blocked on business-entity verification. LinkedIn, Meta and Google each require a registered legal entity as data controller before granting posting access.",
  },
  {
    id: "databases",
    // ponytail: clears when an encrypted secret store exists. Today the stored Google refresh token
    // is a plaintext string column; adding pasted API keys would multiply that risk class.
    label: "Databases & CRMs",
    blocker:
      "Blocked on encrypted credential storage. API keys and database URLs cannot be scoped or revoked per-integration the way an OAuth grant can.",
  },
  {
    id: "apps",
    // ponytail: clears only via a code-owned adapter. ADR-007 — a specialist's tool-set is never
    // DB-writable, so "install an app" can never mean "add a tool at runtime".
    label: "Third-party apps",
    blocker:
      "Capability is code-owned (ADR-007). Each integration ships as a reviewed adapter rather than something added at runtime.",
  },
];
```

- [ ] **Step 4: Create the panel**

Create `apps/web/app/(app)/dashboard/profile/ConnectionsPanel.tsx`:

```tsx
"use client";

import { api } from "@pikar/backend/api";
import { useQuery } from "convex/react";
import { DisconnectGoogle } from "../../_components/DisconnectGoogle";
import { BLOCKED } from "./connections";
import { card, label } from "./styles";

// The connections surface. Google is the only provider that can connect today, so it is written
// CONCRETELY — no Record<Provider, …> lookup and no ConnectionRow interface. Phase 25 mints that
// lookup in the same commit as the Microsoft Graph adapter (spec §3), not before.

const row: React.CSSProperties = {
  display: "flex",
  gap: "1rem",
  alignItems: "flex-start",
  justifyContent: "space-between",
  flexWrap: "wrap",
  border: "1px solid var(--rule)",
  borderRadius: "0.8rem",
  padding: "0.9rem 1rem",
  background: "var(--canvas)",
};

const pill: React.CSSProperties = {
  fontSize: "0.72rem",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--ink-soft)",
  border: "1px solid var(--rule)",
  borderRadius: "999px",
  padding: "0.2rem 0.6rem",
  whiteSpace: "nowrap",
};

export function ConnectionsPanel() {
  return (
    <section style={card} aria-label="Connections">
      <div style={{ display: "grid", gap: "0.35rem" }}>
        <span style={label}>Connections</span>
        <h2 style={{ margin: 0, color: "var(--ink)", fontSize: "1.2rem" }}>
          What Pikar is connected to
        </h2>
      </div>

      <GoogleRow />

      {BLOCKED.map((c) => (
        <div key={c.id} style={row}>
          <div style={{ display: "grid", gap: "0.2rem", maxWidth: "34rem" }}>
            <strong style={{ fontSize: "0.94rem", color: "var(--ink)" }}>{c.label}</strong>
            <span style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>{c.blocker}</span>
          </div>
          <span style={pill}>Not available</span>
        </div>
      ))}
    </section>
  );
}

function GoogleRow() {
  const status = useQuery(api.gmailAuth.gmailStatus);

  return (
    <div style={row}>
      <div style={{ display: "grid", gap: "0.2rem", maxWidth: "34rem" }}>
        <strong style={{ fontSize: "0.94rem", color: "var(--ink)" }}>Google — Gmail &amp; Calendar</strong>
        <span style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>
          {/* `undefined` = still loading. Rendering "Not connected" here would be a FALSE NEGATIVE
              inviting the user to reconnect an already-connected account — the flash-of-wrong-state
              class this codebase has been bitten by before (see the rail shell and DeadLetterBadge,
              both of which render nothing rather than guess). */}
          {status === undefined
            ? "Checking…"
            : !status.connected
              ? "Not connected"
              : status.expiresAt
                ? `Access token expires ${new Date(status.expiresAt).toLocaleString()}`
                : "Connected"}
        </span>
      </div>
      {status !== undefined &&
        (status.connected ? (
          <DisconnectGoogle />
        ) : (
          <a
            href="/connect-gmail"
            style={{
              padding: "0.45rem 0.9rem",
              borderRadius: "0.375rem",
              background: "var(--teal-600)",
              color: "#fff",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: "0.9rem",
              whiteSpace: "nowrap",
            }}
          >
            Connect
          </a>
        ))}
    </div>
  );
}
```

- [ ] **Step 5: Mount the tab**

In `apps/web/app/(app)/dashboard/profile/page.tsx`:

1. Add the import beside the other panel imports:

```tsx
import { ConnectionsPanel } from "./ConnectionsPanel";
```

2. Add a fourth entry to the `TABS` array (keep it last so existing `?tab=` links and arrow-key order are unchanged):

```tsx
const TABS = [
  { id: "shape", label: "Business shape" },
  { id: "business", label: "What the business is" },
  { id: "blueprint", label: "Blueprint" },
  { id: "connections", label: "Connections" },
] as const;
```

3. Add a fourth panel beside the existing three, following their exact shape:

```tsx
<div role="tabpanel" id="panel-connections" aria-labelledby="tab-connections" hidden={tab !== "connections"}>
  <ConnectionsPanel />
</div>
```

No other change is needed: `isTabId` validates against `TABS`, the arrow-key handler already loops modulo `TABS.length`, and `?tab=` is already written back to the URL.

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd packages/core && npx vitest run src/connectionsSurface.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 7: Typecheck**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Bump onboarding.md**

Add a new `> Last verified: 2026-08-02 (…)` block at the top of the run in `docs/playbooks/onboarding.md`, demoting the current top entry to `> Prior: …`. Content: the profile surface gained a fourth tab, `connections`; `ConnectionsPanel` reads `gmailAuth.gmailStatus` and renders the shared `DisconnectGoogle`; the three blocked rows are static data in `connections.ts` with their blockers stated; no profile field, writer, serializer or Convex function changed. Note that the existing `surfaceOf("profile")` scan in `businessProfile.test.ts` reads every `.tsx` in the route folder, so `ConnectionsPanel.tsx` falls inside it automatically — but `connections.ts` does **not** (that filter is `.tsx`-only), which is why the blocker-completeness check is its own test rather than an addition to that scan.

> Single-line anchors only — the file is CRLF.

- [ ] **Step 9: Commit**

```bash
git add "apps/web/app/(app)/dashboard/profile/connections.ts" "apps/web/app/(app)/dashboard/profile/ConnectionsPanel.tsx" "apps/web/app/(app)/dashboard/profile/page.tsx" packages/core/src/connectionsSurface.test.ts docs/playbooks/onboarding.md
git commit -m "feat(connections): a Connections tab that states what is blocked and why"
```

---

### Task 3: Point the rail at it

**Files:**
- Modify: `apps/web/app/(app)/layout.tsx` (footer item label + href, and the `isActive` query-string fix)

**Interfaces:**
- Consumes: the `/dashboard/profile?tab=connections` deep link produced by Task 2.
- Produces: nothing importable.

- [ ] **Step 1: Fix `isActive` so a query-string href can ever match**

`usePathname()` returns no query string, so `pathname.startsWith("/dashboard/profile?tab=connections")` is **always false** and the item's active state would be permanently dead. In `apps/web/app/(app)/layout.tsx`, replace the `isActive` declaration:

```tsx
  // Exact match for /dashboard (it prefixes everything); prefix match elsewhere so
  // e.g. /review/[id]-style child routes keep their parent item lit. A nav href may carry a
  // `?tab=` deep link, but `usePathname()` never does — so compare the path portion only,
  // otherwise such an item can never light up.
  const isActive = (href: string) => {
    const path = href.split("?")[0];
    return path === "/dashboard" ? pathname === path : pathname.startsWith(path);
  };
```

- [ ] **Step 2: Relabel and re-point the footer item**

In the same file, in the `.rail-foot` block, change the Gmail item's `href` and both its label strings:

```tsx
          <Link
            href="/dashboard/profile?tab=connections"
            className={`rail-item${isActive("/dashboard/profile?tab=connections") ? " is-active" : ""}`}
            title={collapsed ? "Connections" : undefined}
          >
            <MailIcon />
            <span className="rail-label">Connections</span>
          </Link>
```

> Leave the `MailIcon` import and every other rail item alone. `/connect-gmail` remains reachable from `ReconnectBanner.tsx`, `workspace/page.tsx` and `dashboard/page.tsx`, all unchanged.

- [ ] **Step 3: Typecheck**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Verify in the running app**

This step is a real browser check, not a test — the rail's active state and the tab's live Google row are exactly the things a source scan cannot prove.

With `pnpm dev` running (Next on `:3000`, Convex on `:3210` — start Convex with `CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=180`, the local sqlite is ~464 MB and exceeds the 30 s default):

1. Sign in and confirm the rail footer reads **"Connections"**, not "Connect Gmail".
2. Click it → lands on `/dashboard/profile?tab=connections` with the Connections tab selected **and the rail item highlighted** (this is what Step 1 fixes).
3. The Google row shows the real connection state. If connected, a **Disconnect Google** button is present; if not, a **Connect** link to `/connect-gmail`.
4. The three blocked rows each show a label, a blocker sentence and a "Not available" pill, and **none of them is clickable**.
5. Reload with `?tab=blueprint` and confirm the other tabs still work and arrow keys cycle through all four.
6. Visit `/connect-gmail` directly and confirm its Disconnect button still renders and still warns about calendar.

> Do **not** click Disconnect to test it unless you intend to reconnect — it revokes the real Google grant. Verify its presence and copy only.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(app)/layout.tsx"
git commit -m "feat(connections): rail points at the Connections tab, isActive handles ?tab="
```

> `layout.tsx` is watched by no playbook (verified against `watch.json`), so no §9 update is required for this task. If the Stop hook disagrees, it means `watch.json` changed — follow what it names.

---

## Self-Review

**Spec coverage:** §2 architecture → Tasks 1–3 (all five files). §2.1 tab pattern → Task 2 Step 5. §2.2 rail + the `isActive` companion fix → Task 3 Steps 1–2. §3 concrete row model → Task 2 Step 4 (no abstraction) and the Global Constraints. §3.1 blocker-stated rows + `ponytail:` comments → Task 2 Step 3, enforced by two tests. §4 shared disconnect → Task 1. §5 error handling (loading ≠ disconnected, `revoked: false`, thrown fetch) → Task 1 Step 3 and Task 2 Step 4, enforced by tests. §6 both checks → Task 2 Step 1. §7 rejected scope → Global Constraints. §8 definition of done → Task 3 Step 4 plus the playbook bumps in Tasks 1 and 2. §9/§10 are non-goals and need no task.

**Placeholder scan:** none — every code step carries the literal content.

**Type consistency:** `DisconnectGoogle` (no props) is defined in Task 1 and consumed in Task 2. `BLOCKED: readonly BlockedConnection[]` is defined in Task 2 Step 3 and consumed in Step 4. `gmailStatus` is used as `{ connected, expiresAt }` in both the panel and the test, matching the backend's actual return. The tab id string `"connections"` is identical in `TABS`, the panel `hidden` check, the `href`, and the test assertion.

**One gap accepted deliberately:** nothing enforces that the hardcoded blocker strings stay true as their blockers clear. The `ponytail:` comments name the clearing condition; the spec records this as an accepted ceiling rather than an oversight.
