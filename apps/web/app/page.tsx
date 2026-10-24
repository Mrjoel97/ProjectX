import type { Metadata } from "next";
import { CONTACT, SITE } from "./legal";

export const metadata: Metadata = {
  title: "Pikar AI — your work done, nothing sent without your approval",
  description:
    "Pikar AI helps businesses draft replies, prepare documents and plan social content. Connect your own accounts and approve original posts before publishing.",
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
      description: "Builder of Pikar AI, an AI chief of staff for solo operators.",
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
        "An AI chief of staff for solo operators: drafts replies, books meetings, writes documents and proposes the week's next move from your own numbers. Nothing is sent without your approval, and every action is written to a log that cannot be edited.",
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
const structuredDataJson = JSON.stringify(structuredData).replace(/</g, "\\u003c");

export default function Home() {
  return (
    <>
      <script type="application/ld+json">{structuredDataJson}</script>

      <div className="shell">
        <header className="hero">
          <div>
            <p className="eyebrow">Private beta · by invitation · human approval required</p>
            <h1>
              It does the work. <em>You</em> approve it.
            </h1>
            <p className="lede">
              Pikar AI helps businesses prepare replies, meetings, documents and social posts from
              their own files and connected accounts.
            </p>
            <div className="cta-row">
              <a className="cta" href="/signin">
                Sign in
              </a>
              {/* 25.2 (G16): admission is invite-only by owner decision; strangers go to the
                  waitlist door /signup already serves, not to a mail client. */}
              <a className="cta cta-ghost" href="/signup">
                Request access
              </a>
              <a className="cta cta-ghost" href="#how">
                See how it works
              </a>
            </div>
          </div>

          {/* Signature element: the gate. A draft is held, stamped, released, and the
              act is appended to a log that cannot be edited. */}
          <section className="gate" aria-label="A draft email held at the approval gate">
            <div className="gate-head">
              <span>draft &middot; awaiting review</span>
              <span>cid 8f2a41c9</span>
            </div>

            <article className="draft">
              <p className="draft-to">to: procurement@northwind.example</p>
              <p className="draft-body">
                Following up on the Q3 renewal — I&rsquo;ve attached the revised terms, and can walk
                through them Thursday if that helps.
              </p>
              <span className="stamp">APPROVED</span>
            </article>

            <div className="gate-line" />
            <p className="gate-status">released &middot; sent 09:43:27</p>
            <p className="gate-audit">
              + audit.append &nbsp;email.sent&nbsp; msg=1a7c0e55 &nbsp;immutable
            </p>
          </section>
        </header>

        <section className="section">
          <h2>What you get</h2>
          <div className="grid-3">
            <div>
              <h3>Replies, sent</h3>
              <p>
                Pikar reads your inbox, drafts the reply in your voice, and sends it when you say
                so. Your morning briefing tells you what still needs an answer.
              </p>
            </div>
            <div>
              <h3>Meetings and documents, done</h3>
              <p>
                A calendar invite created, a proposal or one-pager written and filed to your vault,
                grounded in what you have already told it.
              </p>
            </div>
            <div>
              <h3>The next move, every week</h3>
              <p>
                Each Monday Pikar reads your business from your own numbers, names the one thing
                holding revenue back, and stages the next step for your approval.
              </p>
            </div>
          </div>
          <p>
            With social features enabled, each customer connects their own accounts and selects
            which accounts Pikar may use. YouTube access is used to review your own channel and
            public video information for content planning. Uploading an original video requires your
            explicit approval of the saved video, channel, title, visibility and disclosures.
          </p>
          <p>
            Pikar AI is a free, invite-only private beta. Social connections and publishing may
            remain unavailable while platform permissions and approvals are pending. See our{" "}
            <a href="/privacy#social-accounts">social account data and privacy controls</a>.
          </p>
          <p>
            Use only accounts and media you own or are authorised to use. Creating or sharing
            non-consensual intimate imagery is prohibited. See our{" "}
            <a href="/terms">acceptable use and media rights terms</a>.
          </p>
        </section>

        <section className="section" id="how">
          <h2>How it works</h2>
          <ol className="steps">
            <li>
              <div>
                <strong>Say what you need</strong>
                <p>A reply, a meeting, a document, a decision. Plain language, spoken or typed.</p>
              </div>
            </li>
            <li>
              <div>
                <strong>Pikar prepares it</strong>
                <p>The draft, the invite or the document, built from your own files and figures.</p>
              </div>
            </li>
            <li>
              <div>
                <strong>Checks run first</strong>
                <p>
                  Cost limits, quality checks and PII redaction apply before anything is ready to
                  send — not after.
                </p>
              </div>
            </li>
            <li>
              <div>
                <strong>You approve, edit or reject</strong>
                <p>Nothing is sent, booked or filed until you say so.</p>
              </div>
            </li>
            <li>
              <div>
                <strong>It goes out, and you see the record</strong>
                <p>
                  You are told when each step completes, every action lands in a log that cannot be
                  edited, and you can stop it at any time.
                </p>
              </div>
            </li>
          </ol>
        </section>

        <section className="section">
          <h2>What it will not do</h2>
          <div className="grid-3">
            <div>
              <h3>Start without you</h3>
              <p>
                Pikar can read authorised context and prepare drafts as you work. Sending mail or
                publishing a social post waits for your approval, and you can halt a running
                automation.
              </p>
            </div>
            <div>
              <h3>Delete your email</h3>
              <p>
                Pikar can read, draft, send, and organise. It cannot permanently delete a message —
                we never ask Google for that permission.
              </p>
            </div>
            <div>
              <h3>Quietly rewrite history</h3>
              <p>The audit log is append-only. Records can be added, never edited or deleted.</p>
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
            The log stores references, identifiers, and counts — never the content of your messages.
            It is built so that it can never become a place where your private text accumulates.
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
