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
import { AuthError } from 'next-auth';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { Link } from '@/i18n/navigation';
import { SIGNUP_FREE_CREDITS } from '@/lib/ai';
import { claimAnonAudits, clearAnonToken, getAnonToken } from '@/lib/anon';
import { hashPassword, signIn } from '@/lib/auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';

interface PageProps {
  searchParams: Promise<{ error?: string; audit?: string; next?: string }>;
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

  const carry = new URLSearchParams();
  if (audit) carry.set('audit', audit);
  if (next) carry.set('next', next);
  const carryQs = carry.toString() ? `&${carry.toString()}` : '';

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
  await db.insert(users).values({
    id: userId,
    email,
    name,
    passwordHash,
    creditsBalance: SIGNUP_FREE_CREDITS,
    plan: 'free'
  });

  const anonToken = await getAnonToken();
  if (anonToken) {
    await claimAnonAudits(userId, anonToken);
    await clearAnonToken();
  }

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
  const emailError = params.error === 'email_taken' || params.error === 'invalid_email';
  const passwordError = params.error === 'short_password';

  const errorMessage =
    params.error === 'email_taken'
      ? t('errorEmailTaken')
      : params.error === 'short_password'
        ? t('errorPasswordTooShort')
        : params.error === 'invalid_email'
          ? t('errorInvalidEmail')
          : params.error
            ? t('errorGeneric')
            : null;

  return (
    <main className="flex-1 flex items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <Card.Header>
          <Card.Title>{t('signupTitle')}</Card.Title>
          <Card.Description>{t('signupSubtitle')}</Card.Description>
        </Card.Header>
        <Form action={signupAction}>
          <input type="hidden" name="audit" value={auditParam} />
          <input type="hidden" name="next" value={nextParam} />
          <Card.Content className="flex flex-col gap-5">
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
          </Card.Content>
          <Card.Footer className="flex flex-col gap-4 pt-2">
            <Button type="submit" variant="primary" size="lg" fullWidth>
              {t('signupButton')}
            </Button>
            <p className="text-sm text-center text-[var(--muted)]">
              {t('switchToLogin')}{' '}
              <Link
                href={
                  auditParam
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
          </Card.Footer>
        </Form>
      </Card>
    </main>
  );
}
