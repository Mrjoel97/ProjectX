import { expect, test } from "@playwright/test";

// INTK-02/03 UI E2E (04-VALIDATION.md Wave-3 row) — drives IntakeControls' attach + dictate
// flows over the OFFLINE `SMOKE::` sentinels (mirrors cockpit-attachment.spec.ts): a tiny blob
// whose bytes ARE `SMOKE::extract::<text>` / `SMOKE::transcribe::<text>` short-circuits
// intake.ts's extraction model call with ZERO real API cost while the REAL classify -> redact
// -> cost -> audit -> merge spine (into the SAME governed api.cockpit.sendCockpitMessage path
// cockpit-attachment/-resolve/-report already exercise) stays fully in the loop.
//
// IntakeControls.tsx ships fully self-contained (this plan), but its ONE-LINE mount into
// ChatPane.tsx's composer — `<IntakeControls threadId={threadId} />`, rendered once threadId is
// truthy — is Lane A's responsibility (cross-lane note, 04-05-SUMMARY.md / PARALLELIZATION.md
// cross-lane note #1). Until that mount lands this spec is Playwright-discovered + type-loads
// only; the LIVE run unblocks once the mount is in place (Plan 06, per prior-phase precedent —
// cockpit-resolve/cockpit-report/cockpit-attachment all shipped their specs the same way ahead
// of their live runs).
//
// Selectors target IntakeControls' own test ids: "attach-file-input" (the real file input —
// hidden behind the composer's paperclip button; setInputFiles drives hidden file inputs
// directly) and "dictation-test-input" (a hidden headless-safe seam — a real mic can't be granted
// in a headless Playwright run, so dictation is driven the same way MediaRecorder's own onstop
// handler would: upload the blob -> intake.dictateToThread).

function smokeBlob(prefix: string, text: string): Buffer {
  return Buffer.from(`${prefix}${text}`, "utf-8");
}

test("attach a file -> classified content appears in the conversation (INTK-02)", async ({
  page,
}) => {
  await page.goto("/dashboard/workspace");

  const composer = page.getByPlaceholder("What business outcome should we work on?");
  await expect(composer).toBeVisible({ timeout: 15_000 });

  // Mint the thread first — IntakeControls needs a threadId (same lift ChatPane already does;
  // Lane A mounts IntakeControls only once threadId is truthy).
  const say = async (text: string) => {
    await composer.fill(text);
    await composer.press("Enter");
    await expect(composer).toHaveValue("", { timeout: 20_000 });
  };
  await say("SMOKE::agent::add=alice@example.com");

  const chat = page.getByTestId("chat-pane");

  const attachInput = page.getByTestId("attach-file-input");
  await attachInput.setInputFiles({
    name: "note.txt",
    mimeType: "text/plain",
    buffer: smokeBlob("SMOKE::extract::", "Please review the attached budget for Q3."),
  });

  // The extracted, redacted safeText merges into the SAME thread as a new turn — the framed
  // attachment content becomes visible in the conversation (attachToThread -> sendCockpitMessage).
  await expect(chat.getByText(/Please review the attached budget for Q3\./)).toBeVisible({
    timeout: 20_000,
  });
});

test("dictate -> transcript enters as a request turn (INTK-03, one-shot)", async ({ page }) => {
  await page.goto("/dashboard/workspace");

  const composer = page.getByPlaceholder("What business outcome should we work on?");
  await expect(composer).toBeVisible({ timeout: 15_000 });
  const say = async (text: string) => {
    await composer.fill(text);
    await composer.press("Enter");
    await expect(composer).toHaveValue("", { timeout: 20_000 });
  };
  await say("SMOKE::agent::add=bob@example.com");

  const chat = page.getByTestId("chat-pane");

  // Headless-safe dictation seam (no real mic) — same upload -> dictateToThread path a real
  // record/stop takes; the transcript merges VERBATIM (frameForConversation's dictation branch,
  // never wrapped like an attachment).
  const dictationInput = page.getByTestId("dictation-test-input");
  await dictationInput.setInputFiles({
    name: "dictation.webm",
    mimeType: "audio/webm",
    buffer: smokeBlob("SMOKE::transcribe::", "send an email to bob@example.com about lunch"),
  });

  await expect(chat.getByText(/send an email to bob@example\.com about lunch/)).toBeVisible({
    timeout: 20_000,
  });
});
