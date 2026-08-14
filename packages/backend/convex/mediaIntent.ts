/**
 * Code-owned routing for an explicit request to CREATE a video deliverable.
 *
 * Keep this deliberately narrow. A discussion about video strategy, performance, editing, or an
 * existing video still belongs in the normal agent loop. Only an imperative/want construction
 * aimed at a video, reel, or short is strong enough to bypass model tool selection.
 */
export function isExplicitVideoCreationRequest(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized === "") return false;
  // Mixed requests belong in the normal agent loop so an email/attachment instruction is never
  // discarded by the direct media route.
  if (/\b(?:email|e-mail|attach|forward|reply|recipient)\b/.test(normalized)) return false;

  const deliverable = String.raw`(?:video|video clip|short-form video|reel|instagram reel|youtube short|tiktok)`;
  const createVerb = String.raw`(?:create|generate|make|produce|build|render)`;

  return (
    new RegExp(String.raw`\b${createVerb}\b.{0,48}\b${deliverable}\b`, "i").test(normalized) ||
    new RegExp(
      String.raw`\b(?:i want|i need|i would like|i'd like)\b.{0,48}\b${deliverable}\b`,
      "i",
    ).test(normalized) ||
    new RegExp(String.raw`\bturn\b.{1,64}\binto (?:a |an )?${deliverable}\b`, "i").test(normalized)
  );
}
