import {
  Button,
  Card,
  Description,
  FieldError,
  Form,
  Input,
  Label,
  TextField
} from '@heroui/react';
import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { AuthError } from 'next-auth';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { Link } from '@/i18n/navigation';

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Auth' });
  return {
    title: t('signupTitle'),
    robots: { index: false, follow: false }
  };
}
import { GoogleSignInButton } from '@/components/google-signin-button';
import { RecaptchaLegalNotice } from '@/components/recaptcha-legal-notice';
import { RecaptchaWrapper } from '@/components/recaptcha-wrapper';
import { SIGNUP_FREE_CREDITS } from '@/lib/ai';
import {
  claimAnonAudits,
  claimAuditByToken,
  clearAnonToken,
  getAnonToken
} from '@/lib/anon';
import { hashPassword, isGoogleAuthEnabled, signIn } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { isRecaptchaEnabled, verifyRecaptcha } from '@/lib/recaptcha';

interface PageProps {
  searchParams: Promise<{
    error?: string;
    audit?: string;
    next?: string;
    /** Cold-outreach hand-off: a specific anon audit token to bind to
     *  the new account on signup. Distinct from `audit` (which carries
     *  a URL to re-audit on the homepage). */
    claim?: string;
  }>;
}

async function signupAction(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '')
    .toLowerCase()
    .trim();
  const password = String(formData.get('password') ?? '');
  const name = String(formData.get('name') ?? '').trim() || null;
  const audit = String(formData.get('audit') ?? '').trim();
  const next = String(formData.get('next') ?? '').trim();
  const claim = String(formData.get('claim') ?? '').trim();
  // reCAPTCHA v2 widget fills `g-recaptcha-response`; older v3 sites
  // used `recaptcha_token`. Read both so swapping the keys doesn't
  // require touching server code.
  const recaptchaToken =
    String(formData.get('g-recaptcha-response') ?? '') ||
    String(formData.get('recaptcha_token') ?? '');

  const carry = new URLSearchParams();
  if (audit) carry.set('audit', audit);
  if (next) carry.set('next', next);
  if (claim) carry.set('claim', claim);
  const carryQs = carry.toString() ? `&${carry.toString()}` : '';

  // reCAPTCHA v2 challenge. The user has to actively click the
  // checkbox before the widget supplies a token, so unlike v3 there's
  // no false-positive on legitimate users with low score. Falls
  // through (ok: true) when no secret env is set (dev).
  const captcha = await verifyRecaptcha(recaptchaToken);
  if (!captcha.ok) {
    redirect(`/signup?error=captcha${carryQs}`);
  }

  if (!email.includes('@') || email.length < 3) {
    redirect(`/signup?error=invalid_email${carryQs}`);
  }
  if (password.length < 8) {
    redirect(`/signup?error=short_password${carryQs}`);
  }

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (existing) {
    redirect(`/signup?error=email_taken${carryQs}`);
  }

  const userId = randomUUID();
  const passwordHash = await hashPassword(password);
  // Free tier signup grant lands in the pack bucket — it's a one-shot
  // never-expire welcome, not a renewable subscription allowance.
  await db.insert(users).values({
    id: userId,
    email,
    name,
    passwordHash,
    creditsBalance: SIGNUP_FREE_CREDITS,
    creditsBalancePack: SIGNUP_FREE_CREDITS,
    plan: 'free'
  });

  const anonToken = await getAnonToken();
  if (anonToken) {
    await claimAnonAudits(userId, anonToken);
    await clearAnonToken();
  }

  // Cold-outreach flow: prospect landed on /audit/<token> from an
  // email, clicked signup, and we passed the audit token through as
  // `claim`. Bind that specific audit to the new account as a project
  // so they don't have to re-run it.
  let claimedProjectId: string | null = null;
  if (claim) {
    const r = await claimAuditByToken(userId, claim);
    claimedProjectId = r.projectId;
  }

  // Priority: explicit `next` > claimed project > resume audit > dashboard.
  let redirectTo = '/dashboard';
  if (next && next.startsWith('/')) {
    redirectTo = next;
  } else if (claimedProjectId) {
    redirectTo = `/dashboard/sites/${claimedProjectId}`;
  } else if (audit) {
    redirectTo = `/?audit=${encodeURIComponent(audit)}`;
  }
  // GA4 conversion marker — GaRedirectEvents fires `sign_up` then strips it.
  redirectTo += `${redirectTo.includes('?') ? '&' : '?'}ga=signup`;

  try {
    await signIn('credentials', { email, password, redirectTo });
  } catch (err) {
    if (err instanceof AuthError) {
      redirect(`/login?error=credentials${carryQs}`);
    }
    throw err;
  }
}

