import type { Metadata } from "next";
import {
  CONTACT,
  EFFECTIVE,
  ENTITY,
  ENTITY_ADDRESS,
  GOVERNING_LAW,
  HAS_PLACEHOLDERS,
  SITE,
  VENUE,
} from "../legal";

export const metadata: Metadata = {
  title: "Terms of Service — Pikar AI",
  description:
    "The terms governing your use of Pikar AI, including private beta status, acceptable use, responsibility for approved emails and social posts, connected platform terms, and limitations of liability.",
  alternates: { canonical: `${SITE}/terms` },
};

export default function Terms() {
  return (
    <main className="prose">
      <h1>Terms of Service</h1>
      <p className="updated">Effective {EFFECTIVE}</p>

      {HAS_PLACEHOLDERS && (
        <p className="notice">
          <strong>Draft — not yet in force.</strong> This document has not been reviewed by a
          qualified lawyer. The bracketed legal details below remain unconfirmed. Publication under
          the existing review deferral does not complete legal review.
        </p>
      )}

      <h2>1. Agreement</h2>
      <p>
        These Terms form a binding agreement between you and {ENTITY}, of {ENTITY_ADDRESS}{" "}
        (&ldquo;Pikar&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), governing your use of the Pikar
        AI service. By creating an account or using the service, you accept these Terms. If you do
        not accept them, do not use the service.
      </p>
      <p>
        Our <a href="/privacy">Privacy Policy</a> explains how we handle personal data and forms
        part of this agreement.
      </p>

      <h2>2. Private beta</h2>
      <p>
        Pikar is currently offered as an <strong>invite-only private beta</strong>. This means:
      </p>
      <ul>
        <li>The service is provided free of charge, and may change or be withdrawn at any time.</li>
        <li>
          There is <strong>no service level agreement</strong>, no uptime commitment, and no
          guarantee of availability.
        </li>
        <li>
          Features may be added, altered, or removed without notice, and data may be lost. Do not
          rely on Pikar as the sole store of anything you cannot afford to lose.
        </li>
        <li>We may suspend or end your access, or the beta itself, at our discretion.</li>
      </ul>

      <h2>3. Eligibility and your account</h2>
      <p>
        You must be at least 18 years old and capable of forming a binding contract. You are
        responsible for the security of your account and for everything done through it. Tell us
        promptly at <a href={`mailto:${CONTACT}`}>{CONTACT}</a> if you suspect unauthorised access.
      </p>
      <p>
        If you use Pikar on behalf of an organisation, you represent that you are authorised to bind
        that organisation, and &ldquo;you&rdquo; means that organisation.
      </p>

      <h2>4. What the service does</h2>
      <p>
        You give Pikar a goal. It plans the work and presents that plan to you. Once you approve it,
        Pikar carries the plan out autonomously under cost and content guardrails, notifies you as
        stages complete, and writes every step to an append-only audit log. You can halt a running
        automation at any time.
      </p>
      <p>
        If you connect the Google mailbox integration, Pikar&rsquo;s agents can read your email,
        draft and send messages as you, and organise your mail. You grant this once, through
        Google&rsquo;s consent screen, and may revoke it at any time. Pikar cannot permanently
        delete your email.
      </p>

      <h2 id="social-accounts">4a. Connected social accounts and publication</h2>
      <p>
        Pikar offers direct connections for customers to use their own Facebook Pages, linked
        professional Instagram accounts, TikTok creators and YouTube channels. Signing in does not
        connect all your accounts or grant every permission. You authorise each provider connection
        and select the accounts your workspace may use. Connect only accounts you own or are
        authorised to manage.
      </p>
      <p>
        Identity, content reading and publication are separate capabilities. Additional access
        requires the provider permissions shown during connection. Some capabilities remain
        unavailable while platform approval or qualification is pending. A successful connection
        alone does not promise publishing access, analytics, messaging or advertising features.
      </p>
      <p>
        For direct social publication, an agent may prepare a draft, but you must review and approve
        the saved post, destination, text, media, visibility and required disclosures before
        submission. Approval of a general plan does not approve future posts. You are responsible
        for the content you approve, authority to publish it, media and music rights, audience
        choices, and commercial or altered-content disclosures. Do not submit another
        creator&rsquo;s work without permission.
      </p>
      <p>
        Providers can reject, delay, restrict or remove content. An accepted upload or processing
        receipt does not establish that a post is publicly available. If an outcome is uncertain,
        check the platform before approving another attempt. Disconnecting Pikar removes local
        connection credentials. YouTube disconnect also requests Google revocation after showing its
        effect on other integrations in the same Google project; the result screen explains whether
        further manual action is needed. Other providers require separate revocation. Published
        posts stay on the platform. See the{" "}
        <a href="/privacy#social-accounts">social connection privacy controls</a> for revocation,
        export and erasure information.
      </p>

      <h2>5. AI-generated output</h2>
      <p>
        Pikar uses large language models. Their output can be{" "}
        <strong>inaccurate, incomplete, misleading, or wholly fabricated</strong>, and may be
        offensive or unsuitable. It is not professional advice of any kind — legal, financial,
        medical, or otherwise.
      </p>
      <p>
        <strong>You must review every output before you approve it.</strong> The approval step
        exists precisely because the model cannot be trusted unsupervised. When you approve
        something, you adopt it as your own. We do not warrant that output is accurate, original, or
        fit for any purpose, and we are not responsible for decisions you take on the basis of it.
      </p>

      <h2>6. Email sent through your Google account</h2>
      <p>
        If you connect the Google mailbox integration, Pikar acts on your mailbox using the{" "}
        <code>gmail.modify</code> permission. Messages it sends leave{" "}
        <strong>from your mailbox, as you</strong>. In law and in fact,{" "}
        <strong>you are the sender</strong> — including messages sent autonomously as part of an
        automation you approved.
      </p>
      <p>
        You are solely responsible for every message sent from your account through Pikar, and you
        agree that you will not use Pikar to send:
      </p>
      <ul>
        <li>
          unsolicited bulk or commercial email, or any message that breaches applicable anti-spam or
          direct-marketing law (including the GDPR, PECR, and the CAN-SPAM Act);
        </li>
        <li>messages to recipients who have not given you the consent that law requires;</li>
        <li>
          content that is unlawful, defamatory, harassing, deceptive, infringing, or that
          impersonates another person;
        </li>
        <li>content on behalf of a third party without their authority.</li>
      </ul>
      <p>
        Approving a message is your act, not ours. We provide the tool and the audit trail; the
        judgement is yours.
      </p>

      <h2>7. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use Pikar for any unlawful purpose, or to violate anyone&rsquo;s rights;</li>
        <li>
          attempt to circumvent the approval gate, the guardrails, the rate limits, or the audit
          log;
        </li>
        <li>
          probe, scan, or test the vulnerability of the service, or breach its security or
          authentication measures, without our prior written consent;
        </li>
        <li>
          reverse engineer the service, or use it to build a competing product, or to train a
          machine-learning model;
        </li>
        <li>
          submit content you have no right to submit, or that contains malware, or that contains
          personal data about others without a lawful basis for giving it to us;
        </li>
        <li>use automated means to access the service beyond the limits we set.</li>
      </ul>

      <h2>8. Your content</h2>
      <p>
        You keep all rights in the goals, instructions, files, and drafts you submit (&ldquo;Your
        Content&rdquo;). You grant us a limited, non-exclusive, worldwide, royalty-free licence to
        host, copy, process, and transmit Your Content strictly as necessary to operate the service
        for you — and for no other purpose.
      </p>
      <p>
        <strong>
          We do not use Your Content to train generalised AI or machine-learning models.
        </strong>{" "}
        This licence ends when you delete the content or your account, save for the audit records
        described in the Privacy Policy.
      </p>
      <p>
        You are responsible for having a lawful basis to submit any personal data about third
        parties, and for the accuracy of what you submit.
      </p>

      <h2>9. Feedback</h2>
      <p>
        If you send us suggestions about the service, we may use them without restriction or
        obligation to you.
      </p>

      <h2>10. Our intellectual property</h2>
      <p>
        The service, its software, and its branding remain ours. These Terms grant you a limited,
        revocable, non-transferable right to use the service, and nothing more.
      </p>

      <h2>11. Third-party services</h2>
      <p>
        Pikar uses the external services described in our <a href="/privacy">Privacy Policy</a>. The
        services involved depend on the feature and configured provider route. Your use of a
        connected Google account is also governed by Google&rsquo;s own terms. We are not
        responsible for those services&rsquo; acts, omissions, or availability.
      </p>

      <p>
        Pikar uses YouTube API Services. By using Pikar&rsquo;s YouTube features, you agree to be
        bound by the{" "}
        <a href="https://www.youtube.com/t/terms" rel="noopener noreferrer">
          YouTube Terms of Service
        </a>
        . Google&rsquo;s{" "}
        <a href="https://policies.google.com/privacy" rel="noopener noreferrer">
          Privacy Policy
        </a>{" "}
        also applies to information handled by Google. You can revoke Pikar&rsquo;s YouTube access
        through your{" "}
        <a href="https://myaccount.google.com/permissions" rel="noopener noreferrer">
          Google Account connections
        </a>
        . Your use of Meta and TikTok is also subject to the relevant platform&rsquo;s terms,
        community rules and content policies; Pikar approval does not override them.
      </p>

      <h2>12. Disclaimers</h2>
      <p>
        To the fullest extent permitted by law, the service is provided{" "}
        <strong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;</strong>, without warranties of
        any kind, express or implied, including merchantability, fitness for a particular purpose,
        non-infringement, and any warranty that the service will be uninterrupted, secure, or
        error-free.
      </p>

      <h2>13. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, we are not liable for indirect, incidental, special,
        consequential, or punitive damages, nor for loss of profits, revenue, data, goodwill, or
        business opportunity, arising from your use of the service. Our total aggregate liability
        arising out of these Terms is limited to the greater of the amount you paid us in the twelve
        months preceding the claim, or <strong>USD 100</strong>.
      </p>
      <p>
        <strong>
          Nothing in these Terms limits or excludes liability that cannot lawfully be limited or
          excluded
        </strong>{" "}
        — including liability for death or personal injury caused by negligence, for fraud or
        fraudulent misrepresentation, or, if you are a consumer in the United Kingdom or the
        European Economic Area, any of your mandatory statutory rights, which are unaffected by this
        agreement.
      </p>

      <h2>14. Indemnity</h2>
      <p>
        You agree to indemnify us against claims, losses, and reasonable costs arising from your
        breach of these Terms, from Your Content, or from any message you approve and send through
        the service. This does not apply to the extent the claim arises from our own breach or
        negligence, and it does not apply where you are acting as a consumer.
      </p>

      <h2>15. Term and termination</h2>
      <p>
        You may stop using the service and delete your account at any time. We may suspend or
        terminate your access if you breach these Terms, if required by law, or if we discontinue
        the service. Sections 8, 10, and 12 through 17 survive termination.
      </p>

      <h2>16. Changes to these Terms</h2>
      <p>
        We may update these Terms. Where a change is material, we will give you reasonable notice
        before it takes effect, and continuing to use the service after that date means you accept
        the change. If you do not accept it, stop using the service.
      </p>

      <h2>17. Governing law and jurisdiction</h2>
      <p>
        These Terms are governed by {GOVERNING_LAW}, and disputes are subject to the exclusive
        jurisdiction of {VENUE}. If you are a consumer resident in the United Kingdom or the
        European Economic Area, you retain the protection of the mandatory laws of your country of
        residence, and may bring proceedings in its courts.
      </p>

      <h2>18. Contact</h2>
      <p>
        Questions about these Terms may be sent to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <footer className="foot">
        <a href="/">Home</a>
        <a href="/privacy">Privacy Policy</a>
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        <span className="spacer">&copy; {new Date().getFullYear()} Pikar AI</span>
      </footer>
    </main>
  );
}
