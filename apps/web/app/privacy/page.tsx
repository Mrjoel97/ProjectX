import type { Metadata } from "next";
import {
  CONTACT,
  EFFECTIVE,
  ENTITY,
  ENTITY_ADDRESS,
  HAS_PLACEHOLDERS,
  LEAD_AUTHORITY,
  SITE,
} from "../legal";

export const metadata: Metadata = {
  title: "Privacy Policy — Pikar AI",
  description:
    "How Pikar AI collects, uses, stores, shares, and protects personal data, including Google user data obtained through the gmail.send scope, and your rights under the GDPR.",
  alternates: { canonical: `${SITE}/privacy` },
};

export default function Privacy() {
  return (
    <main className="prose">
      <h1>Privacy Policy</h1>
      <p className="updated">Effective {EFFECTIVE}</p>

      {HAS_PLACEHOLDERS && (
        <p className="notice">
          <strong>Draft — not yet in force.</strong> This document has not been reviewed by a
          qualified lawyer, and the controlling legal entity has not been formed. Bracketed
          placeholders below must be resolved before publication. The production build is
          blocked until they are.
        </p>
      )}

      <h2>1. Who we are</h2>
      <p>
        Pikar AI (&ldquo;Pikar&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) provides a governed AI
        assistant that plans and carries out tasks you ask for, including sending email on your
        behalf after you have reviewed and approved it.
      </p>
      <p>
        The <strong>data controller</strong> for the purposes of the UK and EU General Data
        Protection Regulation (&ldquo;GDPR&rdquo;) is {ENTITY}, of {ENTITY_ADDRESS}. You can reach
        us about anything in this policy at <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
      <p>
        We have not appointed a Data Protection Officer, as we are not required to under Article 37
        GDPR. Enquiries go to the address above.
      </p>

      <h2>2. What data we collect</h2>
      <ul>
        <li>
          <strong>Account data.</strong> Your email address and authentication identifiers, used to
          sign you in and to scope your data to you.
        </li>
        <li>
          <strong>Content you provide.</strong> The goals, instructions, drafts, and any files you
          submit so that Pikar can act on them. This may contain personal data about you or about
          third parties, depending on what you write.
        </li>
        <li>
          <strong>Google user data.</strong> If you connect a Google account, the OAuth tokens that
          permit us to send email as you. See section 4.
        </li>
        <li>
          <strong>Operational records.</strong> An append-only audit log of actions taken on your
          behalf. These records store references, identifiers, hashes, and counts — not the content
          of your messages. See section 8.
        </li>
        <li>
          <strong>Technical data.</strong> Data your browser sends when you use the service, such as
          IP address and timestamps, processed by our hosting providers to deliver and secure it.
        </li>
      </ul>
      <p>
        We do not knowingly collect special-category data (Article 9 GDPR). Please do not submit it.
      </p>

      <h2>3. Why we process it, and our lawful basis</h2>
      <ul>
        <li>
          <strong>To create and secure your account</strong> — performance of a contract with you
          (Art. 6(1)(b)).
        </li>
        <li>
          <strong>To plan and carry out the tasks you ask for, and to send the emails you
          approve</strong> — performance of a contract (Art. 6(1)(b)).
        </li>
        <li>
          <strong>To connect your Google account</strong> — performance of a contract (Art.
          6(1)(b)). You authorise the connection through Google&rsquo;s own consent screen and may
          withdraw it at any time (section 9).
        </li>
        <li>
          <strong>To keep an audit log of actions taken on your behalf</strong> — our legitimate
          interest in accountability, security, and being able to demonstrate what the system did
          (Art. 6(1)(f)), and in some cases a legal obligation (Art. 6(1)(c)). We consider this
          proportionate because the log records references and identifiers rather than the content
          of your messages.
        </li>
        <li>
          <strong>To secure the service and prevent abuse</strong> — legitimate interest (Art.
          6(1)(f)).
        </li>
      </ul>
      <p>
        We do not use your data for advertising, and we do not sell it. Where we rely on legitimate
        interests, you have the right to object (section 9).
      </p>

      <h2>4. Google user data</h2>
      <p>
        Pikar requests the <code>gmail.send</code> scope, and only that Gmail scope. We use it for
        exactly one purpose: to send an email that you have explicitly reviewed and approved in the
        application.
      </p>
      <ul>
        <li>
          <strong>We do not read your mailbox.</strong> The <code>gmail.send</code> scope does not
          grant the ability to read, search, or list your messages, and we do not request any scope
          that does.
        </li>
        <li>
          <strong>We never send without your approval.</strong> Every outbound message is presented
          to you first. Nothing is sent automatically.
        </li>
        <li>
          <strong>How it is stored.</strong> OAuth tokens are held in our Convex database, encrypted
          at rest by the platform, and scoped so they are accessible only to your account.
        </li>
        <li>
          <strong>How it is shared.</strong> We do not sell Google user data, and we do not transfer
          it to third parties, except as strictly necessary to send the message you approved, or
          where required by law.
        </li>
        <li>
          <strong>We do not use it to train models.</strong> Google user data is never used to
          develop, improve, or train generalised AI or machine-learning models.
        </li>
      </ul>

      <h2>5. Limited Use</h2>
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

      <h2>6. Automated decision-making</h2>
      <p>
        Pikar uses AI models to plan tasks and draft content. It does <strong>not</strong> make
        decisions producing legal or similarly significant effects about you by automated means
        alone. Every action that leaves the system — in particular, every email — requires your
        explicit human approval before it is carried out. You are therefore not subject to a
        decision based solely on automated processing within the meaning of Article 22 GDPR.
      </p>

      <h2>7. Who we share data with</h2>
      <p>
        We share personal data only with service providers who process it on our instructions as
        processors under Article 28 GDPR:
      </p>
      <ul>
        <li>
          <strong>Convex</strong> — application backend and database.
        </li>
        <li>
          <strong>Vercel</strong> — hosting of this website and the application interface.
        </li>
        <li>
          <strong>Amazon Web Services</strong> — immutable archival storage of the audit log.
        </li>
        <li>
          <strong>Google</strong> — delivery of the emails you approve, via the Gmail API.
        </li>
        <li>
          <strong>[LLM PROVIDER — TBD]</strong> — generation of drafts and plans from your
          instructions. This provider is not yet selected; this policy will be updated to name it
          before any such processing begins.
        </li>
      </ul>
      <p>
        We do not sell personal data, and we do not share it with advertisers or data brokers. We
        may disclose data where required by law, or to establish or defend legal claims.
      </p>

      <h2>8. International transfers</h2>
      <p>
        Our providers are established in, or process data in, the United States. Where personal data
        is transferred outside the UK or European Economic Area, we rely on the European
        Commission&rsquo;s Standard Contractual Clauses, the UK International Data Transfer
        Addendum, or an adequacy decision, as applicable to each provider. You may request a copy of
        the safeguards in place by writing to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <h2>9. Retention, and the immutable audit archive</h2>
      <p>
        We keep account data and your submitted content for as long as your account is active. You
        may request deletion at any time (section 10); we will action it within one month, as
        required by Article 12(3) GDPR.
      </p>
      <p>
        Audit records are retained as an immutable compliance log, and are exported to
        write-once storage that <strong>cannot be modified or deleted</strong>, including by us.
        That is the point of the log: the system that writes it must not be able to rewrite it.
      </p>
      <p>
        For this reason the audit log is designed to hold{" "}
        <strong>references, identifiers, hashes, and counts only — never the content of your
        messages, and no personal data.</strong>{" "}
        This is what allows an immutable log and your right to erasure to coexist: there is nothing
        in the archive to erase. Deleting your account removes your account data and content; the
        audit archive retains only the non-personal record that actions occurred.
      </p>

      <h2>10. Your rights</h2>
      <p>Under the GDPR you have the right to:</p>
      <ul>
        <li>
          <strong>Access</strong> the personal data we hold about you (Art. 15).
        </li>
        <li>
          <strong>Rectify</strong> inaccurate or incomplete data (Art. 16).
        </li>
        <li>
          <strong>Erase</strong> your data (Art. 17), subject to section 9.
        </li>
        <li>
          <strong>Restrict</strong> processing in certain circumstances (Art. 18).
        </li>
        <li>
          <strong>Portability</strong> — receive your data in a structured, machine-readable format
          (Art. 20).
        </li>
        <li>
          <strong>Object</strong> to processing based on our legitimate interests (Art. 21).
        </li>
        <li>
          <strong>Withdraw consent</strong> at any time, where processing relies on it, without
          affecting processing carried out beforehand.
        </li>
      </ul>
      <p>
        To exercise any of these, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. We respond
        within one month. We do not charge a fee unless a request is manifestly unfounded or
        excessive.
      </p>
      <p>
        You can disconnect your Google account at any time from within the application, or revoke
        access directly at{" "}
        <a href="https://myaccount.google.com/permissions" rel="noopener noreferrer">
          myaccount.google.com/permissions
        </a>
        . Revoking access invalidates our tokens immediately.
      </p>
      <p>
        If you are unhappy with how we handle your data, you may complain to your local supervisory
        authority. Our lead supervisory authority is {LEAD_AUTHORITY}. In the UK, this is the
        Information Commissioner&rsquo;s Office (<code>ico.org.uk</code>).
      </p>

      <h2>11. Security</h2>
      <p>
        We apply technical and organisational measures appropriate to the risk (Art. 32 GDPR): data
        is scoped per account at the database layer, OAuth tokens are encrypted at rest, secrets are
        held in a server-side environment separate from the application code, and every action taken
        on your behalf is recorded in an append-only log. No system is perfectly secure, and we do
        not claim otherwise.
      </p>

      <h2>12. Personal data breaches</h2>
      <p>
        If a breach is likely to result in a risk to your rights and freedoms, we will notify the
        competent supervisory authority within 72 hours of becoming aware of it (Art. 33), and will
        inform you directly without undue delay where the risk is high (Art. 34).
      </p>

      <h2>13. Children</h2>
      <p>
        Pikar is not intended for anyone under 18, and we do not knowingly collect data from
        children. If you believe a child has provided us data, contact us and we will delete it.
      </p>

      <h2>14. Changes to this policy</h2>
      <p>
        If we make material changes to how we handle your data, we will update this page, revise the
        effective date above, and — where the change is significant — notify you directly.
      </p>

      <h2>15. Contact</h2>
      <p>
        Questions about this policy, or requests regarding your data, may be sent to{" "}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <footer className="foot">
        <a href="/">Home</a>
        <a href="/terms">Terms of Service</a>
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        <span className="spacer">&copy; {new Date().getFullYear()} Pikar AI</span>
      </footer>
    </main>
  );
}
