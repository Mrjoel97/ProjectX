import type { Metadata } from "next";

const SITE = "https://pikar-ai.com";
const CONTACT = "joel@pikar-ai.com";
const EFFECTIVE = "10 July 2026";

export const metadata: Metadata = {
  title: "Privacy Policy — Pikar AI",
  description:
    "How Pikar AI accesses, uses, stores, and shares your data, including Google user data obtained through the gmail.send scope.",
  alternates: { canonical: `${SITE}/privacy` },
};

export default function Privacy() {
  return (
    <main>
      <h1>Privacy Policy</h1>
      <p className="updated">Effective {EFFECTIVE}</p>

      <p>
        Pikar AI (&ldquo;Pikar&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) provides a
        governed AI assistant that plans and carries out tasks you ask for, including
        sending email on your behalf after you have reviewed and approved it. This policy
        explains what data we handle and why.
      </p>

      <h2>Data we collect</h2>
      <ul>
        <li>
          <strong>Account data.</strong> Your email address and authentication identifiers,
          used to sign you in and to scope your data to you.
        </li>
        <li>
          <strong>Content you provide.</strong> The goals, instructions, and drafts you
          submit so that Pikar can act on them.
        </li>
        <li>
          <strong>Google user data.</strong> If you connect a Google account, the OAuth
          tokens that permit us to send email as you. See the next section.
        </li>
        <li>
          <strong>Operational records.</strong> An append-only audit log of actions taken
          on your behalf. These records store references, identifiers, and counts — not the
          content of your messages.
        </li>
      </ul>

      <h2>Google user data</h2>
      <p>
        Pikar requests the <code>gmail.send</code> scope, and only that Gmail scope. We use
        it for exactly one purpose: to send an email that you have explicitly reviewed and
        approved in the application.
      </p>
      <ul>
        <li>
          <strong>We do not read your mailbox.</strong> The <code>gmail.send</code> scope
          does not grant the ability to read, search, or list your messages, and we do not
          request any scope that does.
        </li>
        <li>
          <strong>We never send without your approval.</strong> Every outbound message is
          presented to you first. Nothing is sent automatically.
        </li>
        <li>
          <strong>How it is stored.</strong> OAuth tokens are held in our Convex database,
          encrypted at rest by the platform, and scoped so they are accessible only to your
          account.
        </li>
        <li>
          <strong>How it is shared.</strong> We do not sell Google user data, and we do not
          transfer it to third parties, except as strictly necessary to send the message you
          approved, or where required by law.
        </li>
        <li>
          <strong>We do not use it to train models.</strong> Google user data is never used
          to develop, improve, or train generalised AI or machine-learning models.
        </li>
      </ul>

      <h2>Limited Use</h2>
      <p>
        Pikar AI&rsquo;s use of information received from Google APIs adheres to the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          rel="noopener noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        You may disconnect your Google account at any time from within the application, or
        revoke access directly at{" "}
        <a href="https://myaccount.google.com/permissions" rel="noopener noreferrer">
          myaccount.google.com/permissions
        </a>
        . Revoking access invalidates our tokens immediately. You may request deletion of
        your account and associated data by emailing us; we will action it within 30 days.
      </p>
      <p>
        Audit records are retained as an immutable compliance log. They contain references
        and identifiers rather than message content, and are kept for as long as we are
        required to demonstrate what actions were taken on your behalf.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If we make material changes to how we handle your data, we will update this page and
        revise the effective date above.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy, or requests regarding your data, may be sent to{" "}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <footer>
        <a href="/">Home</a>
        <p>&copy; {new Date().getFullYear()} Pikar AI</p>
      </footer>
    </main>
  );
}
