/** Conversation selection drops an exact artifact pin and keeps reload on the selected chat. */
export function conversationUrl(href: string, threadId?: string): URL {
  const url = new URL(href);
  url.searchParams.delete("plan");
  url.searchParams.delete("label");
  if (threadId) url.searchParams.set("thread", threadId);
  else url.searchParams.delete("thread");
  return url;
}

export function workspaceView(params: URLSearchParams): "work" | "canvas" {
  return params.has("plan") || params.get("view") === "canvas" ? "canvas" : "work";
}

export function workspaceViewUrl(href: string, view: "work" | "canvas"): URL {
  const url = new URL(href);
  url.searchParams.set("view", view);
  if (view === "work") url.searchParams.delete("plan");
  return url;
}
