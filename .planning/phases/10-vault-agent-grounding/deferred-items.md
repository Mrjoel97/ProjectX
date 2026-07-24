
## 10-04: pre-existing skills.test.ts failure in llm.ts (out of scope)

- **Found during:** Plan 10-04 Task 1 (running `pnpm --filter @pikar/backend vitest run skills`)
- **Failure:** `no long inline prompt string literals live in convex/ source` — offender `convex/llm.ts: 256-char inline string` (the `<vault_context …>` fence template literal at llm.ts:1363-1365, MAX_INLINE_STRING=200).
- **Origin:** introduced by Plan 10-02's `searchVault` tool; that plan's verification ran `cockpitTools vaultGround` + `llmRedaction` but not `skills`, so the guard slipped through.
- **Why deferred:** `convex/llm.ts` is outside Plan 10-04's declared file ownership (and not 10-03's either); 10-04 runs concurrently with 10-03. The cockpit-agent drift test — the check relevant to this plan — is green.
- **Fix (for the owner of llm.ts):** split the fence literal (and the two-line no-match nudge if it also trips) across concatenated `+` fragments under 200 chars each, exactly as the `.md` seed-literal §5 rule already does. One-line diff, no behavior change.
