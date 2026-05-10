import { signIn } from '@/lib/auth';

interface GoogleSignInButtonProps {
  /** Where to land after a successful Google sign-in. Auth.js preserves
   *  this through the OAuth round-trip via the state cookie. */
  redirectTo?: string;
  /** Button copy. Pages pass the locale-correct text (e.g. "Continue
   *  with Google" / "Continuer avec Google"). */
  label: string;
}

/**
 * Server-action-driven Google sign-in button. Used on /login and /signup
 * — the action is the same in both cases (Auth.js opens or links a
 * Google account on its own; the events.createUser hook on auth.ts
 * grants the welcome credits when it's a fresh user).
 *
 * Pure server component: it just renders a <form> whose submit calls
 * `signIn('google')`. No client JS needed for the round-trip.
 */
export function GoogleSignInButton({
  redirectTo = '/dashboard',
  label
}: GoogleSignInButtonProps) {
  async function action() {
    'use server';
    await signIn('google', { redirectTo });
  }
  return (
    <form action={action} className="w-full">
      <button
        type="submit"
        className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-md border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--default)]/40 text-sm font-medium transition-colors"
      >
        <GoogleGlyph />
        {label}
      </button>
    </form>
  );
}

/** Official Google "G" logo, inlined as SVG so we don't ship a brand
 *  asset. The four colours match Google's brand spec. */
function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
