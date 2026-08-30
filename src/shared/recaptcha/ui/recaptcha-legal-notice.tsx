import { getTranslations } from 'next-intl/server';

/**
 * Legal notice that must accompany any page using a hidden reCAPTCHA
 * badge — Google's branding policy requires either the badge or this
 * text to be visible in the user flow. We hide the badge globally
 * (see globals.css) and render this strip below the form instead.
 *
 * The two anchors point to Google's official Privacy Policy and Terms
 * of Service. Both `next-intl` rich tags resolve to localised link
 * text, with the URLs identical across all 13 locales.
 */
export async function RecaptchaLegalNotice() {
  const t = await getTranslations('Auth');
  return (
    <p className="text-[11px] leading-relaxed text-[var(--muted)] text-center px-4 max-w-md mx-auto">
      {t.rich('recaptchaNotice', {
        privacy: (chunks) => (
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noreferrer noopener"
            className="underline hover:text-[var(--foreground)]"
          >
            {chunks}
          </a>
        ),
        terms: (chunks) => (
          <a
            href="https://policies.google.com/terms"
            target="_blank"
            rel="noreferrer noopener"
            className="underline hover:text-[var(--foreground)]"
          >
            {chunks}
          </a>
        )
      })}
    </p>
  );
}
