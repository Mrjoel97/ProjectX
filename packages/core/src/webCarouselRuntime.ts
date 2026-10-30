import { sha256Bytes } from "./webRuntime";

/** Immutable, code-owned runtime. Never interpolate customer or provider text. */
export const WEB_CAROUSEL_SCRIPT =`(() => {
  const viewport = document.querySelector('.gallery-viewport');
  const track = document.querySelector('.gallery-track');
  const previous = document.querySelector('[data-gallery-previous]');
  const next = document.querySelector('[data-gallery-next]');
  if (!viewport || !track || !previous || !next) return;
  const slides = Array.from(track.children);
  const count = slides.length;
  if (count < 3 || count > 6) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0, moving = false, hovered = false, focused = false, paused = false;
  let timer, settling;
  for (const slide of slides) {
    const clone = slide.cloneNode(true);
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    clone.inert = true;
    clone.querySelectorAll('img').forEach(image => { image.loading = 'eager'; });
    clone.setAttribute('aria-hidden', 'true');
    track.append(clone);
  }
  const stride = () => slides[0].getBoundingClientRect().width + parseFloat(getComputedStyle(track).gap);
  const place = (animate) => {
    track.style.transition = animate && !reduced.matches ? 'transform 750ms cubic-bezier(.22,.61,.36,1)' : 'none';
    track.style.transform = \`translateX(\${-index * stride()}px)\`;
  };
  const finish = () => {
    clearTimeout(settling);
    if (index >= count) { index = 0; place(false); }
    moving = false;
  };
  const move = (direction) => {
    if (moving) return;
    moving = true;
    if (direction < 0 && index === 0) {
      index = count;
      place(false);
      // Commit the equivalent cloned position before the animated step back.
      track.getBoundingClientRect();
    }
    index += direction;
    place(true);
    settling = setTimeout(finish, reduced.matches ? 0 : 800);
  };
  const schedule = () => {
    clearInterval(timer);
    if (!reduced.matches && !hovered && !focused && !paused && !document.hidden)
      timer = setInterval(() => move(1), 4200);
  };
  previous.addEventListener('click', () => { move(-1); schedule(); });
  next.addEventListener('click', () => { move(1); schedule(); });
  const region = viewport.closest('.gallery-carousel');
  region.addEventListener('pointerenter', () => { hovered = true; schedule(); });
  region.addEventListener('pointerleave', () => { hovered = false; schedule(); });
  region.addEventListener('focusin', () => { focused = true; schedule(); });
  region.addEventListener('focusout', event => {
    focused = region.contains(event.relatedTarget); schedule();
  });
  viewport.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1);
    } else if (event.key === ' ') {
      event.preventDefault(); paused = !paused; schedule();
    }
  });
  let touchX;
  viewport.addEventListener('touchstart', event => { touchX = event.touches[0]?.clientX; }, { passive: true });
  viewport.addEventListener('touchend', event => {
    const end = event.changedTouches[0]?.clientX;
    if (touchX !== undefined && end !== undefined && Math.abs(end - touchX) > 35) move(end < touchX ? 1 : -1);
    touchX = undefined;
  }, { passive: true });
  track.addEventListener('transitionend', event => { if (event.target === track && event.propertyName === 'transform') finish(); });
  new ResizeObserver(() => { finish(); place(false); }).observe(viewport);
  reduced.addEventListener('change', () => { finish(); place(false); schedule(); });
  document.addEventListener('visibilitychange', schedule);
  region.classList.add('is-ready');
  region.dataset.carouselRuntime = 'v1';
  place(false);
  schedule();
})();
`;
export const WEB_CAROUSEL_TAG = '<script data-pikar-carousel="v1">' + WEB_CAROUSEL_SCRIPT + '</script>';
const hex = sha256Bytes(new TextEncoder().encode(WEB_CAROUSEL_SCRIPT));
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64Hash(hex: string): string {
  const bytes = hex.match(/../g)!.map(byte => parseInt(byte, 16));
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const value = (bytes[i]! << 16) | ((bytes[i+1] ?? 0) << 8) | (bytes[i+2] ?? 0);
    output += alphabet[(value >>> 18) & 63]! + alphabet[(value >>> 12) & 63]! + (i+1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=') + (i+2 < bytes.length ? alphabet[value & 63] : '=');
  }
  return output;
}
export const WEB_CAROUSEL_SCRIPT_POLICY = "script-src 'sha256-" + base64Hash(hex) + "'";
/** Only one exact trusted tag can be exempted; duplicate or modified scripts remain rejected. */
export function hasUnsafeWebMarkup(html: string): boolean {
  const stripped = html.replace(WEB_CAROUSEL_TAG, '');
  return /<(?:script|iframe|object|embed|base)\b|\son[a-z]+\s*=|http-equiv\s*=/i.test(stripped);
}
