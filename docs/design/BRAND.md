# Pikar AI — Brand & UI Reference

**This is the single committed source of truth for how Pikar AI looks and sounds.** Every
session (all parallel lanes, all future work) reads this instead of relying on chat context —
screenshots and verbal direction shared in a chat do NOT reach other sessions; committed files do.

Two authoritative sources back this doc:
1. **`apps/web/app/globals.css`** — the live design tokens (colors, type scale). Code always wins
   over prose here; if a value differs, `globals.css` is correct and this doc should be updated.
2. **`docs/design/brand/brand-*.png`** — 14 real product screenshots (deduped). Open the relevant
   one when building UI; they are the visual ground truth for spacing, hierarchy, and component look.

---

## 1. What Pikar AI is (identity + voice)

Pikar AI is an **AI chief-of-staff / Executive Assistant & Orchestrator** for solopreneurs and small
businesses. The orchestrator ("Pikar AI") delegates to named specialist agents (ExecutiveAgent /
"Atlas", GraphicDesignerAgent, etc.). The product's feeling is **calm executive control**: it tells
you the next high-leverage move, does the work with your approval, and keeps an auditable trail.

**Voice & tone (content):**
- **Executive and outcome-first.** Headlines are imperatives about business results:
  "Run the next revenue move", "Finish the active workflow", "Recommended next move".
- **Concise, confident, plain.** Short sentences. No hype, no filler. "Your home is tuned for quick
  execution, cash awareness, and fewer loose ends."
- **Honest about limits.** The cockpit always shows: "Pikar AI can make mistakes. Consider checking
  important information." Never claim a send/action happened that didn't.
- **Second person, present tense.** Speak to "you"/"Executive". Greeting: "Good morning, Executive."

---

## 2. Color system

Tokens live in `globals.css` — use the CSS variables, never hardcode hex. Two coexisting palettes:

**Teal cockpit palette (primary brand):**
| Token | Hex | Use |
|-------|-----|-----|
| `--teal-900` | `#0b4f4a` | Left nav rail / dark frame; user chat bubble fill |
| `--teal-600` | `#009689` | Primary action: Send, active tab, Approve, CTAs, active nav item |
| `--teal-400` | `#40cad0` | Highlight / logo glow / accents |
| `--canvas` | `#f8fafc` | App canvas behind cards |
| `--card` | `#ffffff` | Cards, chat bubbles (agent), panels |

**"Custody & clearance" governance palette (status semantics):**
| Token | Hex | Use |
|-------|-----|-----|
| `--ink` / `--ink-soft` | `#0e1419` / `#55606c` | Primary / secondary text |
| `--held` / `--held-text` | `#f0a22e` / `#8f5406` | The approval gate ONLY — amber = "held, awaiting release". Spend amber in exactly one place. |
| `--released` | `#3e9e75` | Delivered / cleared / success |
| `--rule` | `#d8dbe0` | Hairlines, borders |

**Accents seen in-product (for richer surfaces):**
- **Gradient banners** — teal→cyan→blue horizontal gradient for the "Need help? Ask AI" help banner
  (white pill button with teal text sits on it).
- **Icon badges** — small rounded-square tiles with a solid/gradient fill (teal, cyan, green) holding
  a line icon, used on stat cards and section headers.
- **Dark CTA** — a near-black navy button (`--ink`-ish) for high-emphasis actions ("Open focus area →",
  "Clear workspace"). Teal is the *default* primary; dark navy is the *heavy* CTA.

---

## 3. Typography

- **Display headlines:** large, bold, tight-tracking sans (e.g. "Run the next revenue move"), in
  `--ink`. This is the loudest element on a page — one per view.
- **Section labels:** UPPERCASE, letter-spaced, small, muted teal/`--ink-soft` (e.g.
  `SOLOPRENEUR • FRIDAY, MAY 8`, `AGENT WORKSPACE`, `RECOMMENDED NEXT MOVE`, `LATEST TRACE`). This
  tracked-caps label is a signature pattern — use it to title sections and cards.
- **Body:** regular weight, `--ink-soft`, comfortable line-height.
- **Big stat values:** very large bold numerals (`$0`, `0`, `2 / 5`) paired with a small caps label.
- Type scale is fluid via the `--step` clamp in `globals.css`.

---

## 4. Layout & structure

- **App shell:** a **dark teal (`--teal-900`) left nav rail** + a **light (`--canvas`) content area**.
  The rail has the brain-logo wordmark ("Pikar AI"), a vertical nav (Command Center, Approvals,
  Finance, Content, Sales Pipeline, Compliance, My Workspace, Reports, Knowledge Vault, Join
  Community), and Collapse / Sign Out at the bottom. The rail **collapses to an icon-only strip**.
