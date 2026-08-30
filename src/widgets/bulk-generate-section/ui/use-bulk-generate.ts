'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { canonicalizePrefs, prefsKey, type BulkPrefs } from '@/components/bulk-prefs-editor';
import {
  errorKey,
  type ActiveBulkJob,
  type BulkCandidate,
  type BulkJobStatusForUi,
  type CostBreakdown
} from '../model/types';
import { updateUserPreferencesAction } from '@/lib/auth-actions';
import type { ChatModelId, ImageQualityId } from '@/entities/ai-model';

export interface UseBulkGenerateArgs {
  siteId: string;
  costEstimate: number;
  initialCandidates: BulkCandidate[];
  initialActive: ActiveBulkJob | null;
  initialDetail: BulkJobStatusForUi | null;
  creditsBalance: number;
  initialPrefs: BulkPrefs;
  initialSiteOverride: boolean;
  initialChatModel: ChatModelId;
  initialImageQuality: ImageQualityId;
}

export function useBulkGenerate({
  siteId,
  costEstimate,
  initialCandidates,
  initialActive,
  initialDetail,
  creditsBalance,
  initialPrefs,
  initialSiteOverride,
  initialChatModel,
  initialImageQuality
}: UseBulkGenerateArgs) {
  const t = useTranslations('BulkGenerate');
  const [active, setActive] = useState<ActiveBulkJob | null>(initialActive);
  const [detail, setDetail] = useState<BulkJobStatusForUi | null>(initialDetail);
  const [candidates, setCandidates] = useState<BulkCandidate[]>(initialCandidates);
  const [estimate, setEstimate] = useState<{ total: number; breakdown: CostBreakdown | null }>({
    total: costEstimate,
    breakdown: null
  });
  const [balance, setBalance] = useState<number>(creditsBalance);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [prefs, setPrefs] = useState<BulkPrefs>(() => canonicalizePrefs(initialPrefs));
  // Serialized prefs known to be persisted, in STATE so the launch
  // gate recomputes. The save effect skips when current prefs match it
  // (covers mount + no echo loop). `prefsBusy` covers the debounce +
  // PUT + candidate refresh window. The Generate button is gated on
  // `prefsBusy || prefsKey(prefs) !== savedKey` so it can never get
  // stuck (toggling back to the saved value clears it) and never opens
  // early while a newer change is still settling (key mismatch holds
  // it until savedKey catches up).
  const [savedKey, setSavedKey] = useState(prefsKey(canonicalizePrefs(initialPrefs)));
  const [prefsBusy, setPrefsBusy] = useState(false);
  // Whether the site has its OWN prefs vs. inheriting the account
  // default. Drives the "reset to account default" link.
  const [siteOverride, setSiteOverride] = useState(initialSiteOverride);
  // Debounced server search for the modal's candidate list. The ref
  // lets the stable `refresh` callback read the latest query without
  // being re-created on every keystroke.
  const [searchQuery, setSearchQuery] = useState('');
  const queryRef = useRef('');
  // Model picker (account-scoped, like the product page). Refs so the
  // stable `refresh` reads the latest without being re-created.
  const [chatModelId, setChatModelId] = useState<ChatModelId>(initialChatModel);
  const [imageQualityId, setImageQualityId] = useState<ImageQualityId>(initialImageQuality);
  const chatRef = useRef<ChatModelId>(initialChatModel);
  const imgRef = useRef<ImageQualityId>(initialImageQuality);

  const refresh = useCallback(async () => {
    try {
      const q = queryRef.current.trim();
      const res = await fetch(
        `/api/sites/bulk-generate?siteId=${encodeURIComponent(siteId)}&chat=${encodeURIComponent(
          chatRef.current
        )}&img=${encodeURIComponent(imgRef.current)}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
        { cache: 'no-store' }
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        active: ActiveBulkJob | null;
        detail: BulkJobStatusForUi | null;
        estimate: CostBreakdown;
        candidates: BulkCandidate[];
        creditsBalance: number;
      };
      setActive(data.active);
      setDetail(data.detail);
      setCandidates(data.candidates);
      setEstimate({ total: data.estimate.total, breakdown: data.estimate });
      setBalance(data.creditsBalance);
    } catch {
      /* next tick will retry */
    }
  }, [siteId]);

  // Apply a user-driven change, immediately canonicalized so the
  // client shape matches exactly what the server will persist.
  const updatePrefs = useCallback((next: BulkPrefs) => {
    // No gate flag set here — the launch gate is derived from
    // (prefsBusy || prefsKey(prefs) !== savedKey), so it engages on
    // this render and clears correctly even if the user toggles back
    // to the saved value (which would skip the save path entirely).
    setPrefs(canonicalizePrefs(next));
  }, []);

  // Debounced per-site save. Skips when prefs match the persisted key
  // (mount, or a no-op toggle-and-back) — and in that case clears the
  // busy flag so Generate can't get stuck disabled. We don't setPrefs
  // from the response (client already holds the canonical shape).
  useEffect(() => {
    const key = prefsKey(prefs);
    if (key === savedKey) {
      setPrefsBusy(false);
      return;
    }
    setPrefsBusy(true);
    const id = window.setTimeout(async () => {
      try {
        const res = await fetch('/api/sites/bulk-generate', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            siteId,
            fields: prefs.fields,
            imageAngles: prefs.imageAngles
          })
        });
        if (res.ok) {
          setSavedKey(key);
          // Saving site-specific prefs creates a site override.
          setSiteOverride(true);
          await refresh();
        }
      } catch {
        /* keep local state; the next toggle re-triggers the save */
      } finally {
        setPrefsBusy(false);
      }
    }, 600);
    return () => window.clearTimeout(id);
  }, [prefs, savedKey, siteId, refresh]);

  // Drop the site override → inherit the account default again.
  const resetToAccountDefault = useCallback(async () => {
    // No spinner — but still gate Generate while the candidates/cost
    // are refreshed to the inherited account default.
    setPrefsBusy(true);
    try {
      const res = await fetch('/api/sites/bulk-generate', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteId, reset: true })
      });
      if (res.ok) {
        const data = (await res.json()) as {
          prefs?: BulkPrefs;
          siteOverride?: boolean;
        };
        if (data.prefs) {
          const next = canonicalizePrefs(data.prefs);
          setSavedKey(prefsKey(next));
          setPrefs(next);
        }
        setSiteOverride(data.siteOverride ?? false);
        await refresh();
      }
    } catch {
      /* no-op; user can retry */
    } finally {
      setPrefsBusy(false);
    }
  }, [siteId, refresh]);

  // Debounced search settle → server-filtered candidate list.
  const onSearch = useCallback(
    (q: string) => {
      queryRef.current = q;
      setSearchQuery(q);
      refresh();
    },
    [refresh]
  );

  // Persist the model choice account-wide (same server action as the
  // product page — NO site-level config) and refresh the candidate
  // cost which depends on the chosen model + image quality.
  const persistModels = useCallback((chat: ChatModelId, img: ImageQualityId) => {
    const fd = new FormData();
    fd.set('chatModel', chat);
    fd.set('imageQuality', img);
    // Non-blocking: the ids also travel with the bulk request, so a
    // stale account write never affects the run in flight.
    void updateUserPreferencesAction(fd).catch(() => {});
  }, []);

  const onPickChat = useCallback(
    (id: ChatModelId) => {
      chatRef.current = id;
      setChatModelId(id);
      persistModels(id, imgRef.current);
      refresh();
    },
    [persistModels, refresh]
  );

  const onPickImage = useCallback(
    (id: ImageQualityId) => {
      imgRef.current = id;
      setImageQualityId(id);
      persistModels(chatRef.current, id);
      refresh();
    },
    [persistModels, refresh]
  );

  useEffect(() => {
    if (!active || active.status === 'completed' || active.status === 'failed') {
      return;
    }
    let cancelled = false;
    const id = setInterval(() => {
      if (cancelled) return;
      refresh();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, refresh]);

  useEffect(() => {
    if (modalOpen) refresh();
  }, [modalOpen, refresh]);

  async function startBulk(productIds: string[]) {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/sites/bulk-generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          siteId,
          productIds,
          chatModelId: chatRef.current,
          imageQualityId: imgRef.current
        })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMsg(t(errorKey(body.error)));
        return false;
      }
      setModalOpen(false);
      await refresh();
      return true;
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelBulk() {
    if (!active || cancelling) return;
    setCancelling(true);
    try {
      await fetch(
        `/api/sites/bulk-generate?siteId=${encodeURIComponent(
          siteId
        )}&jobId=${encodeURIComponent(active.id)}`,
        { method: 'DELETE' }
      );
      await refresh();
    } finally {
      setCancelling(false);
    }
  }

  async function retryFailed() {
    if (!detail || retrying) return;
    setRetrying(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/sites/bulk-generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          siteId,
          retryFromBulkId: detail.id,
          chatModelId: chatRef.current,
          imageQualityId: imgRef.current
        })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMsg(t(errorKey(body.error)));
        return;
      }
      await refresh();
    } finally {
      setRetrying(false);
    }
  }

  return {
    active,
    detail,
    candidates,
    estimate,
    balance,
    modalOpen,
    setModalOpen,
    submitting,
    cancelling,
    retrying,
    errorMsg,
    detailExpanded,
    setDetailExpanded,
    prefs,
    updatePrefs,
    launchBlocked: prefsBusy || prefsKey(prefs) !== savedKey,
    siteOverride,
    resetToAccountDefault,
    searchQuery,
    onSearch,
    chatModelId,
    imageQualityId,
    onPickChat,
    onPickImage,
    startBulk,
    cancelBulk,
    retryFailed
  };
}
