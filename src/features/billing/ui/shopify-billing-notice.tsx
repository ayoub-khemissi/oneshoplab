import { Card } from '@heroui/react';
import { ArrowUpRight, ShoppingBag } from 'lucide-react';

/** Shown to merchants whose plan and packs are billed by Shopify. */
export function ShopifyBillingNotice({
  url,
  copy
}: {
  url: string;
  copy: { title: string; body: string; cta: string };
}) {
  return (
    <Card
      variant="secondary"
      className="p-5 flex flex-col sm:flex-row sm:items-center gap-4 border border-[var(--accent)]/30"
      data-testid="shopify-billing-notice"
    >
      <ShoppingBag className="size-6 text-[var(--accent)] shrink-0" aria-hidden />
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <h2 className="text-base font-semibold">{copy.title}</h2>
        <p className="text-sm text-[var(--muted)] leading-relaxed">{copy.body}</p>
      </div>
      <a
        href={url}
        className="px-4 py-2.5 rounded-md bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-medium hover:opacity-90 transition-opacity inline-flex items-center justify-center gap-1.5 shrink-0"
      >
        {copy.cta} <ArrowUpRight className="size-4" aria-hidden />
      </a>
    </Card>
  );
}