- **Cockpit (`/dashboard/workspace`):** a **two-pane** layout — a chat pane (left) and a live
  "Agent Workspace / Live work canvas" (right) where agent outputs render. Panes are resizable.
- **Cards everywhere:** white, generously rounded corners (~16–20px), soft diffuse shadow, ample
  padding. Content is composed of cards on the canvas, never dense tables-on-white.
- **Generous whitespace.** Airy, uncramped; large touch targets; clear one-headline-per-view hierarchy.

---

## 5. Component patterns (from the screenshots)

- **Nav rail item:** icon + label; active item gets a `--teal-600` fill/pill and white text.
- **Stat tile:** icon badge + UPPERCASE label + big bold value (Revenue this month `$0`, Tools
  configured `1 / 5`, Scheduled jobs "Ready to deploy").
- **Chat bubbles:** user = **`--teal-900` fill, white text, right-aligned**, with a hover "Copy";
  agent = **white card, `--ink` text, left-aligned**, with thumbs up/down feedback and an optional
  collapsible **"Thought Process"** trace ("Delegating to ExecutiveAgent").
- **Composer:** rounded input "Type your message…", a model selector pill ("⚡ Auto ▾"), and icon
  buttons (model/brain, attach 📎, mic 🎤) with a **`--teal-600` circular Send** button.
- **Output card:** titled card ("Generated image") with an UPPERCASE type badge pill ("IMAGE"),
  a "Synced to workspace history" subline, and the rendered artifact.
- **Help/upsell banner:** full-width gradient (teal→blue) with a white pill CTA ("Ask AI for Help").
- **Status pills:** small dark pill ("Loading") top-right; type/label pills use uppercase small caps.
- **Empty states:** honest zeros (`$0`, `0`) rather than fake data.
- **Executive report card** (the inbox briefing, `cards.tsx` `BriefingCard`; approved direction 2026-07-17): when a card summarizes many items, shape it as a *standing brief*, not a list. A dark **teal-900 masthead band** (white text — high contrast by construction) carries the scope + a short row of code-owned **KPI counts** (BRAND §5 stat tile), then a one-line summary (lede), then a **priority "needs you" hero block** (each row may carry a *recommended next move* that routes back to chat), then the rest demoted to a **quiet ledger** grouped by a secondary axis, then a footer. This refines "never dense tables-on-white" (§4): *structured reports* — aligned columns, ruled sections, card-native whitespace, no gridlines — are the intended pattern; cramped spreadsheets are not. Priority is a neutral stripe + weight, **never amber** (§2 — `--held` is the approval gate's alone). Keep it read-only where the card must not act (the briefing's SC-4: zero button/link/onClick).

---

## 6. Accessibility (non-negotiable — from `globals.css` notes)

- **`--teal-600` on white is ~2.9:1** — use it for **button fills / white-text CTAs, NOT small teal
  body text**. For teal text on light, darken it.
- **Amber (`--held`) is ~1.9:1 on light paper** — fails WCAG for text. Use `--held-text` (~4.6:1)
  for amber text on paper; keep `--held` for marks on the dark `--glass`/teal surfaces only.
- Maintain visible focus states, keyboard operability (the cockpit split handle is a real
  `role="separator"` with arrow-key nudge), and don't encode meaning in color alone.

---

## 7. Screenshot index (`docs/design/brand/`)

Open the file to see the real thing. Viewed & described above: Command Center dashboard
(`brand-024016`), cockpit greeting (`brand-024113`), cockpit active chat + Live work canvas
(`brand-024149`), Configuration/integrations (`brand-024509`), generated-image output card
(`brand-024840`). Additional captured states (other nav sections / flows) —
`brand-024242`, `brand-024258`, `brand-024322`, `brand-024351`, `brand-024419`, `brand-024606`,
`brand-024652`, `brand-024800`, `brand-025101` — open as needed when building the matching screen.

---

## 8. For agents building UI

1. Use `globals.css` CSS variables; never hardcode a hex that a token covers.
2. Match the screenshots for layout, hierarchy, and component look before inventing new patterns.
3. Reuse the existing hand-rolled components/idioms (the app deliberately has **no component
   library** yet — see the `globals.css` header note; don't add one without asking).
4. Keep the voice from §1 in all UI copy.
5. Honor §6 accessibility rules — they are requirements, not suggestions.
