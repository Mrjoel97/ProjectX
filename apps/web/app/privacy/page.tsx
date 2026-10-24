import { AUDIT_ARCHIVE_STATEMENT } from "@pikar/core/tenantData";
import type { Metadata } from "next";
import {
  CONTACT,
  EFFECTIVE,
  ENTITY,
  ENTITY_ADDRESS,
  HAS_PLACEHOLDERS,
  LEGAL_REVIEW_DEFERRED,
  OPERATING_COUNTRY,
  OWNER_APPROVED_PUBLICATION,
  OWNER_REVIEWED_DATE,
  SITE,
} from "../legal";

export const metadata: Metadata = {
  title: "Privacy Policy — Pikar AI",
  description:
    "How Pikar AI collects, uses, stores, shares, and protects personal data, including Google user data obtained through the gmail.modify, calendar and drive.readonly scopes, Microsoft and connected social account data, and your privacy controls.",
  alternates: { canonical: `${SITE}/privacy` },
};

export default function Privacy() {
  return (
    <main className="prose">
      <h1>Privacy Policy</h1>
      <p className="updated">Effective {EFFECTIVE}</p>

      {HAS_PLACEHOLDERS || LEGAL_REVIEW_DEFERRED || !OWNER_APPROVED_PUBLICATION ? (
        <p className="notice">
          <strong>Draft — not yet in force.</strong> Publication approval is pending or deferred, or
          identifying details remain unresolved.
        </p>
      ) : (
        <p className="updated">Published with owner approval on {OWNER_REVIEWED_DATE}.</p>
      )}

      <h2>1. Who we are</h2>
      <p>
        Pikar AI (&ldquo;Pikar&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) provides a governed AI
        assistant, operated from {OPERATING_COUNTRY}, that plans and carries out tasks you ask for,
        including sending email on your behalf after you have reviewed and approved it.
      </p>
      <p>
        The <strong>data controller</strong> for the purposes of the UK and EU General Data
        Protection Regulation (&ldquo;GDPR&rdquo;) is {ENTITY}, of {ENTITY_ADDRESS}. You can reach
        us about anything in this policy at <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
      <p>
        We have not appointed a Data Protection Officer. Privacy enquiries can be sent to{" "}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
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
          <strong>To connect the external accounts you choose</strong> — performance of a contract
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
        For the Google mailbox, calendar and Drive connection, Pikar requests these four scopes in a
        single consent. Signing in or separately connecting YouTube does not grant these mailbox
        permissions:
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
          <strong>You approve actions that require approval.</strong> Pikar may plan, read
          authorised context and prepare drafts before asking you to approve a plan. Sending an
          email from your connected mailbox requires approval of the saved plan. You are notified as
          approved work proceeds and can stop a running automation.
        </li>
        <li>
          <strong>What we do with message content.</strong> We read messages to understand context,
          to draft replies, and to carry out the work you approved. Message content is processed for
          that purpose and is not retained beyond what is needed to do it.
        </li>
        <li>
          <strong>It reaches our AI providers.</strong> To draft, summarise, or search your vault,
          content may be sent to the model and embedding services selected by the configured route,
          including OpenRouter and its upstream providers. Section 7 describes these services.
          Retention and training controls depend on the selected route and approved account
          settings; API access alone does not establish those controls.
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

      <h2 id="social-accounts">4a. Direct social account connections</h2>
      <p>
        You choose whether to connect Facebook Pages, linked professional Instagram accounts, TikTok
        or YouTube. These connections are separate from Google mailbox, calendar and Drive access.
        Each customer connects their own accounts; another customer does not receive your
        connection. You also select which available accounts your workspace may use.
      </p>
      <ul>
        <li>
          <strong>Meta.</strong> Basic Facebook identity, a list of authorised Pages and their
          linked professional Instagram accounts, and recent content from selected accounts.
          Publishing additionally needs Page-post or Instagram-publishing permission.
        </li>
        <li>
          <strong>TikTok.</strong> Basic profile information identifies the connected creator.
          Reading recent public videos needs additional video-list permission. Direct posting needs
          separate publishing permission.
        </li>
        <li>
          <strong>YouTube.</strong> Read-only access identifies your channel and reads recent video
          information through YouTube API Services. Uploading needs an additional upload permission.
          Offline access allows token renewal without asking you to sign in for each action.
        </li>
      </ul>
      <p>
        The connection screen shows available capabilities and any additional permission needed. A
        connected account does not mean publishing is enabled: availability depends on platform
        qualification and the features enabled for your workspace. For direct publishing, you review
        and approve the saved post, destination, media and visibility before submission. The agent
        can prepare drafts; a general automation approval does not replace this post approval. These
        direct connections do not provide messaging, advertising or ad spending.
      </p>
      <p>
        We store encrypted access and refresh grants, account identifiers and names, your account
        selection, and saved post drafts, uploaded media and publication status in our backend,
        scoped to your workspace. Credentials are used by server-side integrations rather than
        supplied to the agent as conversation text. Recent-content reads do not keep a separate
        cached feed. YouTube API-derived account and video reads are currently unavailable to
        agents. Other connected content used in an agent conversation, and original content you
        provide or save, can remain in workspace history under section 9.
      </p>
      <p>
        We use this information to show your accounts and recent content, prepare the work you
        request and submit the posts you approve. Information needed for an agent task may be sent
        to the AI providers described in section 7. An approved publication sends its media and
        metadata to the selected social platform, where your visibility choice and that
        platform&rsquo;s rules apply. We do not sell social account data or use it to train
        generalised AI models.
      </p>
      <p>
        <strong>Disconnecting removes Pikar access.</strong> Disconnect removes Pikar&rsquo;s stored
        credentials and pending connection grants. For YouTube, Pikar also immediately requests
        revocation from Google and schedules removal of API-derived account and post metadata.
        Google revocation affects the permissions granted by your Google account to all clients in
        the same Google project, so other Google integrations may need reconnection. The screen asks
        you to confirm this effect and reports whether Google confirmed revocation. If confirmation
        fails, Pikar access stays removed and the screen links to Google&rsquo;s manual revocation
        controls. Other providers require the separate revocation controls below. Disconnect does
        not remove published posts or your original drafts and uploads. Use data export and account
        erasure, or contact us under section 10, for retained Pikar data; section 9 explains
        audit-record limits.
      </p>
      <ul>
        <li>
          Revoke YouTube access in your{" "}
          <a href="https://myaccount.google.com/permissions" rel="noopener noreferrer">
            Google Account connections
          </a>
          . Google&rsquo;s handling of data is described in its{" "}
          <a href="https://policies.google.com/privacy" rel="noopener noreferrer">
            Privacy Policy
          </a>
          .
        </li>
        <li>
          Remove the Meta connection in Facebook&rsquo;s{" "}
          <a href="https://www.facebook.com/settings?tab=business_tools" rel="noopener noreferrer">
            Business integrations settings
          </a>
          .
        </li>
        <li>
          In TikTok, open Settings and privacy, then Security &amp; permissions, Manage app
          permissions, select Pikar and remove access. See{" "}
          <a href="https://support.tiktok.com/en/" rel="noopener noreferrer">
            TikTok Support
          </a>{" "}
          if the menu names differ for your app version.
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
        Pikar uses AI models to plan tasks, read context, and draft content, and it then carries
        that work out autonomously. This is the point of the product. We want you to understand
        precisely where the human sits.
      </p>
      <p>
        <strong>Approval applies to the actions you are asked to review.</strong> Planning,
        authorised context reads and draft preparation can happen before final approval. Sending
        email on your behalf and publishing a saved social post require their explicit approvals.
        Individual steps within an approved plan can then run automatically under the applicable
        guardrails. You are notified as approved work proceeds and can halt a running automation.
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
        We use external services to operate the features described below. The data sent depends on
        the feature and configured provider route. Applicable processor terms and data controls
        require verification for each enabled service.
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
          reading Drive files, via Google&rsquo;s APIs; and YouTube channel reading or approved
          uploads when separately connected. Separately, as an <strong>AI provider</strong>: Google
          models can receive content when a Google AI route is selected. The current vault embedding
          route uses the OpenAI model described below through OpenRouter.
        </li>
        <li>
          <strong>Microsoft</strong> — reading and writing your Outlook calendar, via the Microsoft
          Graph API, if you connect a Microsoft account.
        </li>
        <li>
          <strong>OpenAI</strong> — generation of plans, summaries and drafts when an OpenAI model
          route is selected. The current vault embedding route selects OpenAI&rsquo;s
          text-embedding-3-small through OpenRouter. These requests can include the content of
          messages and documents needed for the task. API data is not used for training by default.
          Retention depends on the endpoint and approved account controls; API access alone does not
          establish Zero Data Retention. See OpenAI&rsquo;s{" "}
          <a href="https://developers.openai.com/api/docs/guides/your-data">
            data controls documentation
          </a>
          . Our provider qualification must verify the applicable controls before treating a route
          as approved for restricted connected-account data.
        </li>
        <li>
          <strong>OpenRouter</strong> — routing model and embedding requests to selected providers.
          The current application also sends new image, video, speech-generation and
          file-transcription requests through OpenRouter. It receives the prompts and source content
          needed for those requests. Its terms and the selected upstream provider&rsquo;s controls
          require separate review.
        </li>
        <li>
          <strong>Resend</strong> — delivering account verification and password recovery emails,
          including the destination email address and one-time code.
        </li>
        <li>
          <strong>Alibaba Cloud (Model Studio)</strong> — a retained WAN integration can check and
          retrieve results for previously submitted jobs. It does not submit new generation
          requests. See section 8.
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

      <p>
        Meta and TikTok also receive connection requests and, when you approve a publication, the
        content needed to publish to your selected account. These platforms and YouTube apply their
        own terms and privacy policies to information they receive.
      </p>

      <h2>8. International transfers</h2>
      <p>
        Processing locations depend on the enabled service, provider route and account
        configuration. New media-generation requests currently use OpenRouter. The retained Alibaba
        Cloud WAN integration only checks and retrieves results for older jobs, using its configured
        endpoint. Applicable processing regions and transfer arrangements remain subject to
        confirmation.
      </p>
      <p>
        We have not confirmed the contractual transfer safeguards for every enabled provider route.
        The applicable terms and any Standard Contractual Clauses, UK International Data Transfer
        Addendum or adequacy basis require verification for the specific service and processing
        location. You can request the information currently available by writing to{" "}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <h2>9. Retention, and the immutable audit archive</h2>
      <p>
        We keep account data and your submitted content for as long as your account is active. You
        may request deletion at any time (section 10); we will action it within one month, as
        required by Article 12(3) GDPR.
      </p>
      <p>
        Account access ends during erasure. Removal of search copies can continue in the background
        after the account-closed message appears. That message does not confirm that background
        removal has finished; contact us for confirmation of completion.
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
        You can disconnect your Google mailbox connection from within the application, or revoke
        access directly at{" "}
        <a href="https://myaccount.google.com/permissions" rel="noopener noreferrer">
          myaccount.google.com/permissions
        </a>
        . For requests made through Pikar, removing the stored token and revoking access at Google
        are distinct outcomes. Follow the app&rsquo;s status message. If Google revocation is not
        confirmed or the request fails, check the connection status and use Google&rsquo;s account
        controls to complete revocation.
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
        authority. Where the GDPR applies, you may lodge a complaint under{" "}
        <a href="https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679">
          Article 77
        </a>
        , including with an authority in the Member State where you usually live or work, or where
        the alleged infringement occurred.
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