export default async function SignupPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const t = await getTranslations('Auth');

  const auditParam = params.audit ?? '';
  const nextParam = params.next ?? '';
  const claimParam = params.claim ?? '';
  const emailError = params.error === 'email_taken' || params.error === 'invalid_email';
  const passwordError = params.error === 'short_password';

  const errorMessage =
    params.error === 'email_taken'
      ? t('errorEmailTaken')
      : params.error === 'short_password'
        ? t('errorPasswordTooShort')
        : params.error === 'invalid_email'
          ? t('errorInvalidEmail')
          : params.error === 'captcha'
            ? t('errorCaptcha')
            : params.error
              ? t('errorGeneric')
              : null;
  const recaptchaSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  const recaptchaOn = isRecaptchaEnabled() && Boolean(recaptchaSiteKey);

  return (
    <main className="flex-1 flex items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <Card.Header>
          <Card.Title>{t('signupTitle')}</Card.Title>
          <Card.Description>{t('signupSubtitle')}</Card.Description>
        </Card.Header>
        {isGoogleAuthEnabled() ? (
          <Card.Content className="flex flex-col gap-3 pt-0">
            <GoogleSignInButton
              redirectTo={nextParam && nextParam.startsWith('/') ? nextParam : '/dashboard'}
              label={t('continueWithGoogle')}
            />
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider font-mono text-[var(--muted)]">
              <span className="flex-1 h-px bg-[var(--border)]" />
              {t('orSeparator')}
              <span className="flex-1 h-px bg-[var(--border)]" />
            </div>
          </Card.Content>
        ) : null}
        <Form action={signupAction}>
          <input type="hidden" name="audit" value={auditParam} />
          <input type="hidden" name="next" value={nextParam} />
          <input type="hidden" name="claim" value={claimParam} />
          <Card.Content className="flex flex-col gap-5">
            {errorMessage ? (
              <div
                role="alert"
                className="text-sm rounded-md border border-[var(--danger)] bg-[var(--danger)]/10 text-[var(--danger)] px-3 py-2 leading-relaxed"
              >
                {errorMessage}
              </div>
            ) : null}
            <TextField fullWidth name="name" type="text" autoFocus>
              <Label>{t('nameLabel')}</Label>
              <Input placeholder="Jane Doe" autoComplete="name" />
            </TextField>
            <TextField
              fullWidth
              isRequired
              name="email"
              type="email"
              isInvalid={emailError}
            >
              <Label>{t('emailLabel')}</Label>
              <Input placeholder="you@example.com" autoComplete="email" />
              {emailError && errorMessage ? (
                <FieldError>{errorMessage}</FieldError>
              ) : null}
            </TextField>
            <TextField
              fullWidth
              isRequired
              name="password"
              type="password"
              minLength={8}
              isInvalid={passwordError}
            >
              <Label>{t('passwordLabel')}</Label>
              <Input autoComplete="new-password" />
              <Description>{t('passwordHint')}</Description>
              {passwordError && errorMessage ? (
                <FieldError>{errorMessage}</FieldError>
              ) : null}
            </TextField>
            {recaptchaOn ? <RecaptchaWrapper siteKey={recaptchaSiteKey!} /> : null}
          </Card.Content>
          <Card.Footer className="flex flex-col gap-4 pt-2">
            {/* Click-wrap: the notice sits directly above the action it
                binds, with the two documents one tap away. The acceptance
                itself is recorded server-side on account creation. */}
            <p className="text-xs text-center text-[var(--muted)] leading-relaxed">
              {t.rich('termsNotice', {
                terms: (chunks) => (
                  <Link href="/terms" className="underline underline-offset-2 hover:text-[var(--foreground)]">
                    {chunks}
                  </Link>
                ),
                privacy: (chunks) => (
                  <Link href="/privacy" className="underline underline-offset-2 hover:text-[var(--foreground)]">
                    {chunks}
                  </Link>
                )
              })}
            </p>
            <Button type="submit" variant="primary" size="lg" fullWidth>
              {t('signupButton')}
            </Button>
            <p className="text-sm text-center text-[var(--muted)]">
              {t('switchToLogin')}{' '}
              <Link
                href={
                  claimParam
                    ? `/login?claim=${encodeURIComponent(claimParam)}`
                    : auditParam
                      ? `/login?audit=${encodeURIComponent(auditParam)}`
                      : nextParam
                        ? `/login?next=${encodeURIComponent(nextParam)}`
                        : '/login'
                }
                className="text-[var(--accent)] font-medium hover:underline"
              >
                {t('loginLink')}
              </Link>
            </p>
            {recaptchaOn ? <RecaptchaLegalNotice /> : null}
          </Card.Footer>
        </Form>
      </Card>
    </main>
  );
}
