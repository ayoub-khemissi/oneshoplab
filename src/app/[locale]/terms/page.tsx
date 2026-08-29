import { aiSubProcessors } from '@/lib/ai/models';
import { getAppContactEmail } from '@/lib/app-contact';
import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';
import { getTranslations } from 'next-intl/server';
import { SUPPORTED_LOCALES } from '@/i18n/routing';

const SITE_URL = (process.env.APP_URL ?? 'https://oneshoplab.com').replace(/\/$/, '');

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Legal' });
  // Self-referential canonical + reciprocal hreflang — without this the
  // page inherited the root layout's home canonical (the addendum §2
  // anti-pattern). Exists in all 13 locales like the other static pages.
  const languages: Record<string, string> = {};
  for (const loc of SUPPORTED_LOCALES) {
    languages[loc] = `${SITE_URL}/${loc}/terms`;
  }
  languages['x-default'] = `${SITE_URL}/en/terms`;
  return {
    title: t('termsTitle'),
    description: t('termsDescription'),
    alternates: {
      canonical: `${SITE_URL}/${locale}/terms`,
      languages
    },
    // Indexable but low-priority — search engines occasionally surface these
    // as part of the brand SERP, which is fine. Not a primary SEO target.
    robots: { index: true, follow: true }
  };
}

const LAST_UPDATED = 'August 29, 2026';
const CONTACT_EMAIL = getAppContactEmail();
const COMPANY_NAME = 'OneShopLab';
const SERVICE_URL = 'https://oneshoplab.com';
const GOVERNING_LAW = 'French law';
const VENUE = 'the courts of Paris, France';

