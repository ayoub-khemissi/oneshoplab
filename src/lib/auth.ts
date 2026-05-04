import { DrizzleAdapter } from '@auth/drizzle-adapter';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { db } from './db';
import {
  accounts,
  sessions,
  users,
  verificationTokens,
  type ChatModelDbId,
  type ImageQualityDbId,
  type Plan
} from './db/schema';

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
  providers: [
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
  ],
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

/** Hash a plaintext password for storage. cost factor 12 ≈ ~250ms on modern CPUs. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
