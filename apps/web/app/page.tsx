import type { Metadata } from "next";
import { CONTACT, SITE } from "./legal";

export const metadata: Metadata = {
  title: "Pikar AI — nothing sends without your approval",
  description:
    "Speak or type a goal. Pikar AI plans it, runs it under cost and privacy guardrails, holds it for your approval, then delivers — and writes every step to a log it cannot edit.",
  alternates: { canonical: SITE },
};

// JSON-LD. Static, developer-controlled data — no user input is interpolated.
// `aggregateRating` is deliberately absent: Pikar AI has no genuine ratings yet, and
// fabricating them violates Google's structured-data guidelines. Add it (with `review`)
// once real ratings exist; until then this markup is valid but not rich-result eligible.
// `logo` is likewise omitted until a crawlable logo asset exists — a 404 fails validation.
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Pikar AI",
      url: SITE,
      description: "Builder of Pikar AI, a governed agentic AI operating layer.",
      email: CONTACT,
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: CONTACT,
      },
    },
    {
      "@type": "WebSite",
      name: "Pikar AI",
      url: SITE,
      description: "A governed AI chief of staff for solo operators and small teams.",
      inLanguage: "en",
      // No `potentialAction`/SearchAction — the site has no search function.
    },
    {
      "@type": "SoftwareApplication",
      name: "Pikar AI",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: SITE,
      description:
        "Turns a spoken or typed goal into a planned, guardrailed, human-approved workflow that delivers real output by email, with a full audit trail.",
      author: { "@type": "Organization", name: "Pikar AI" },
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  ],
};

// Refs, ids and counts only — never message content. This mirrors the real audit
// contract: the log must never become a place where private text accumulates.
const ledger: [string, string, string, boolean][] = [
  ["09:41:02", "goal.received", "cid=8f2a41c9", false],
  ["09:41:04", "plan.created", "steps=4", false],
  ["09:41:09", "guardrail.pii", "redactions=2", false],
  ["09:41:09", "guardrail.cost", "est=$0.014 cap=$0.50", false],
  ["09:41:11", "review.requested", "held=00:02:16", false],
  ["09:43:27", "review.approved", "actor=user", true],
  ["09:43:27", "email.sent", "msg=1a7c0e55", true],
];

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <div className="shell">
        <header className="hero">
          <div>
            <p className="eyebrow">Human approval required</p>
            <h1>
              Your AI drafts it. <em>You</em> release it.
            </h1>
            <p className="lede">
              Say what you want done. Pikar plans it, runs it behind guardrails, and stops
              at the gate — until you approve.
            </p>
            <div className="cta-row">
              <a className="cta" href={`mailto:${CONTACT}?subject=Pikar%20AI%20access`}>
                Request access
              </a>
              <a className="cta cta-ghost" href="#how">
                See how it works
              </a>
            </div>
          </div>

          {/* Signature element: the gate. A draft is held, stamped, released, and the
              act is appended to a log that cannot be edited. */}
          <div className="gate" aria-label="A draft email held at the approval gate">
            <div className="gate-head">
              <span>draft &middot; awaiting review</span>
              <span>cid 8f2a41c9</span>
            </div>

            <article className="draft">
              <p className="draft-to">to: procurement@northwind.example</p>
              <p className="draft-body">
                Following up on the Q3 renewal — I&rsquo;ve attached the revised terms, and
                can walk through them Thursday if that helps.
              </p>
              <span className="stamp">APPROVED</span>
            </article>

            <div className="gate-line" />
            <p className="gate-status">released &middot; sent 09:43:27</p>
            <p className="gate-audit">
              + audit.append &nbsp;email.sent&nbsp; msg=1a7c0e55 &nbsp;immutable
            </p>
          </div>
        </header>

        <section className="section" id="how">
          <h2>How it works</h2>
          <ol className="steps">
            <li>
              <div>
                <strong>State a goal</strong>
                <p>Speak it or type it, in plain language. No prompt craft.</p>
              </div>
            </li>
            <li>
              <div>
                <strong>Pikar plans it</strong>
                <p>The goal becomes concrete, ordered steps you can inspect.</p>
              </div>
            </li>
            <li>
              <div>
                <strong>Guardrails run first</strong>
                <p>
                  Cost ceilings, quality checks, and PII redaction apply before anything is
                  prepared for sending — not after.
                </p>
              </div>
            </li>
            <li>
              <div>
                <strong>It stops at the gate</strong>
                <p>
                  You approve, edit, or reject. Nothing reaches the outside world without
                  your explicit sign-off.
                </p>
              </div>
            </li>
            <li>
              <div>
                <strong>Pikar delivers</strong>
                <p>
                  The approved email sends on your behalf, and every step is written to an
                  append-only log.
                </p>
              </div>
            </li>
          </ol>
        </section>

        <section className="section">
          <h2>What it will not do</h2>
          <div className="grid-3">
            <div>
              <h3>Send without you</h3>
              <p>
                Pikar drafts; you decide. There is no autonomous send, and no setting that
                enables one.
              </p>
            </div>
            <div>
              <h3>Read your mail</h3>
              <p>
                Pikar requests one Gmail permission — the one that sends. It cannot read,
                search, or list your inbox.
              </p>
            </div>
            <div>
              <h3>Quietly rewrite history</h3>
              <p>
                The audit log is append-only. Records can be added, never edited or
                deleted.
              </p>
            </div>
          </div>
        </section>

        <section className="section">
          <h2>Every action leaves a record</h2>
          <div className="ledger">
            <p className="ledger-head">audit trail &middot; excerpt</p>
            <table>
              <tbody>
                {ledger.map(([time, event, detail, ok]) => (
                  <tr key={`${time}-${event}`}>
                    <td>{time}</td>
                    <td className="ev">{event}</td>
                    <td className={ok ? "ok" : undefined}>{detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ledger-note">
            The log stores references, identifiers, and counts — never the content of your
            messages. It is built so that it can never become a place where your private
            text accumulates.
          </p>
        </section>

        <footer className="foot">
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
          <span className="spacer">&copy; {new Date().getFullYear()} Pikar AI</span>
        </footer>
      </div>
    </>
  );
}
