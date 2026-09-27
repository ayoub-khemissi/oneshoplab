import { Loader2 } from 'lucide-react';

/** The embedded home's building blocks: plain elements, styled like the admin around them. */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">{children}</main>
  );
}

export function Card({
  children,
  className = ''
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm md:p-5 ${className}`}
    >
      {children}
    </section>
  );
}

export function Stat({
  icon,
  label,
  children
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-white p-3 shadow-sm">
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
        {icon}
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums">{children}</span>
    </div>
  );
}

export function Button({
  children,
  onClick,
  primary = false,
  busy = false,
  disabled = false
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={`inline-flex items-center justify-center gap-2 self-start rounded-lg px-4 py-2 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-60 ${
        primary
          ? 'bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90'
          : 'border border-[var(--border)] bg-white text-[var(--foreground)] hover:bg-[var(--default)]'
      }`}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Logo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/osl-dark.svg"
      alt="OneShopLab"
      width={36}
      height={36}
      className="size-9 rounded-lg"
    />
  );
}
