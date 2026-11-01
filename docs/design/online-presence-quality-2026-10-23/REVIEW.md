# Generated page composition review · 23 October 2026

This review covers the closed public-page renderer, using the same fictional Fieldwork Studio brief and the same three prepared illustration assets before and after. It does not certify a real customer's business claims, hosted model quality, deployment, checkout, or permission to publish. The earlier `online-presence-quality.md` was preserved.

## Before and after

| Viewport | Before | After |
| --- | --- | --- |
| Desktop · 1440px | [Three directions](before-1440-contact-sheet.png) | [Three directions](after-1440-contact-sheet.png) |
| Tablet · 768px | [Three directions](before-768-contact-sheet.png) | [Three directions](after-768-contact-sheet.png) |
| Phone · 390px | [Three directions](before-390-contact-sheet.png) | [Three directions](after-390-contact-sheet.png) |

These contact sheets show the complete pages, scaled for comparison. The original, unscaled final screenshots are in `.tmp/web-design-20261023-final/`; each media test's folder contains `media-<direction>-<width>.png`. The final browser run, with the affected studio captures refreshed after round 3, also captured every supported page of the advisory, studio and technical business briefs and the campaign landing page at all three widths.

## Brief inventory and page argument

The fictional evidence contains the Fieldwork Studio name, independent-business audience, brand and digital design offer, brand-identity service, digital-experience service, business/customer-first about copy, a real supplied inquiry destination, and three paper/colour-print/booklet illustration studies. The same material is used in every direction; the design adds no new business claim.

| Section | What it says or shows | Evidence |
| --- | --- | --- |
| Lead | Design for independent businesses; start an inquiry | Supplied headline, summary and exact CTA |
| Services | Brand identity and digital experiences | The two supplied service statements |
| About | Business and customers inform the work | Supplied about statement |
| Gallery | Generated illustration studies | The three owned-format PNG fixtures and their provenance |
| Close | Business name and existing site destinations | Validated brand and navigation |

## Concrete changes

- Editorial gives the supplied image a full-width masthead beneath a title, supporting statement and action lead. The supplied illustration is dominant rather than squeezed into a narrow rail.
- Studio pairs the lead with a near-half-width image, sets services as substantial text rows, uses a single flat about field, and lets supplied gallery images read at a larger scale. Text-only briefs retain a wider headline column.
- Technical keeps a clear dark lead with a larger image, a compact service index and a distinct closing field. It does not invent system telemetry, credentials, code or performance claims.
- Images respect their validated aspect, crop and focal point. A positioned image inside the reserved aspect box prevents intrinsic image dimensions or a fixed minimum height from changing the requested crop. Phone images align with the page frame rather than inheriting the text rail's padding.
- The footer returns the real business name at a useful scale and reuses the existing site destinations. Primary navigation identifies the current page. No address, hours, legal assurance, product or contact destination is invented.

The renderer identity changes from `web-design-renderer-v4` to `web-design-renderer-v5`. Existing stored artifact bytes remain immutable; this code renders new versions. Recipe/compiler qualification changes are integrated separately by the parent task.

## Design guidance and constraints

Applied installed **design-taste-frontend** and **ui-ux-pro-max**, the repository brand reference and the online-presence playbook. Graphify was attempted first; its CLI was unavailable, so the review used scoped source reads and actual existing screenshots.

Taste draw: **The printed annual** (`editorial-report`), seed **1296522506**, agency sector, with palette and type kept. The direction's edited column system, dominant masthead, text comparison and flat fields informed the editorial composition. Its dealt full-viewport photo overlay, invented comparison columns, portrait, open-collection stock imagery, word tiles, crossfade and scroll scenes were not adopted: the existing engine has a closed validated AST, only the selected tenant-owned raster assets, no supplied portrait/comparison evidence, and a script-free immutable artifact contract. No extra business facts or image provenance were fabricated to fill those blueprints. No redraw was used to evade a failed inspection.

Idea sentence: **The business's own supplied visual material becomes the lead, while its actual services and about copy form an edited reading sequence.** The working visitor action is the real inquiry CTA and native page navigation. This is a reusable renderer, so its composition cannot establish an original concept for an otherwise unspecified customer; the agent must select an appropriate direction and supply supported business copy and owned imagery.

The verified UI/UX search was `responsive image crop --domain ux`, which returned image scaling, optimization and asset-weight guidance. This change enforces the supplied crop and prevents overflow; it does not add an image transformation service, additional image formats or generated responsive derivatives.

