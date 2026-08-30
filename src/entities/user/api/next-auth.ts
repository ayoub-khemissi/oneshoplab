import { DrizzleAdapter } from '@auth/drizzle-adapter';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import NextAuth, { type DefaultSession, type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { applyCreditTransaction } from '@/entities/credit';
import { SIGNUP_FREE_CREDITS } from '@/entities/ai-model';
import { LEGAL_TERMS_VERSION } from '@/entities/legal-consent';
import { db } from '@/shared/db';
import {
  accounts,
  sessions,
  users,
  verificationTokens,
  type ChatModelDbId,
  type ImageQualityDbId,
  type Plan,
  legalConsents
} from '@/shared/db/schema';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      plan: Plan;
      creditsBalance: number;
      preferredChatModel: ChatModelDbId;
      preferredImageQuality: ImageQualityDbId;
    } & DefaultSession['user'];
  }
}

/**
 * Google OAuth is conditionally registered: if the env vars aren't set
 * (typical in dev / test envs), we skip it instead of throwing on
 * import. The UI uses `isGoogleAuthEnabled()` to decide whether to
 * render the "Sign in with Google" button.
 *
 * `allowDangerousEmailAccountLinking: true` lets a user who already
 * registered with email+password sign in with Google using the same
 * email and end up on the SAME `users` row (the adapter creates a new
 * `accounts` row linking the Google identity). Without this, Auth.js
 * throws OAuthAccountNotLinked and the user is stuck.
 */
const providers: NextAuthConfig['providers'] = [
  Credentials({
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' }
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) return null;
      const email = String(credentials.email).toLowerCase().trim();
      const password = String(credentials.password);

      const user = await db.query.users.findFirst({
        where: eq(users.email, email)
      });
      if (!user?.passwordHash) return null;

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return null;

      return {
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        image: user.image ?? null
      };
    }
  })
];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true
    })
  );
}

export function isGoogleAuthEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens
  }),
  session: { strategy: 'jwt' }, // Credentials provider requires JWT sessions
  pages: {
    signIn: '/login'
  },
  providers,
  events: {
    /**
     * Fires once when the Drizzle adapter creates a fresh user row —
     * which only happens for OAuth signins (the manual signup path
     * inserts directly via db.insert in /signup/page.tsx and skips
     * the adapter). Grants the same SIGNUP_FREE_CREDITS welcome bonus
     * to the pack bucket, idempotency-keyed on the userId so a manual
     * signup followed by a Google link can't double-grant.
     */
    async createUser({ user }) {
      if (!user.id) return;
      try {
        await applyCreditTransaction({
          userId: user.id,
          delta: SIGNUP_FREE_CREDITS,
          bucket: 'pack',
          reason: 'signup_grant',
          idempotencyKey: `grant-signup-${user.id}`
        });
      } catch (e) {
        console.error('[auth] failed to grant signup credits to', user.id, e);
      }
      // Record the click-wrap acceptance shown on the signup form ("By
      // creating an account you accept the Terms and the Privacy
      // Policy") — both credentials and Google signups pass through this
      // event, so this is the single place that captures it.
      try {
        const jar = await cookies();
        await db.insert(legalConsents).values({
          id: randomUUID(),
          userId: user.id,
          kind: 'signup_tos',
          version: LEGAL_TERMS_VERSION,
          source: `user:${user.id}`,
          locale: jar.get('NEXT_LOCALE')?.value ?? null
        });
      } catch (e) {
        console.error('[auth] failed to record signup consent for', user.id, e);
      }
      // Mark a fresh OAuth (Google) signup so the browser can fire the
      // sign_up / CompleteRegistration conversion events. The
      // credentials path carries `?ga=signup` on its redirect, but the
      // Google round-trip lands on a bare /dashboard — this one-shot,
      // JS-readable cookie is the equivalent signal. GaRedirectEvents
      // reads it on the next page, fires the events, and clears it.
      // Short TTL + not httpOnly (the client must read + delete it).
      try {
        const jar = await cookies();
        jar.set('osl_new_signup', '1', {
          maxAge: 300,
          sameSite: 'lax',
          path: '/',
          httpOnly: false
        });
      } catch {
        // cookies() unavailable outside a request context — non-fatal;
        // the credit grant above is the part that must not be skipped.
      }
    }
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token?.id) {
        const u = await db.query.users.findFirst({ where: eq(users.id, String(token.id)) });
        if (u) {
          session.user.id = u.id;
          session.user.email = u.email;
          session.user.name = u.name;
          session.user.image = u.image;
          session.user.plan = u.plan;
          session.user.creditsBalance = u.creditsBalance;
          session.user.preferredChatModel = u.preferredChatModel;
          session.user.preferredImageQuality = u.preferredImageQuality;
        }
      }
      return session;
    }
  },
  trustHost: true
});

// Kept in its own framework-free module so server actions and tests can
// hash passwords without importing next-auth; re-exported for callers.
export { hashPassword } from '../model/password';
