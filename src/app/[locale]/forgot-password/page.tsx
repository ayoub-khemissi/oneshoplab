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
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requestPasswordResetAction } from '@/lib/password-reset-actions';

export const metadata: Metadata = {
  title: 'Forgot password',
  robots: { index: false, follow: false }
};

interface PageProps {
  searchParams: Promise<{ error?: string; sent?: string }>;
}

/**
 * Step 1 of the password reset flow: type your email, get an emailed
 * link.
 *
 * The page intentionally tells the user "if your email exists in our
 * system, a link has been sent" regardless of whether the email
 * actually matched a row — that's the standard anti-enumeration
 * stance. The user-side UX is the same in both cases (success
 * banner + go-to-login link).
 */
export default async function ForgotPasswordPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const t = await getTranslations('Auth');

  const sent = params.sent === '1';
  const errorMessage =
    params.error === 'invalid_email' ? t('errorInvalidEmail') : null;

  return (
    <main className="flex-1 flex items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <Card.Header>
          <Card.Title>{t('forgotTitle')}</Card.Title>
          <Card.Description>
            {sent ? t('forgotSentSubtitle') : t('forgotSubtitle')}
          </Card.Description>
        </Card.Header>
        {sent ? (
          <Card.Footer className="flex flex-col gap-3 pt-2">
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              {t('forgotSentBody')}
            </p>
            <Link
              href="/login"
              className="text-sm text-[var(--accent)] font-medium hover:underline"
            >
              {t('backToLogin')}
            </Link>
          </Card.Footer>
        ) : (
          <Form action={requestPasswordResetAction}>
            <Card.Content className="flex flex-col gap-5">
              <TextField
                fullWidth
                isRequired
                name="email"
                type="email"
                autoFocus
                isInvalid={Boolean(errorMessage)}
              >
                <Label>{t('emailLabel')}</Label>
                <Input placeholder="you@example.com" autoComplete="email" />
                {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
              </TextField>
            </Card.Content>
            <Card.Footer className="flex flex-col gap-3 pt-2">
              <Button type="submit" variant="primary" size="lg" fullWidth>
                {t('forgotSubmit')}
              </Button>
              <p className="text-sm text-center text-[var(--muted)]">
                <Link
                  href="/login"
                  className="text-[var(--accent)] font-medium hover:underline"
                >
                  {t('backToLogin')}
                </Link>
              </p>
            </Card.Footer>
          </Form>
        )}
      </Card>
    </main>
  );
}
