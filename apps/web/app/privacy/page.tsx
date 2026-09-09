import { AUDIT_ARCHIVE_STATEMENT } from "@pikar/core/tenantData";
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
    "How Pikar AI collects, uses, stores, shares, and protects personal data, including Google user data obtained through the gmail.modify, calendar and drive.readonly scopes, Microsoft account data, and your rights under the GDPR.",
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
          placeholders below must be resolved before publication. The production build is blocked
          until they are.
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
          permit our agents to act on your mailbox, your calendar, and files in your Google Drive,
          and the content of the messages, events, and documents they read in order to do so. This
          necessarily includes personal data about the people who write to you. See section 4.
        </li>
        <li>
          <strong>Microsoft account data.</strong> If you connect a Microsoft account, the OAuth
          tokens that permit our agents to read and write your Outlook calendar, together with your
          name and email address. The grant also covers reading and sending mail; see section 4 for
          what we do and do not do with it today.
        </li>
        <li>
          <strong>Operational records.</strong> An append-only audit log of actions taken on your
          behalf. These records store references, identifiers, hashes, and counts — not the content
          of your messages. See section 9.
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
          <strong>
            To plan and carry out the tasks you ask for, and to send the emails you approve
          </strong>{" "}
          — performance of a contract (Art. 6(1)(b)).
        </li>
        <li>
          <strong>To connect your Google or Microsoft account</strong> — performance of a contract
          (Art. 6(1)(b)). You authorise each connection through that provider&rsquo;s own consent
          screen and may withdraw it at any time (section 10).
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
        interests, you have the right to object (section 10).
      </p>

      <h2>4. Google user data, and Microsoft account data</h2>
      <p>
        If you choose to connect a Google account, Pikar requests four scopes in a single consent:
      </p>
      <ul>
        <li>
          <code>gmail.modify</code> — read, draft, send, and label mail in your mailbox. Google
          classifies this as a <strong>restricted</strong> scope, because it grants wide access.
        </li>
        <li>
          <code>calendar.freebusy</code> — read when you are busy, without reading event details.
        </li>
        <li>
          <code>calendar.events</code> — create events on your calendar. Used today only to add an
          event you have approved.
        </li>
        <li>
          <code>drive.readonly</code> — read files in your Google Drive, so you can bring documents
          into your knowledge vault. This is read-only across your whole Drive; we cannot modify or
          delete anything in it.
        </li>
      </ul>
      <p>
        <strong>
          Our agents can read the email in your mailbox, draft and send messages as you, organise
          your mail with labels, see when you are busy, add calendar events you have approved, and
          read files from your Drive.
        </strong>{" "}
        That access is what allows Pikar to act as an assistant rather than a text box. We do not
        pretend otherwise.
      </p>
      <p>
        <strong>If you connect a Microsoft account</strong>, Pikar requests one grant covering{" "}
        <code>Calendars.ReadWrite</code>, <code>Mail.Send</code>, <code>Mail.Read</code>,{" "}
        <code>offline_access</code>, and your basic identity (<code>openid</code>,{" "}
        <code>profile</code>, <code>email</code>). We ask for the mail permissions at the same time
        as the calendar ones so that you consent once rather than twice.{" "}
        <strong>
          Outlook mail is not implemented yet: today we use only the calendar and identity
          permissions, and no code in the product reads or sends Microsoft mail.
        </strong>{" "}
        We tell you this rather than let a granted-but-unused permission sit undisclosed. When the
        mail feature ships, its behaviour will be the same as the Gmail behaviour described here,
        and we will update this policy before it does.
      </p>
      <ul>
        <li>
          <strong>You grant access once, deliberately.</strong> Nothing is accessed until you
          connect the account through Google&rsquo;s own consent screen. We ask once, not
          repeatedly, so that the assistant can work without interrupting you — and you can withdraw
          that access at any time (section 10). Before connecting, our access to your mailbox is
          zero.
        </li>
        <li>
          <strong>We cannot permanently delete your email.</strong> Deletion requires the{" "}
          <code>https://mail.google.com/</code> scope. We do not request it, and therefore cannot
          use it.
        </li>
        <li>
          <strong>You approve the automation before it runs.</strong> Pikar presents a plan of what
          it intends to do. Work begins only after you approve that plan, and you are notified as it
          proceeds. You can stop it.
        </li>
        <li>
          <strong>What we do with message content.</strong> We read messages to understand context,
          to draft replies, and to carry out the work you approved. Message content is processed for
          that purpose and is not retained beyond what is needed to do it.
        </li>
        <li>
          <strong>It reaches our AI providers.</strong> To draft, summarise, or search your vault,
          content is sent to the large-language-model and embedding providers named in section 7 —
          OpenAI and Google — under contractual terms that forbid retaining it or training on it.
        </li>
        <li>
          <strong>It never reaches our audit log.</strong> The append-only log records references,
          identifiers, hashes and counts — never the content of your messages. See section 9.
        </li>
        <li>
          <strong>How tokens are stored.</strong> OAuth tokens are held in our Convex database,
          encrypted at rest by the platform, and scoped so they are accessible only to your account.
        </li>
        <li>
          <strong>We do not sell it,</strong> and we do not transfer it to third parties except the
          processors in section 7, or where required by law.
        </li>
        <li>
          <strong>We do not use it to train models.</strong> Google user data is never used to
          develop, improve, or train generalised AI or machine-learning models. Google&rsquo;s
          policies prohibit this for restricted-scope data, and so do we.
        </li>
      </ul>
      <p>
        Because <code>gmail.modify</code> is a restricted scope, Pikar is additionally subject to an
        independent annual security assessment under Google&rsquo;s requirements.
      </p>
      <p>
        <strong>A note about other people.</strong> Your mailbox contains messages written by people
        who have no relationship with Pikar. When you connect your account, you instruct us to
        process their personal data on your behalf. You are responsible for having a lawful basis to
        do so. We process it only to serve you, never to build profiles, and never for any purpose
        of our own.
      </p>

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
        Pikar uses AI models to plan tasks, read context, and draft content, and it then carries
        that work out autonomously. This is the point of the product. We want you to understand
        precisely where the human sits.
      </p>
      <p>
        <strong>You approve the plan before it runs.</strong> Pikar shows you what it intends to do.
        Nothing executes until you approve, you are notified as each stage completes, and you can
        halt a running automation at any time. Individual steps within an approved plan are carried
        out automatically — that is what you approved.
      </p>
      <p>
        Pikar does not make decisions producing legal or similarly significant effects about you by
        automated means alone, within the meaning of Article 22 GDPR: a human — you — authorises
        each automation, and retains the ability to intervene and to obtain an explanation of what
        was done, from the audit log. If we ever introduce processing that would fall within Article
        22, we will tell you before it begins and provide the safeguards that Article requires.
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
          <strong>Vercel</strong> — hosting of this website and the application interface. Our model
          requests do not pass through Vercel; we call each AI provider directly.
        </li>
        <li>
          <strong>Amazon Web Services</strong> — immutable archival storage of the audit log. This
          export is built but not currently switched on, so no data reaches it today (section 9).
        </li>
        <li>
          <strong>Google</strong> — in two distinct roles. As your connected account provider:
          reading, organising and sending mail, reading your calendar and creating events, and
          reading Drive files, via Google&rsquo;s APIs. Separately, as an{" "}
          <strong>AI provider</strong>: Google&rsquo;s Gemini models generate content and produce
          the embeddings that make your vault searchable, and receive the content processed for
          those purposes.
        </li>
        <li>
          <strong>Microsoft</strong> — reading and writing your Outlook calendar, via the Microsoft
          Graph API, if you connect a Microsoft account.
        </li>
        <li>
          <strong>OpenAI</strong> — generation of plans, summaries, and drafts, and embeddings for
          vault search. OpenAI receives the content of messages and documents our agents read in
          order to produce them. We use it only under API terms that forbid retention and forbid
          training on your data, as Google&rsquo;s restricted-scope policy requires.
        </li>
        <li>
          <strong>fal.ai</strong> — image, video, and speech generation. It receives the prompts and
          any source images or audio for media you ask us to create.
        </li>
        <li>
          <strong>Alibaba Cloud (Model Studio)</strong> — image and video generation using the WAN
          models. It receives the prompts and source assets for that media. See section 8.
        </li>
        <li>
          <strong>Tavily</strong> — web search, when an agent needs current information. It receives
          the search query, which is screened for personal data before it is sent.
        </li>
      </ul>
      <p>
        Not every provider is involved in every request. Your connected-account providers are used
        only if you connect them; the media and web-search providers are used only when you ask for
        work that needs them.
      </p>
      <p>
        We do not sell personal data, and we do not share it with advertisers or data brokers. We
        may disclose data where required by law, or to establish or defend legal claims.
      </p>

      <h2>8. International transfers</h2>
      <p>
        Most of our providers are established in, or process data in, the United States.{" "}
        <strong>One is not:</strong> media generation on the WAN models is routed to Alibaba Cloud
        Model Studio in <strong>Singapore</strong> (region <code>ap-southeast-1</code>). This
        applies only if you ask Pikar to generate images or video; if you never do, no data reaches
        it.
      </p>
      <p>
        Where personal data is transferred outside the UK or European Economic Area, we rely on the
        European Commission&rsquo;s Standard Contractual Clauses, the UK International Data Transfer
        Addendum, or an adequacy decision, as applicable to each provider. You may request a copy of
        the safeguards in place, including the specific region a provider processes in, by writing
        to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <h2>9. Retention, and the immutable audit archive</h2>
      <p>
        We keep account data and your submitted content for as long as your account is active. You
        may request deletion at any time (section 10); we will action it within one month, as
        required by Article 12(3) GDPR.
      </p>
      <p>
        Audit records are retained as an immutable compliance log.{" "}
        <strong>The application can only ever append to it:</strong> there is no code path in Pikar
        that can modify or delete an audit record. That is the point of the log — the system that
        writes it must not be able to rewrite it.
      </p>
      <p>
        Export of those records to separate write-once archival storage, which not even we could
        alter, is built but is <strong>not currently switched on in this deployment</strong>. Until
        it is, the guarantee above is the application-level one: append-only by design, not yet
        write-once at rest. We will update this section when the archive is enabled rather than
        describe it in advance.
      </p>
      <p>
        For this reason the audit log is designed to hold <strong>{AUDIT_ARCHIVE_STATEMENT}</strong>{" "}
        This is what allows an immutable log and your right to erasure to coexist. Deleting your
        account removes your account data and your content; the audit archive retains only the
        record that actions occurred — never what they contained. Those records still carry your
        account identifier, which we can link back to you. That is why we describe them as holding
        nothing that identifies you directly.
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
        You can disconnect your Microsoft account at any time from within the application. That
        deletes the access and refresh tokens we hold, immediately and permanently.{" "}
        <strong>
          Unlike Google, we cannot revoke the grant at Microsoft on your behalf, and we do not claim
          to.
        </strong>{" "}
        Microsoft offers no per-application revocation that an application can call for its own
        grant — the available mechanisms either require tenant-wide administrative permissions we
        deliberately do not hold, or would sign you out of every Microsoft application rather than
        only this one. So the consent entry remains on your Microsoft account until you remove it
        there. To remove it, visit{" "}
        <a href="https://account.microsoft.com/privacy/app-access" rel="noopener noreferrer">
          account.microsoft.com/privacy/app-access
        </a>{" "}
        for a personal Microsoft account, or{" "}
        <a href="https://myapps.microsoft.com/" rel="noopener noreferrer">
          myapps.microsoft.com
        </a>{" "}
        for a work or school account. When you delete your data, we tell you exactly which of these
        two outcomes each connected account actually reached.
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
