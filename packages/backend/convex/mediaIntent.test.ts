import { describe, expect, test } from "vitest";
import { isExplicitVideoCreationRequest } from "./mediaIntent";

describe("explicit video creation routing", () => {
  test.each([
    "Create a short-form video for our launch",
    "Generate an Instagram reel about the new offer",
    "I need a video clip for tomorrow's campaign",
    "Turn this product brief into a YouTube Short",
    "Please make me a TikTok for the summer sale",
  ])("routes an explicit deliverable request: %s", (text) => {
    expect(isExplicitVideoCreationRequest(text)).toBe(true);
  });

  test.each([
    "Give me a video marketing strategy",
    "What makes a good Instagram reel?",
    "Review the performance of our existing video",
    "Write a blog post about video production",
    "Create an image for our launch",
    "Create a launch video and email it to the client",
  ])("leaves non-generation work in the normal agent loop: %s", (text) => {
    expect(isExplicitVideoCreationRequest(text)).toBe(false);
  });
});