export default function TermsOfServicePage() {
  return (
    <main className="flex-1 px-4 md:px-10 py-6 md:py-10 max-w-3xl w-full mx-auto">
      <article className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
        <header className="not-prose flex flex-col gap-2 mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
          <p className="text-sm text-[var(--muted)]">
            Last updated: <strong>{LAST_UPDATED}</strong>
          </p>
        </header>

        <p>
          These Terms of Service (the &quot;Terms&quot;) govern your access to and use of the
          website at <a href={SERVICE_URL}>{SERVICE_URL}</a>, the OneShopLab application, its APIs,
          and any related services (collectively, the &quot;Service&quot;) provided by{' '}
          {COMPANY_NAME} (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;). By creating an
          account, signing in, or otherwise using the Service, you (&quot;you&quot; or the
          &quot;User&quot;) agree to be bound by these Terms. If you do not agree, do not use the
          Service.
        </p>

        <h2>1. Eligibility and Account Registration</h2>
        <p>
          You must be at least 18 years old and have the legal capacity to enter into a binding
          contract. If you use the Service on behalf of an entity, you represent that you have
          authority to bind that entity, and &quot;you&quot; refers to that entity. You agree to
          provide accurate, current, and complete information when creating an account, and to keep
          that information up to date. You are responsible for all activity that occurs under your
          account, and for keeping your credentials confidential.
        </p>
        <p>
          You may sign up and sign in either with an email and password you choose, or with your
          Google account via Google Sign-In. If you use Google Sign-In, you also agree to
          Google&apos;s applicable terms; we do not control, and are not responsible for, the
          availability of that third-party service. Our signup page is protected by Google
          reCAPTCHA, and your interaction with the &quot;I&apos;m not a robot&quot; checkbox is
          subject to the Google Privacy Policy and Terms of Service.
        </p>

        <h2>2. Description of the Service</h2>
        <p>
          OneShopLab is a software-as-a-service platform that audits merchant storefronts (Shopify,
          WooCommerce, Wix, and other supported platforms) and uses third-party AI providers to
          generate copy, images, and other optimisations for product pages. The Service consumes
          credits per generation, and credits are granted through subscription plans and one-time
          credit packs as described on the pricing page.
        </p>
        <p>
          We continuously evolve the Service. We may add, change, or remove features at any time at
          our sole discretion. We will not materially reduce paid features mid-subscription-period
          without offering you a pro-rata refund or equivalent compensation.
        </p>

        <h2>3. Subscriptions, Credits, and Billing</h2>
        <p>
          Subscription plans are billed in advance on a recurring basis (monthly or yearly, as you
          select). Yearly subscriptions are discounted relative to twelve monthly subscriptions; the
          exact amount is shown at checkout. All prices are in Euros (€) and excluding any
          applicable taxes, which we will collect when required. Payments are processed by Stripe,
          Inc.; by purchasing a subscription you also agree to Stripe&apos;s terms.
        </p>
        <p>
          Each subscription cycle grants a fixed number of credits to your account, deposited into a
          &quot;Subscription&quot; bucket. At the start of each new billing cycle, the Subscription
          bucket is <strong>reset</strong> to the new period&apos;s allowance: unused credits from
          the previous cycle do <strong>not</strong> carry over. This is clearly disclosed on the
          pricing page and in your account.
        </p>
        <p>
          Credit packs are one-time purchases that add credits to a separate &quot;Pack&quot;
          bucket. Pack credits do <strong>not</strong> expire and are not affected by subscription
          renewals. When you generate content, credits are consumed first from the Subscription
          bucket and then from the Pack bucket, until either runs out.
        </p>
        <p>
          Subscription renewals occur automatically until you cancel. You may cancel at any time
          from the customer portal; cancellations take effect at the end of the current billing
          period and you retain access to paid features until then. We do not refund unused
          subscription credits or remaining time in the current billing period unless required by
          applicable consumer law.
        </p>
        <p>
          Credit packs are non-refundable once the credits have been delivered to your account,
          except where required by applicable law. If a charge succeeds but credits are not
          delivered within 24 hours, contact us at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> for resolution.
        </p>
        <p>
          Failed payments may result in suspension of the Service. We may retry charges and notify
          you. If a payment cannot be collected within a reasonable period, we may downgrade your
          account to the Free plan and your subscription bucket will not be replenished.
        </p>

        <p>
          <strong>Right of withdrawal (consumers).</strong> If you subscribe as a consumer within
          the European Union, you acknowledge that the Service starts immediately after purchase and
          that, by requesting immediate access, you expressly waive your 14-day right of withdrawal
          for the digital content and services already provided, in accordance with applicable
          consumer law. Business customers are not covered by the right of withdrawal.
        </p>
        <p>
          <strong>Generated files retention.</strong> AI-generated images are stored for a period
          that depends on your plan (as displayed in the Service next to each image and on the
          pricing page) and are then deleted automatically; the credits spent on them are not
          refunded on expiry. Content you have applied to a product is copied to that product and
          remains available as long as the product exists.
        </p>
        <p>
          <strong>Failed generations.</strong> When a generation fails for a reason attributable to
          us or to our providers, the credits reserved for it are refunded automatically. We may
          fulfil a generation through an alternative AI provider when our primary provider is
          unavailable; the price in credits shown before the generation applies regardless of the
          provider used.
        </p>

        <h2>4. Free Tier</h2>
        <p>
          The Free plan grants a one-time welcome allowance of credits to your Pack bucket and
          limits the number of stores you can analyse. We may modify the Free plan&apos;s limits at
          any time, including for existing Free users, with reasonable notice.
        </p>

        <h2>5. Acceptable Use</h2>
        <p>You agree not to use the Service to:</p>
        <ul>
          <li>
            Violate any law or regulation, infringe any intellectual property right, or breach any
            third-party agreement;
          </li>
          <li>
            Audit, scrape, or generate content related to a storefront you do not own, operate, or
            have explicit permission to access on behalf of its owner;
          </li>
          <li>
            Generate content that is unlawful, defamatory, deceptive, misleading, hateful,
            harassing, sexually explicit involving minors, or that violates the rights of others;
          </li>
          <li>
            Attempt to reverse-engineer, decompile, or otherwise discover the source code of the
            Service, except to the extent expressly permitted by applicable law;
          </li>
          <li>
            Probe, scan, or test the vulnerability of the Service, or otherwise interfere with its
            integrity, security, or availability;
          </li>
          <li>
            Use automation or bots to circumvent rate limits, credit consumption, or any other
            technical or contractual limitation;
          </li>
          <li>
            Resell or redistribute the Service or its outputs as a competing generative-AI service;
          </li>
          <li>
            Submit personal data of third parties as input prompts unless you have a valid legal
            basis to do so under applicable data protection law.
          </li>
        </ul>
        <p>
          We may suspend or terminate accounts that violate these restrictions, with or without
          notice depending on severity. We may report suspected illegal activity to competent
          authorities.
        </p>

        <h2>6. Your Content</h2>
        <p>
          The Service operates on data you provide or that we collect from your authorised
          storefronts (product titles, descriptions, images, prices, tags, etc.) and on prompts you
          submit (your &quot;Input Content&quot;). You retain all rights, title, and interest in
          your Input Content. You grant us a worldwide, non-exclusive, royalty-free licence to host,
          copy, transmit, process, and display your Input Content solely as necessary to operate,
          maintain, and improve the Service for your benefit.
        </p>
        <p>
          You represent and warrant that you have all rights necessary to submit your Input Content
          to the Service and to authorise the processing described in these Terms and in the Privacy
          Policy.
        </p>

        <h2>7. AI-Generated Output</h2>
        <p>
          Content generated by the Service from your prompts and Input Content (the
          &quot;Output&quot;) is provided to you for use in your business, subject to these Terms.
          As between you and us, you own the Output to the extent permitted by applicable law and by
          our upstream AI providers. <strong>You are responsible</strong> for reviewing the Output
          before publishing it: AI models can make factual errors, hallucinate features, infringe
          third-party rights, or produce content unsuitable for your audience. We make no warranty
          that Output is accurate, original, fit for a particular purpose, non-infringing, or
          compliant with any specific marketing or product-labelling regulation.
        </p>
        <p>
          Output may be similar across users for similar prompts; we do not guarantee the uniqueness
          of Output. Underlying AI providers may retain Output for limited periods to prevent abuse
          and operate their services, as described in our Privacy Policy.
        </p>
        <p>
          You agree not to use Output to train competing generative AI models without our prior
          written consent.
        </p>

        <h2>8. Third-Party AI Providers and Services</h2>
        <p>
          The Service relies on third-party providers, including but not limited to:{' '}
          {aiSubProcessors()
            .map((s) => `${s.entity} (${s.role})`)
            .join('; ')}
          ; Google (Google Sign-In and reCAPTCHA anti-bot verification), Stripe (payments),
          Cloudflare (object storage and DNS), Brevo (transactional email), and OVH (hosting). Their
          availability, pricing, and policies may change. Where their terms flow down to you (for
          example, Stripe&apos;s acceptable-use policy or Google&apos;s reCAPTCHA terms when you
          complete the signup challenge), you agree to comply with them. We are not responsible for
          outages or actions of these providers, but we will use commercially reasonable efforts to
          mitigate their impact on the Service. The list of AI gateways and model providers in use
          at any time, and their roles, is published in our Privacy Policy; we may add, replace or
          use providers as fallbacks without notice when this does not reduce the protection of your
          data.
        </p>

        <h2>9. Intellectual Property</h2>
        <p>
          The Service, its software, design, and all materials we provide (excluding your Input
          Content and the Output as defined above) are owned by us or our licensors and are
          protected by intellectual property laws. We grant you a limited, revocable, non-exclusive,
          non-transferable licence to access and use the Service in accordance with these Terms. No
          other rights are granted by implication, estoppel, or otherwise.
        </p>
        <p>
          &quot;OneShopLab&quot; and our logos are our trademarks. You may not use them without our
          prior written consent.
        </p>

        <h2>10. Termination</h2>
        <p>
          You may terminate your account at any time by cancelling your subscription and ceasing to
          use the Service. We may suspend or terminate your account if we reasonably believe you
          have violated these Terms, used the Service unlawfully, or caused harm to us or a third
          party. Upon termination, your access to the Service ends; we may retain your data as
          described in our Privacy Policy and as required by law. Sections of these Terms that by
          their nature should survive termination will survive (including ownership, disclaimers,
          limitation of liability, indemnification, and governing law).
        </p>

        <h2>11. Disclaimer of Warranties</h2>
        <p>
          THE SERVICE AND THE OUTPUT ARE PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot;,
          WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
          WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT,
          ACCURACY, OR THAT THE SERVICE WILL BE UNINTERRUPTED OR ERROR-FREE. WE DO NOT WARRANT THAT
          THE OUTPUT WILL BE FACTUALLY CORRECT, COMPLY WITH ANY SPECIFIC REGULATION, OR ACHIEVE ANY
          COMMERCIAL RESULT.
        </p>
        <p>
          Some jurisdictions do not allow the exclusion of certain warranties, so some of the above
          exclusions may not apply to you. Where mandatory consumer-protection law applies, those
          rights are not waived by these Terms.
        </p>

        <h2>12. Limitation of Liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT WILL WE OR OUR AFFILIATES
          BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES,
          INCLUDING WITHOUT LIMITATION LOSS OF PROFITS, REVENUE, GOODWILL, USE, DATA, OR OTHER
          INTANGIBLE LOSSES, ARISING OUT OF OR RELATING TO YOUR USE OF, OR INABILITY TO USE, THE
          SERVICE OR THE OUTPUT, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
        </p>
        <p>
          OUR AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE WILL NOT
          EXCEED THE AMOUNTS YOU PAID TO US IN THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING
          RISE TO THE LIABILITY, OR ONE HUNDRED EUROS (€100), WHICHEVER IS GREATER.
        </p>
        <p>
          Nothing in these Terms limits liability that cannot be limited under applicable law
          (including liability for fraud, gross negligence, willful misconduct, or death or personal
          injury caused by negligence).
        </p>

        <h2>13. Indemnification</h2>
        <p>
          You agree to defend, indemnify, and hold harmless {COMPANY_NAME} and its officers,
          directors, employees, and agents from and against any claims, liabilities, damages,
          losses, and expenses (including reasonable attorneys&apos; fees) arising out of or in any
          way connected with: (a) your access to or use of the Service; (b) your Input Content or
          your use of the Output; (c) your violation of these Terms or any applicable law; or (d)
          your violation of any third-party right.
        </p>

        <h2>14. Privacy</h2>
        <p>
          Our collection and use of personal data in connection with the Service is described in our{' '}
          <Link href="/privacy">Privacy Policy</Link>, which is incorporated into these Terms by
          reference.
        </p>

        <h2>15. Changes to the Service or These Terms</h2>
        <p>
          We may modify these Terms from time to time. If we make material changes, we will notify
          you by email or by a notice on the Service before the changes take effect. Your continued
          use of the Service after the effective date constitutes acceptance of the revised Terms.
          If you do not agree, you must stop using the Service before the effective date.
        </p>

        <h2>16. Governing Law and Disputes</h2>
        <p>
          These Terms are governed by {GOVERNING_LAW}, without regard to its conflict-of-laws
          principles. The courts located in {VENUE} have exclusive jurisdiction over any dispute
          arising out of or relating to these Terms or the Service, except that you may bring claims
          in your country of residence where required by applicable law. The parties exclude the
          application of the United Nations Convention on Contracts for the International Sale of
          Goods.
        </p>
        <p>
          For consumers in the European Union, you may also use the European Commission&apos;s
          Online Dispute Resolution platform at{' '}
          <a href="https://ec.europa.eu/consumers/odr" rel="noreferrer noopener" target="_blank">
            ec.europa.eu/consumers/odr
          </a>
          .
        </p>

        <h2>17. Miscellaneous</h2>
        <p>
          These Terms, together with the Privacy Policy and any pricing or plan documents referenced
          on the Service, constitute the entire agreement between you and us regarding the Service.
          If any provision is held unenforceable, the remaining provisions remain in full force and
          effect. Our failure to enforce any right is not a waiver. You may not assign these Terms
          without our prior written consent; we may assign them to an affiliate or in connection
          with a merger, acquisition, or sale of assets.
        </p>

        <h2>18. Contact</h2>
        <p>
          For any question regarding these Terms, contact us at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </article>
    </main>
  );
}
