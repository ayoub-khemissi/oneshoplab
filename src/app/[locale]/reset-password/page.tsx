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
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { resetPasswordAction } from '@/lib/password-reset-actions';

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'Auth' });
  return {
    title: t('resetTitle'),
    robots: { index: false, follow: false }
  };
}

interface PageProps {
  searchParams: Promise<{ token?: string; error?: string }>;
}

/**
 * Step 2 of the password reset flow: the user clicked the emailed
 * link and lands here with `?token=…`. We just render the new-password
 * form; the action validates the token before mutating.
 *
 * If the token is missing entirely or invalid, we render an error
 * card pointing back to /forgot-password so the user can request a
 * fresh link.
 */
export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const t = await getTranslations('Auth');

  const token = (params.token ?? '').trim();
  const tokenInvalid = params.error === 'invalid_token' || params.error === 'missing_token' || !token;

  const errorMessage =
    params.error === 'short_password'
      ? t('errorPasswordTooShort')
      : params.error === 'mismatch'
        ? t('errorPasswordMismatch')
        : null;

  if (tokenInvalid) {
    return (
      <main className="flex-1 flex items-center justify-center p-8">
        <Card className="w-full max-w-md">
          <Card.Header>
            <Card.Title>{t('resetTitle')}</Card.Title>
            <Card.Description>{t('resetTokenInvalid')}</Card.Description>
          </Card.Header>
          <Card.Footer className="flex flex-col gap-3 pt-2">
            <Link
              href="/forgot-password"
              className="text-sm text-[var(--accent)] font-medium hover:underline"
            >
              {t('forgotRetry')}
            </Link>
          </Card.Footer>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex-1 flex items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <Card.Header>
          <Card.Title>{t('resetTitle')}</Card.Title>
          <Card.Description>{t('resetSubtitle')}</Card.Description>
        </Card.Header>
        <Form action={resetPasswordAction}>
          <input type="hidden" name="token" value={token} />
          <Card.Content className="flex flex-col gap-5">
            {errorMessage ? (
              <div
                role="alert"
                className="text-sm rounded-md border border-[var(--danger)] bg-[var(--danger)]/10 text-[var(--danger)] px-3 py-2 leading-relaxed"
              >
                {errorMessage}
              </div>
            ) : null}
            <TextField
              fullWidth
              isRequired
              name="password"
              type="password"
              minLength={8}
              autoFocus
              isInvalid={params.error === 'short_password'}
            >
              <Label>{t('newPasswordLabel')}</Label>
              <Input autoComplete="new-password" />
              <Description>{t('passwordHint')}</Description>
              {params.error === 'short_password' && errorMessage ? (
                <FieldError>{errorMessage}</FieldError>
              ) : null}
            </TextField>
            <TextField
              fullWidth
              isRequired
              name="confirm_password"
              type="password"
              minLength={8}
              isInvalid={params.error === 'mismatch'}
            >
              <Label>{t('confirmPasswordLabel')}</Label>
              <Input autoComplete="new-password" />
              {params.error === 'mismatch' && errorMessage ? (
                <FieldError>{errorMessage}</FieldError>
              ) : null}
            </TextField>
          </Card.Content>
          <Card.Footer className="flex flex-col gap-3 pt-2">
            <Button type="submit" variant="primary" size="lg" fullWidth>
              {t('resetSubmit')}
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
      </Card>
    </main>
  );
}
