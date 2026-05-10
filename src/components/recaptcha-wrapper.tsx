'use client';

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, opts: { action: string }) => Promise<string>;
    };
  }
}

interface RecaptchaWrapperProps {
  /** v3 public site key (NEXT_PUBLIC_*). Safe to ship to the client. */
  siteKey: string;
  /** The "action" label sent to Google. Helps them score by intent
   *  (signup, login, …) and shows up in the admin console. */
  action: string;
  /** Optional — pass to render extra siblings of the hidden input.
   *  Most callers don't need this and just drop the wrapper inside the
   *  form alongside their existing fields. */
  children?: React.ReactNode;
}

/**
 * Silent reCAPTCHA v3 form wrapper. Renders a hidden `recaptcha_token`
 * input inside the parent <form>, then on submit:
 *
 *   1. Cancels the original submit
 *   2. Calls grecaptcha.execute() to fetch a fresh token (~250ms)
 *   3. Writes the token into the hidden input
 *   4. Re-submits the form with `bypass=true` so this handler skips
 *      the second pass and lets the browser deliver the form data
 *      (including the populated token) to the server action.
 *
 * The script tag for grecaptcha loads once per page via useEffect —
 * subsequent <RecaptchaWrapper> mounts on the same page reuse it.
 *
 * If grecaptcha never finishes loading (network blocked, ad-blocker)
 * we still submit, with an empty token. The server-side verifier
 * rejects empty tokens, so the user gets the "captcha failed" error
 * rather than a silently abandoned form.
 */
export function RecaptchaWrapper({ siteKey, action, children }: RecaptchaWrapperProps) {
  const tokenRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.querySelector('script[data-recaptcha-v3]')) return;
    const s = document.createElement('script');
    s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    s.async = true;
    s.defer = true;
    s.dataset.recaptchaV3 = '1';
    document.head.appendChild(s);
  }, [siteKey]);

  useEffect(() => {
    const input = tokenRef.current;
    const form = input?.closest('form');
    if (!form || !input) return;

    let bypass = false;

    const onSubmit = (e: SubmitEvent) => {
      if (bypass) {
        bypass = false;
        return;
      }
      e.preventDefault();
      const g = window.grecaptcha;
      if (!g) {
        // Script blocked / still loading — submit without token, server rejects.
        bypass = true;
        form.requestSubmit();
        return;
      }
      g.ready(() => {
        g.execute(siteKey, { action })
          .then((token) => {
            input.value = token;
            bypass = true;
            form.requestSubmit();
          })
          .catch(() => {
            bypass = true;
            form.requestSubmit();
          });
      });
    };

    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, [siteKey, action]);

  return (
    <>
      <input ref={tokenRef} type="hidden" name="recaptcha_token" />
      {children}
    </>
  );
}
