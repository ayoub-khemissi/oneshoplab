'use client';

import { toast } from '@heroui/react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * A connected store that tried the import URL lands here with a flag: say
 * why once, then drop the flag so a refresh does not repeat it. Sent to the
 * crossroads rather than the export on purpose — next to the inert import
 * panel, the message explains itself.
 */
export function ImportUnavailableToast() {
  const params = useSearchParams();
  const router = useRouter();
  const t = useTranslations('CsvHub');
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || params.get('importUnavailable') !== '1') return;
    fired.current = true;
    toast.warning(t('importUnavailable'));
    const next = new URLSearchParams(params);
    next.delete('importUnavailable');
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
  }, [params, router, t]);

  return null;
}
