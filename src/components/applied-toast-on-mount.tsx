'use client';

import { toast } from '@heroui/react';
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Fires a one-shot success toast after the "Apply AI" server action
 * redirects back with `?applied=1`. Same approach as
 * AutoOptimizeOnMount — read the query, fire, strip the param via
 * router.replace so a refresh doesn't replay the toast.
 */
export function AppliedToastOnMount() {
  const params = useSearchParams();
  const router = useRouter();
  const t = useTranslations('Product');
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (params.get('applied') !== '1' && params.get('error') !== 'no_ai_to_apply') return;
    firedRef.current = true;

    if (params.get('applied') === '1') {
      toast.success(t('applyAiSuccess'));
    } else {
      toast.danger(t('applyAiNothingToApply'));
    }

    const next = new URLSearchParams(params);
    next.delete('applied');
    next.delete('error');
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
  }, [params, router, t]);

  return null;
}
