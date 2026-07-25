// Lane A's exclusive property after Wave 0. The governed sub-agent dispatcher (DISP-01):
// depth cap, cycle refusal, shared root-request envelope, refs-only lineage. It calls the ONE
// loop — there is no `generateText` in this file, ever.
//
// Wave 0 (15-01) ships this file EMPTY on purpose. It exists now so that:
//   1. `docs/playbooks/watch.json` can register the path in the freeze commit (the Stop hook
//      cannot protect a path it has never seen), and
//   2. `dispatchGuard.test.ts`'s no-nested-`generateText` scan is a REGRESSION guard from day
//      one rather than a test written after the mistake it is meant to catch.
// 15-02 / 15-03 fill it.
export {};
