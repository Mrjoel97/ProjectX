// @vitest-environment node
import { expect, test, vi } from "vitest";
import { runSpecialistTurn } from "./llm";
import { run } from "./onlinePresenceRun";

vi.mock("./llm", () => ({ runSpecialistTurn: vi.fn() }));

test.each([
  false,
  true,
])("an unbuilt saved brief never presents an older artifact as the current result: previous=%s", async (previousArtifact) => {
  const after = {
    threadId: "thread",
    latestUserMessage: "Revise my website",
    revision: 3,
    briefBuilt: false,
    assessment: { ok: true },
    artifact: previousArtifact ? { version: 1 } : null,
  };
  const ctx = {
    storage: {},
    runQuery: vi.fn().mockResolvedValue(after),
    runMutation: vi.fn().mockResolvedValue({ ok: true }),
  };
  vi.mocked(runSpecialistTurn).mockResolvedValueOnce({
    reply: "Your revised site is ready; the image source is unavailable.",
    costUsd: 0,
    truncated: false,
  } as never);
  const result = await (
    run as unknown as {
      _handler(ctx: unknown, args: unknown): Promise<{ reply: string; outcome: string }>;
    }
  )._handler(ctx, {
    tenantId: "tenant",
    planId: "plan",
    threadId: "thread",
    text: "Revise my website",
  });
  expect(result.outcome).toBe("ready_to_build");
  expect(result.reply).toContain("has not been built yet");
  expect(result.reply).not.toContain("image source is unavailable");
  if (previousArtifact)
    expect(result.reply).toContain("version 1; it does not include these saved changes");
  expect(ctx.runMutation).toHaveBeenCalledTimes(1); // Pre-call only; no implicit build.
});

test("an exact current built receipt retains the review handoff", async () => {
  const after = {
    threadId: "thread",
    latestUserMessage: "Build",
    revision: 4,
    briefBuilt: true,
    assessment: { ok: true },
    artifact: { version: 2, projectUrl: "/dashboard/sites?project=owned-project" },
  };
  const ctx = {
    storage: {},
    runQuery: vi.fn().mockResolvedValue(after),
    runMutation: vi.fn().mockResolvedValue({ ok: true }),
  };
  vi.mocked(runSpecialistTurn).mockResolvedValueOnce({
    reply: "Review your site at https://yourprojectlink/dashboard/sites?project=wrong-project",
    costUsd: 0,
    truncated: false,
  } as never);
  const result = await (
    run as unknown as {
      _handler(ctx: unknown, args: unknown): Promise<{ reply: string; outcome: string }>;
    }
  )._handler(ctx, { tenantId: "tenant", planId: "plan", threadId: "thread", text: "Build" });
  expect(result.outcome).toBe("awaiting_review");
  expect(result.reply).toContain("/dashboard/sites?project=owned-project&version=2");
  expect(result.reply).not.toContain("yourprojectlink");
  expect(result.reply).not.toContain("wrong-project");
  expect(result.reply).not.toContain("is published");
});
