// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { WEB_CAROUSEL_SCRIPT } from "@pikar/core/webCarouselRuntime";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });
function mount(reduced = false) {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: reduced, addEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  document.body.innerHTML = '<section class="gallery-carousel"><div class="gallery-viewport" tabindex="0"><ul class="gallery-track" style="gap:24px">' + [1,2,3].map(n => `<li id="slide-${n}"><img id="image-${n}" alt="Study ${n}"></li>`).join("") + '</ul></div><button data-gallery-previous>Previous</button><button data-gallery-next>Next</button></section>';
  for (const slide of document.querySelectorAll("li")) slide.getBoundingClientRect = () => ({ width: 100 } as DOMRect);
  window.eval(WEB_CAROUSEL_SCRIPT);
  return {
    region: document.querySelector("section")!,
    viewport: document.querySelector<HTMLElement>(".gallery-viewport")!,
    track: document.querySelector<HTMLElement>("ul")!,
    previous: document.querySelector<HTMLButtonElement>("[data-gallery-previous]")!,
    next: document.querySelector<HTMLButtonElement>("[data-gallery-next]")!,
  };
}
test("autoplays smoothly, wraps, and has two manual arrows with inaccessible clones", () => {
  const c = mount();
  expect(c.region.querySelectorAll("button")).toHaveLength(2);
  expect(c.track.children).toHaveLength(6);
  expect(c.track.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  expect(c.track.querySelectorAll("[id]")).toHaveLength(6);
  vi.advanceTimersByTime(4200);
  expect(c.track.style.transform).toBe("translateX(-124px)");
  expect(c.track.style.transition).toContain("750ms");
  vi.advanceTimersByTime(850);
  c.previous.click(); vi.advanceTimersByTime(850);
  expect(c.track.style.transform).toBe("translateX(0px)");
  c.previous.click(); vi.advanceTimersByTime(850);
  expect(c.track.style.transform).toBe("translateX(-248px)");
  c.next.click(); vi.advanceTimersByTime(850);
  expect(c.track.style.transform).toBe("translateX(0px)");
});
test("hover and focus pause motion, and reduced motion disables autoplay and transitions", () => {
  const c = mount();
  c.region.dispatchEvent(new Event("pointerenter"));
  vi.advanceTimersByTime(9000); expect(c.track.style.transform).toBe("translateX(0px)");
  c.region.dispatchEvent(new Event("pointerleave"));
  c.viewport.focus();
  vi.advanceTimersByTime(9000); expect(c.track.style.transform).toBe("translateX(0px)");
  vi.clearAllTimers();
  const r = mount(true);
  vi.advanceTimersByTime(9000); expect(r.track.style.transform).toBe("translateX(0px)");
  r.next.click(); expect(r.track.style.transform).toBe("translateX(-124px)");
  expect(r.track.style.transition).toBe("none");
});
