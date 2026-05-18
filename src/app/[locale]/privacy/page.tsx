import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Legal' });
  return {
    title: t('privacyTitle'),
    description: t('privacyDescription'),
    robots: { index: true, follow: true }
  };
}

const LAST_UPDATED = 'May 10, 2026';
const CONTACT_EMAIL = 'contact@oneshoplab.com';
const COMPANY_NAME = 'OneShopLab';
const SERVICE_URL = 'https://oneshoplab.com';

export default function PrivacyPolicyPage() {
  return (
    <main className="flex-1 px-4 md:px-10 py-6 md:py-10 max-w-3xl w-full mx-auto">
      <article className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
        <header className="not-prose flex flex-col gap-2 mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="text-sm text-[var(--muted)]">
            Last updated: <strong>{LAST_UPDATED}</strong>
          </p>
        </header>

        <p>
          This Privacy Policy explains how {COMPANY_NAME} (&quot;we&quot;,
          &quot;our&quot;, or &quot;us&quot;) collects, uses, shares, and
          protects personal data when you use the website at{' '}
          <a href={SERVICE_URL}>{SERVICE_URL}</a> and the OneShopLab
          application (collectively, the &quot;Service&quot;). It applies to
          users in the European Economic Area (EEA), the United Kingdom, and
          worldwide. By using the Service, you acknowledge that you have
          read this Privacy Policy.
        </p>
        <p>
          For the purposes of the EU General Data Protection Regulation
          (&quot;GDPR&quot;) and equivalent local laws, {COMPANY_NAME} is
          the data <strong>controller</strong> for the personal data
          described below.
        </p>

        <h2>1. Data We Collect</h2>

        <h3>1.1 Account data</h3>
        <p>
          When you sign up, we collect your email address, your display
          name (optional), and a hashed password (we never store your
          password in clear). You may alternatively sign in with{' '}
          <strong>Google</strong> via OAuth 2.0; in that case Google
          shares with us the email address, display name, profile
          picture URL, and a Google account identifier under the
          standard OpenID profile scope, and we link them to your
          OneShopLab account. You can stop using Google sign-in at any
          time by setting an OneShopLab password and revoking the
          OneShopLab application from your{' '}
          <a
            href="https://myaccount.google.com/permissions"
            rel="noreferrer noopener"
            target="_blank"
          >
            Google account permissions
          </a>
          .
        </p>

        <h3>1.2 Billing data</h3>
        <p>
          When you subscribe or purchase a credit pack, you provide payment
          information directly to <strong>Stripe, Inc.</strong>, our payment
          processor. We do <strong>not</strong> see or store your full card
          number. We do receive from Stripe a customer identifier, the last
          four digits of your card, the card brand, the country of issue,
          your billing address, and the status of your subscription and
          invoices.
        </p>

        <h3>1.3 Storefront and product data</h3>
        <p>
          When you connect a store, we collect publicly accessible data
          from that store (product titles, descriptions, prices, images,
          tags, vendor, type, URLs), and we may also store the access token
          or API key you provide for authenticated platforms. We use this
          data exclusively to perform audits and AI-powered optimisations
          on your behalf.
        </p>

        <h3>1.4 Generated content</h3>
        <p>
          We store the prompts you enter, the parameters you choose, and
          the AI-generated outputs (titles, descriptions, tags, images),
          together with timestamps and the model used. This is necessary
          to display history, allow re-runs, and operate the Service.
        </p>

        <h3>1.5 Usage and technical data</h3>
        <p>
          We collect technical information about your use of the Service:
          IP address, browser type and version, operating system, device
          type, language, the pages you visit, the actions you perform
          (e.g. starting an audit, generating content), timestamps, and
          referrer URLs. We collect this data through server logs, edge
          logs, and minimal in-app instrumentation.
        </p>

        <h3>1.6 Communications</h3>
        <p>
          When you contact us by email or through a support form, we
          retain your message and our reply, along with any information
          you choose to share.
        </p>

        <h3>1.7 Cookies and similar technologies</h3>
        <p>
          We use a small set of cookies and equivalent local-storage values
          that are <strong>strictly necessary</strong> to operate the
          Service, namely: an authentication cookie that keeps you signed
          in, a CSRF token, a locale cookie that remembers your preferred
          language, a theme cookie that remembers your light/dark choice,
          and an anonymous-audit token that lets first-time visitors run a
          public audit without creating an account.
        </p>
        <p>
          We do <strong>not</strong> currently use third-party advertising
          cookies or third-party analytics that track you across other
          websites. Stripe sets its own cookies on payment pages, governed
          by Stripe&apos;s own policy. Google reCAPTCHA sets its own
          cookies on the signup page (see Section 1.8 below).
        </p>

        <h3>1.8 Anti-bot verification (reCAPTCHA)</h3>
        <p>
          Our signup page is protected by{' '}
          <strong>Google reCAPTCHA v2</strong> (&quot;I&apos;m not a
          robot&quot; checkbox). When you interact with the checkbox,
          your browser sends environmental and behavioural data to
          Google (e.g. mouse movements, IP address, browser/device
          fingerprint, referrer, and reCAPTCHA cookies set on
          <code>google.com</code>). Google uses this data to determine
          whether you are a human and to combat spam and abuse on its
          and our services. We receive only a binary verification token
          which we forward to Google for confirmation; we do not see
          the underlying signals. This processing is governed by the{' '}
          <a
            href="https://policies.google.com/privacy"
            rel="noreferrer noopener"
            target="_blank"
          >
            Google Privacy Policy
          </a>{' '}
          and{' '}
          <a
            href="https://policies.google.com/terms"
            rel="noreferrer noopener"
            target="_blank"
          >
            Google Terms of Service
          </a>
          .
        </p>

        <h2>2. How We Use Your Data</h2>
        <p>We use the categories above to:</p>
        <ul>
          <li>Operate, maintain, and secure the Service;</li>
          <li>
            Authenticate you, manage your account, and provide customer
            support;
          </li>
          <li>
            Run audits and AI generations you request, and store the
            outputs for your access;
          </li>
          <li>
            Bill you for subscriptions and credit packs, prevent fraud,
            and meet our tax and accounting obligations;
          </li>
          <li>
            Send you transactional notifications (e.g. receipts, password
            resets, important Service updates);
          </li>
          <li>
            Improve the Service through aggregated, de-identified usage
            metrics;
          </li>
          <li>
            Comply with legal obligations and respond to lawful requests
            from public authorities.
          </li>
        </ul>

        <h2>3. Legal Bases (GDPR)</h2>
        <p>
          We rely on the following legal bases under Article 6 GDPR to
          process your personal data:
        </p>
        <ul>
          <li>
            <strong>Performance of a contract</strong> — to provide the
            Service you have asked us to deliver (account, audits,
            generations, billing).
          </li>
          <li>
            <strong>Legitimate interests</strong> — to secure the Service,
            prevent abuse, debug and improve the product, and operate our
            business. We balance these against your rights and interests.
          </li>
          <li>
            <strong>Legal obligation</strong> — to comply with tax,
            accounting, anti-fraud, and other applicable laws.
          </li>
          <li>
            <strong>Consent</strong> — for any optional processing that
            requires it (e.g. if we later add marketing emails or
            non-essential cookies). You may withdraw consent at any time;
            this does not affect the lawfulness of prior processing.
          </li>
        </ul>

        <h2>4. Sub-processors and Recipients</h2>
        <p>
          To operate the Service, we share necessary data with carefully
          selected sub-processors. They process personal data on our
          instructions and under contracts that include GDPR-compliant
          safeguards (including Standard Contractual Clauses where the
          processor is outside the EEA).
        </p>
        <table>
          <thead>
            <tr>
              <th>Sub-processor</th>
              <th>Purpose</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>OVH</td>
              <td>Hosting (web server, database)</td>
              <td>France (EU)</td>
            </tr>
            <tr>
              <td>Stripe, Inc.</td>
              <td>Payment processing, fraud prevention</td>
              <td>USA (with EU representative)</td>
            </tr>
            <tr>
              <td>Cloudflare, Inc.</td>
              <td>Object storage (R2) and DNS</td>
              <td>Global (EU edge available)</td>
            </tr>
            <tr>
              <td>kie.ai</td>
              <td>AI gateway, routing prompts to model providers</td>
              <td>USA</td>
            </tr>
            <tr>
              <td>Anthropic, PBC</td>
              <td>Claude (text generation), via kie.ai</td>
              <td>USA</td>
            </tr>
            <tr>
              <td>Google LLC</td>
              <td>
                Gemini (text generation, via kie.ai); Google Sign-In
                (OAuth, optional sign-in method); Google reCAPTCHA
                (anti-bot verification on signup)
              </td>
              <td>USA / EU</td>
            </tr>
            <tr>
              <td>OpenAI, L.L.C.</td>
              <td>gpt-image (image generation), via kie.ai</td>
              <td>USA</td>
            </tr>
            <tr>
              <td>Sendinblue SAS (Brevo)</td>
              <td>Transactional email relay (e.g. password reset)</td>
              <td>France (EU)</td>
            </tr>
            <tr>
              <td>Hostinger / domain registrar</td>
              <td>DNS for the public hostname</td>
              <td>EU</td>
            </tr>
          </tbody>
        </table>
        <p>
          We share with these processors only the minimum data necessary
          for the stated purpose. AI providers receive your prompts and
          the relevant Input Content for the duration of the generation
          and may retain it for limited periods to detect abuse, as
          described in their own policies. We do not sell personal data,
          and we do not share it with third parties for their independent
          marketing purposes.
        </p>

        <h2>5. International Transfers</h2>
        <p>
          Some of our sub-processors are located outside the EEA. When
          transferring personal data internationally, we rely on
          appropriate safeguards under Articles 44-49 GDPR, including the
          European Commission&apos;s Standard Contractual Clauses, on
          adequacy decisions where they apply, and on additional technical
          and organisational measures (encryption in transit and at rest,
          minimisation of identifiers in prompts).
        </p>

        <h2>6. Data Retention</h2>
        <p>
          We keep personal data only as long as necessary for the purposes
          described above and to comply with legal obligations:
        </p>
        <ul>
          <li>
            <strong>Account data</strong>: as long as your account is
            active. After deletion, residual records may persist in
            backups for up to 90 days.
          </li>
          <li>
            <strong>Storefront, prompts, and generated content</strong>:
            as long as the corresponding project exists in your account,
            or until you delete it.
          </li>
          <li>
            <strong>Billing records</strong>: up to 10 years, as required
            by French commercial and tax law.
          </li>
          <li>
            <strong>Server and security logs</strong>: typically 30-90
            days, longer if retained for security incident investigation.
          </li>
          <li>
            <strong>Anonymous audit data</strong>: associated with an
            anonymous cookie token; retained until expiry of that token
            (currently 90 days).
          </li>
        </ul>
        <p>
          When we no longer need personal data, we delete or anonymise it.
        </p>

        <h2>7. Your Rights</h2>
        <p>
          Subject to applicable law, you have the right to:
        </p>
        <ul>
          <li>
            <strong>Access</strong> the personal data we hold about you and
            obtain a copy;
          </li>
          <li>
            <strong>Rectify</strong> inaccurate or incomplete personal
            data;
          </li>
          <li>
            <strong>Erase</strong> your personal data (the &quot;right to
            be forgotten&quot;), subject to retention obligations;
          </li>
          <li>
            <strong>Restrict</strong> or <strong>object to</strong>{' '}
            processing in certain situations, including where we rely on
            legitimate interests;
          </li>
          <li>
            <strong>Portability</strong> — receive your personal data in a
            structured, machine-readable format, and transmit it to
            another controller;
          </li>
          <li>
            <strong>Withdraw consent</strong> at any time where processing
            is based on consent;
          </li>
          <li>
            <strong>Lodge a complaint</strong> with your supervisory
            authority. In France, this is the Commission Nationale de
            l&apos;Informatique et des Libertés (CNIL),{' '}
            <a
              href="https://www.cnil.fr/"
              rel="noreferrer noopener"
              target="_blank"
            >
              www.cnil.fr
            </a>
            .
          </li>
        </ul>
        <p>
          To exercise these rights, email us at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We will
          respond within one month, extendable by two further months for
          complex requests.
        </p>

        <h2>8. Security</h2>
        <p>
          We use industry-standard security measures to protect your data,
          including TLS encryption in transit, encryption at rest for
          sensitive fields, hashed passwords (bcrypt), strict access
          controls, sub-processor due diligence, and regular dependency
          updates. No system is perfectly secure: we encourage you to use
          a strong unique password, enable two-factor authentication where
          available, and report any suspected security issue to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>

        <h2>9. AI-Specific Disclosures</h2>
        <p>
          The Service routes your prompts and selected Input Content to
          third-party AI providers (currently kie.ai, which proxies to
          Anthropic, Google, and OpenAI). Those providers process your
          input to generate the requested output. Per our agreements with
          these providers and their public policies:
        </p>
        <ul>
          <li>
            Your prompts and Input Content are <strong>not</strong> used to
            train their general-purpose models without explicit opt-in;
          </li>
          <li>
            They may retain prompts and outputs for limited periods (up to
            30 days for most providers) for safety and abuse prevention;
          </li>
          <li>
            We minimise the personal data sent to AI providers; we do not
            send account identifiers, billing data, or unrelated user
            information.
          </li>
        </ul>
        <p>
          You should avoid pasting sensitive personal data of third
          parties (e.g. customer names, emails) into prompts unless you
          have a valid legal basis to do so.
        </p>

        <h2>10. Children</h2>
        <p>
          The Service is not directed to individuals under 16 years of
          age, and we do not knowingly collect personal data from
          children. If you believe a child has provided us with personal
          data, contact us and we will take appropriate steps to delete
          it.
        </p>

        <h2>11. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. When we
          make material changes, we will notify you by email or through a
          notice on the Service before the changes take effect. The
          &quot;Last updated&quot; date at the top of this page indicates
          the latest revision.
        </p>

        <h2>12. Contact</h2>
        <p>
          For any privacy-related question or to exercise your rights,
          contact us at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </article>
    </main>
  );
}
