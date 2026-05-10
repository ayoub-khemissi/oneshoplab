import {
  Button,
  Card,
  FieldError,
  Form,
  Input,
  Label,
  TextField
} from '@heroui/react';
import type { Metadata } from 'next';
import { AuthError } from 'next-auth';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { GoogleSignInButton } from '@/components/google-signin-button';
import { isGoogleAuthEnabled, signIn } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false }
};

interface PageProps {
  searchParams: Promise<{ error?: string; audit?: string; next?: string; reset?: string }>;
}

async function loginAction(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '')
    .toLowerCase()
    .trim();
  const password = String(formData.get('password') ?? '');
  const audit = String(formData.get('audit') ?? '').trim();
  const next = String(formData.get('next') ?? '').trim();

  // Priority: explicit `next` > resume audit > dashboard.
  let redirectTo = '/dashboard';
  if (next && next.startsWith('/')) {
    redirectTo = next;
  } else if (audit) {
    redirectTo = `/?audit=${encodeURIComponent(audit)}`;
  }

  try {
    await signIn('credentials', { email, password, redirectTo });
  } catch (err) {
    if (err instanceof AuthError) {
      const params = new URLSearchParams({ error: 'credentials' });
      if (audit) params.set('audit', audit);
      if (next) params.set('next', next);
      redirect(`/login?${params.toString()}`);
    }
    throw err;
  }
}

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const t = await getTranslations('Auth');

  const auditParam = params.audit ?? '';
  const nextParam = params.next ?? '';
  const justReset = params.reset === '1';

  const errorMessage =
    params.error === 'credentials'
      ? t('errorInvalidCredentials')
      : params.error
        ? t('errorGeneric')
        : null;

  return (
    <main className="flex-1 flex items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <Card.Header>
          <Card.Title>{t('loginTitle')}</Card.Title>
          <Card.Description>
            {justReset ? t('resetSuccessSubtitle') : t('loginSubtitle')}
          </Card.Description>
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
        <Form action={loginAction}>
          <input type="hidden" name="audit" value={auditParam} />
          <input type="hidden" name="next" value={nextParam} />
          <Card.Content className="flex flex-col gap-5">
            {errorMessage ? (
              <div
                role="alert"
                className="text-sm rounded-md border border-[var(--danger)] bg-[var(--danger)]/10 text-[var(--danger)] px-3 py-2 leading-relaxed"
              >
                {errorMessage}
              </div>
            ) : null}
            <TextField fullWidth isRequired name="email" type="email" autoFocus>
              <Label>{t('emailLabel')}</Label>
              <Input placeholder="you@example.com" autoComplete="email" />
            </TextField>
            <TextField
              fullWidth
              isRequired
              name="password"
              type="password"
              isInvalid={Boolean(errorMessage)}
            >
              <Label>{t('passwordLabel')}</Label>
              <Input autoComplete="current-password" />
              {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
            </TextField>
          </Card.Content>
          <Card.Footer className="flex flex-col gap-4 pt-2">
            <Button type="submit" variant="primary" size="lg" fullWidth>
              {t('loginButton')}
            </Button>
            <p className="text-sm text-center text-[var(--muted)]">
              <Link
                href="/forgot-password"
                className="text-[var(--accent)] font-medium hover:underline"
              >
                {t('forgotLink')}
              </Link>
            </p>
            <p className="text-sm text-center text-[var(--muted)]">
              {t('switchToSignup')}{' '}
              <Link
                href={
                  auditParam
                    ? `/signup?audit=${encodeURIComponent(auditParam)}`
                    : nextParam
                      ? `/signup?next=${encodeURIComponent(nextParam)}`
                      : '/signup'
                }
                className="text-[var(--accent)] font-medium hover:underline"
              >
                {t('createAccountLink')}
              </Link>
            </p>
          </Card.Footer>
        </Form>
      </Card>
    </main>
  );
}
