import { expect, test } from "vitest";
import { buildZernioNarrative, type ZernioNarrativeReport } from "./zernioNarrative";

const now = Date.UTC(2026, 9, 29);
function fixture(): ZernioNarrativeReport {
  return {
    fromDate: "2026-10-01",
    toDate: "2026-10-27",
    fetchedAt: now - 1000,
    accounts: [
      {
        accountId: "account-a",
        platform: "tiktok",
        posts: [
          { postId: "zero", source: "external", metrics: { views: 0, likes: 0 }, updatedAt: null },
          {
            postId: "best",
            source: "external",
            metrics: { views: 12, comments: 2 },
            updatedAt: "2026-10-27T15:00:00Z",
          },
        ],
      },
    ],
  };
}
test("uses supported lifetime metrics with missing values distinct from zero", () => {
  const text = buildZernioNarrative(fixture(), now).join("\n");
  expect(text).toContain(
    "post best (views: 12; likes: unavailable; comments: 2; shares: unavailable)",
  );
  expect(text).toContain("lifetime metrics");
  expect(text).toContain("not when the social platform last updated");
  expect(text).toContain("whether Buffer published");
  const report = fixture();
  report.accounts[0]!.posts.splice(1);
  expect(buildZernioNarrative(report, now).join("\n")).toContain("views: 0; likes: 0");
});
test("bounded strongest example never claims whole-account ranking", () => {
  const report = fixture();
  report.accounts[0]!.posts = Array.from({ length: 21 }, (_, i) => ({
    postId: `p${i}`,
    source: "external",
    metrics: { views: i },
    updatedAt: null,
  }));
  const text = buildZernioNarrative(report, now).join("\n");
  expect(text).toContain("21 posts");
  expect(text).toContain("20 sampled posts");
  expect(text).toContain("post p19");
  expect(text).not.toContain("post p20");
  report.accounts[0]!.posts = report.accounts[0]!.posts.slice(0, 20);
  report.accounts[0]!.postCount = 137;
  report.accounts[0]!.sampled = true;
  expect(buildZernioNarrative(report, now).join("\n")).toContain("137 posts");
});
test("old cached evidence and absent views are explicit without fabricated trends", () => {
  const report = fixture();
  report.fetchedAt = now - 2 * 86400000;
  report.accounts[0]!.posts.forEach((post) => {
    post.metrics = { likes: 3 };
  });
  const text = buildZernioNarrative(report, now).join("\n");
  expect(text).toContain("cached snapshot is old");
  expect(text).toContain("cannot be identified");
  expect(text).toContain("cannot establish growth");
});
