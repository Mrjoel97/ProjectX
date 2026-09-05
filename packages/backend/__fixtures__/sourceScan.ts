/**
 * Source-text stripping for the NEGATIVE scans that hold laws no type can express: "this module
 * never inserts a user", "only `billingApi.ts` names Stripe's origin", "money history is never
 * patched". Comments have to go first, because a mention in prose is indistinguishable from a use
 * to `includes`.
 *
 * IT LIVES IN ONE PLACE BECAUSE IT HAS BEEN WRONG TWICE, IN TWO DIFFERENT WAYS, AND EACH REPAIR
 * REACHED ONLY THE COPIES ITS AUTHOR HAPPENED TO BE LOOKING AT. That is the actual defect; the
 * regex is only where it showed up.
 *
 * 1. The original dropped every `*`-leading line FIRST, which ate the closing marker of every
 *    JSDoc block and left the opening to swallow real code up to the next surviving marker.
 *    Measured on `billingRollup.ts`: 380 lines of code down to 12. Repaired in 28.1-07 — in two
 *    of the three files that ran it. `billingWebhook.test.ts` kept the original verbatim until
 *    28.1-11 #10, where it left 203 of 556 non-blank lines and not one of the module's exports.
 * 2. The single-alternation replacement had no string-literal awareness, so the `//` in any
 *    `https://` opened the line-comment arm and deleted the rest of the line. `config.ts` reduced
 *    to `export const STRIPE_API_BASE = "https:`, and the two scans hunting a hardcoded Stripe
 *    URL could not see the URL form of the thing they forbid (28.1-11 #12).
 *
 * STRING LITERALS COME FIRST in the alternation, so a string is consumed before a comment can open
 * inside it. After that it is left to right: whichever comment opens first consumes the other, so a
 * `/*` inside a `//` line cannot open a block and a `//` inside a block is inert.
 *
 * NOT A PARSER, and it must not be treated as one: it cannot see a comment inside a template
 * literal's `${}`, and a regex literal containing a quote will confuse it. It is good enough for
 * scanning our own source. A negative scan built on it is only as honest as the positive tripwires
 * beside it — pair every one with `nonBlankLines` against the raw text, because a blanked file
 * passes every `not.toMatch` ever written.
 *
 * ponytail: a regex, not a TS parser. The upgrade path the day this is not enough is
 * `typescript`'s own `createSourceFile` + `getFullText`, already an install-time dependency.
 */
const TOKENS =
  /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\/\*[\s\S]*?\*\/|\/\/.*/g;

export const codeOf = (content: string): string =>
  content.replace(TOKENS, (_match, literal) => literal ?? "");

/** The measure a negative scan is worthless without: a stripper that ate the file passes silently. */
export const nonBlankLines = (text: string): number =>
  text.split("\n").filter((line) => line.trim() !== "").length;
