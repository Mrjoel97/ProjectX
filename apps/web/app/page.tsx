import type { Metadata } from "next";

const SITE = "https://pikar-ai.com";
const CONTACT = "joel@pikar-ai.com";

export const metadata: Metadata = {
  title: "Pikar AI — a governed AI chief of staff",
  description:
    "Speak or type a goal. Pikar AI plans it, runs it under cost and privacy guardrails, waits for your approval, then delivers — with a full audit trail.",
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

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <main>
        <h1>A governed AI chief of staff.</h1>
        <p className="lede">
          Speak or type a goal. Pikar AI plans it, executes it under guardrails, and waits
          for your approval before anything leaves the building.
        </p>

        <h2>How it works</h2>
        <ol>
          <li>
            <strong>You state a goal</strong> — by voice or text, in plain language.
          </li>
          <li>
            <strong>Pikar plans it</strong> — breaking the goal into concrete steps.
          </li>
          <li>
            <strong>Guardrails apply</strong> — cost ceilings, quality checks, and PII
            redaction run before anything is sent.
          </li>
          <li>
            <strong>You approve, edit, or reject</strong> — nothing reaches the outside
            world without your explicit sign-off.
          </li>
          <li>
            <strong>Pikar delivers</strong> — sending the approved email on your behalf,
            and recording every step in an append-only audit log.
          </li>
        </ol>

        <h2>Who it&rsquo;s for</h2>
        <p>
          Solo operators, founders, and small teams who want the leverage of an agentic
          assistant without handing over unreviewed control of their inbox, their budget,
          or their customer data.
        </p>

        <h2>Built to be accountable</h2>
        <ul>
          <li>
            <strong>Human approval before delivery.</strong> Pikar drafts; you decide.
          </li>
          <li>
            <strong>An append-only audit trail.</strong> Every decision is recorded and
            cannot be edited after the fact.
          </li>
          <li>
            <strong>Your data stays yours.</strong> It is never sold, and never used to
            train models.
          </li>
        </ul>

        <footer>
          <a href="/privacy">Privacy Policy</a>
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
          <p>&copy; {new Date().getFullYear()} Pikar AI</p>
        </footer>
      </main>
    </>
  );
}
