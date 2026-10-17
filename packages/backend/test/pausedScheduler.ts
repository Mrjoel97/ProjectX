import { test, vi } from "vitest";

/** Scheduling-only assertions: callback execution is outside this test's scope.
 * Never use for tests advancing timers or starting scheduled work; those must join their work.
 * Keep Date real. Discard pending callbacks without running ingestion/provider jobs at teardown.
 */
export async function withPausedScheduler<T>(assertions: () => Promise<T>): Promise<T> {
  if (vi.isFakeTimers()) throw new Error("SCHEDULER_CLOCK_ALREADY_OWNED");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  try {
    return await assertions();
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
}
export const schedulingTest = (name: string, assertions: () => Promise<void>) =>
  test(name, () => withPausedScheduler(assertions));