The three fixture PNGs are **generated illustration studies**, not photographs of a real business, its products or client work. The fixture's visible supporting copy and image alternatives identify them as generated studies. Existing asset provenance is recorded in the [media review](../online-presence-media.md). No new stock imagery or external fonts were fetched during this pass.

## Visual critique

ROUND 1 · before

Seen in one second: a large slogan and a small side image.

Idea: the illustration is secondary to a generic split layout.

Live thing: the real inquiry action and site links.

Layout words by section: hero=split / services=repeated panels / about=panel / gallery=two-up / footer=small line.

Scores: design 5.5 · usability 7.5 · creativity 5.5 · content 7 → overall 6.3.

Caps applied: fewer than four selected pictures; reusable composition cannot demonstrate a unique customer idea.

Top three problems:
1. Studio desktop: the image occupies only about a third of the lead and the fixed image minimum height changes the requested landscape crop. Enlarge the image and honor the explicit aspect.
2. Studio desktop and phone: the services and about sections repeat the same rounded-panel treatment. Replace repeated service cards with text composition and keep one deliberate tone field.
3. All directions: a tiny footer name follows a broad gap and gives no useful next step. Return the actual name and reuse actual navigation.

ROUND 2 · media and reflow review

Seen in one second: editorial shows the supplied visual work; studio balances type with the work; technical offers a concise dark lead and real action.

Idea: supplied visual material and supported business copy carry the page rather than decorative UI chrome.

Live thing: exact existing CTA route, with Primary → About → Footer Home links exercised in the browser.

Layout words by section: editorial=title lead / masthead / columns / statement field / two-up / typographic close; studio=balanced split / service rows / statement field / image sequence / dark close; technical=dark split / service index / light statement / two-up / dark close.

Scores: design 6.5 · usability 8 · creativity 6 · content 7 → overall 7.0.

Caps applied: the three supplied images are below Taste's four-picture floor; no scripted motion layer; this bounded shared renderer remains a known composition rather than a bespoke customer concept. This is below the skill's 7.5 target. The scores are a candid visual judgment, not a measured inspector score or a claim of award-level/full Taste compliance.

Top remaining limitations:
1. The fixture copy and generic gallery heading are intentionally limited; richer customer-specific source material and edited copy matter more than adding decorative sections.
2. Only existing owned images can be used. The renderer cannot truthfully complete a missing portrait, portfolio, product photo or fourth image.
3. Native pages preserve a script-free runtime. A custom interactive visual or scroll scene needs a separately designed and approved capability; this pass does not simulate one.

During the look-and-fix loop, browser checks caught a real phone selector-specificity error in text-only editorial pages, a narrowed plain-studio desktop headline, and phone image padding inherited from a text rail. All were fixed before the final capture; the heading/reflow oracle was retained.

ROUND 3 · final scoped service-rail review

The full-page contact sheets revealed that a service section promoted into a narrow studio hero rail inherited the main-content split. Words fragmented even though the layout did not overflow and heading line-count checks passed. The rail now keeps a readable single column, with 1.1rem service copy; the main-content layout stays unchanged. The browser regression measures every service paragraph in a rail above 200px wide for these fixtures. All three affected viewport cases passed after this fix. The scores and remaining limitations above are unchanged.

## Verification

| Check | Final result |
| --- | --- |
| Focused renderer unit tests | 10 passed |
| Core TypeScript check | Passed |
| Offline real-browser suite, installed Edge | Full suite 23 passed; after the final scoped service-rail fix, all 3 affected studio cases passed again (all four pages at each width) |
| Taste static source lint | 1 file, zero findings |
| Native Taste inspector | Unavailable: Chrome CDP `Page.enable` timeout; Edge retry exited early with code 0 |

The browser suite checks real PNG decoding, alt text, exact local asset routes and no unexpected requests; preserved 1.6 aspect ratios and focal position; dominant desktop image width; no horizontal overflow; headline line boxes on all content pages; body text at least 16px; controls and navigation at least 44px high; explicit unchecked consent; light-brand contrast at least 4.5:1; keyboard focus; complete long Swahili text; and actual cross-page navigation with the current page readback. The source artifact contains no scripts or frames. The media tests wait for decoding and two animation frames before capture.

Logs: `.tmp/design-20261023-browser-final.log`, `.tmp/design-20261023-browser-studio-final.log`, `.tmp/design-20261023-core-rail.log`, `.tmp/design-20261023-tsc-final.log`, `.tmp/design-20261023-taste-lint.log`, and the two inspector attempt logs. Browser fallback measurements and screenshot review were used because the skill's own inspector could not start successfully. No deployment, provider call, live publication, approval grant or checkout activation was performed.
