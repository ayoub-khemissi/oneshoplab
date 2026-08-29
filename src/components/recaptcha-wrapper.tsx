'use client';

import { useEffect } from 'react';

interface RecaptchaWrapperProps {
  /** v2 public site key (NEXT_PUBLIC_*). Safe to ship to the client. */
  siteKey: string;
  /** Visual theme of the widget. Defaults to 'light' since the auth
   *  pages have a light card. */
  theme?: 'light' | 'dark';
}

/**
 * Visible reCAPTCHA v2 "I'm not a robot" checkbox. Drops the v3
 * silent score-based flow because v3 false-positives too often on
 * legitimate users (VPN, mobile cellular, privacy-first browsers).
 *
 * The Google widget auto-detects every div.g-recaptcha on the page
 * once the script loads and renders the checkbox into it. On
 * successful challenge, the widget fills a hidden form field named
 * `g-recaptcha-response` with the verification token — our server
 * action then reads that field by name.
 *
 * The script tag loads exactly once per page via useEffect; nothing
 * for the page to do beyond placing this component inside the form.
 */
export function RecaptchaWrapper({ siteKey, theme = 'light' }: RecaptchaWrapperProps) {
  useEffect(() => {
    if (document.querySelector('script[data-recaptcha-v2]')) return;
    const s = document.createElement('script');
    s.src = 'https://www.google.com/recaptcha/api.js';
    s.async = true;
    s.defer = true;
    s.dataset.recaptchaV2 = '1';
    document.head.appendChild(s);
  }, []);

  // Centred so the widget doesn't visually fight the rest of the
  // form fields (Google ships ~304x78px). The g-recaptcha class is
  // the hook the script searches for.
  return (
    <div className="flex justify-center">
      <div className="g-recaptcha" data-sitekey={siteKey} data-theme={theme} />
    </div>
  );
}
