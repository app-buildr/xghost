import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSelectedAccountId, loadAccounts, loadIgnored, setSelectedAccountId } from '@/features/accounts/repository';
import { loadEvents } from '@/features/events/repository';
import type { VisibilityContext } from '@/features/events/selectors';
import { loadProfiles, type ProfileCache, type ScanProgress } from '@/features/followers-sync/repository';
import { loadSettings } from '@/features/settings/repository';
import { useStorageQuery } from '@/shared/hooks/useStorageQuery';
import { send } from '@/shared/messaging/client';
import { localKv } from '@/shared/storage/kv';
import { isAccountKey, keys } from '@/shared/storage/keys';
import { DEFAULT_SETTINGS, type FollowEvent, type GlobalStatus, type Settings, type TrackedAccount } from '@/shared/types';
import { useToast } from '@/shared/ui/toast';

const selectAccount = (id: string) => setSelectedAccountId(id);
const updateSettings = (patch: Partial<Settings>) => send('settings:update', patch);

/** État global : comptes, compte sélectionné, réglages, état de session. */
export function useAppState() {
  const { data, loading } = useStorageQuery(
    async () => {
      const [accounts, selectedId, settings, status] = await Promise.all([
        loadAccounts(),
        getSelectedAccountId(),
        loadSettings(),
        localKv.get<GlobalStatus>(keys.status),
      ]);
      return { accounts, selectedId, settings, status };
    },
    (k) => k === keys.accounts || k === keys.selectedAccount || k === keys.settings || k === keys.status,
    [],
  );

  const accounts = useMemo(
    () => Object.values(data?.accounts ?? {}).sort((a, b) => a.addedAt - b.addedAt),
    [data?.accounts],
  );
  const selected: TrackedAccount | undefined =
    accounts.find((a) => a.id === data?.selectedId) ?? accounts.find((a) => a.id === data?.status?.activeAccountId) ?? accounts[0];

  // Aucun compte connu (ex. connecté à X avant l'installation) : on demande une détection.
  const noAccount = !loading && accounts.length === 0;
  useEffect(() => {
    if (noAccount) void send('session:detect', undefined).catch(() => undefined);
  }, [noAccount]);

  return {
    loading,
    accounts,
    selected,
    settings: data?.settings ?? DEFAULT_SETTINGS,
    status: data?.status,
    select: selectAccount,
    updateSettings,
  };
}

export interface AccountData {
  events: FollowEvent[];
  ignored: Set<string>;
  profiles: ProfileCache;
  progress?: ScanProgress;
}

/** Clés d'un compte qui ne concernent pas l'affichage de l'historique (scan, instantané, visite). */
const SCAN_STATE_KEYS = [':job', ':progress', ':partial', ':snapshot', ':suspicious', ':visit'];

/**
 * « Vu à l'affichage » : les événements non vus deviennent vus dès qu'ils sont affichés
 * (le badge s'efface). Ils gardent l'étiquette « Nouveau » tant que la page reste
 * affichée ; quand on la quitte (autre onglet, popup fermée) puis qu'on revient,
 * ils ne sont plus nouveaux.
 */
function useSeenOnView(accountId: string | undefined, stored: FollowEvent[] | undefined, enabled: boolean) {
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const sent = useRef(new Set<string>());

  useEffect(() => {
    const onVisibility = () => {
      const v = document.visibilityState === 'visible';
      setVisible(v);
      if (!v) setFresh(new Set()); // page quittée : plus rien n'est « nouveau » au retour
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    setFresh(new Set());
    sent.current = new Set();
  }, [accountId]);

  useEffect(() => {
    if (!enabled || !accountId || !visible || !stored) return;
    const unseen = stored.filter((e) => !e.seen && !sent.current.has(e.id)).map((e) => e.id);
    if (unseen.length === 0) return;
    unseen.forEach((id) => sent.current.add(id));
    setFresh((prev) => new Set([...prev, ...unseen]));
    void send('events:mark-seen', { accountId, eventIds: unseen });
  }, [enabled, accountId, visible, stored]);

  return { fresh, setFresh };
}

/**
 * Données d'un compte, rechargées à chaque changement de ses clés.
 * `seenOnView` : les événements affichés sont marqués vus automatiquement (popup, options).
 */
export function useAccountData(accountId: string | undefined, options: { seenOnView?: boolean } = {}) {
  // Historique, comptes ignorés et profils : rechargés seulement quand ils changent
  // (pas à chaque page d'un scan en cours, qui ne touche que l'état du scan).
  const { data: stored, loading } = useStorageQuery<Omit<AccountData, 'progress'> | undefined>(
    async () => {
      if (!accountId) return undefined;
      const [events, ignored, profiles] = await Promise.all([
        loadEvents(accountId),
        loadIgnored(accountId),
        loadProfiles(accountId),
      ]);
      return { events, ignored, profiles };
    },
    (k) => !!accountId && isAccountKey(k, accountId) && !SCAN_STATE_KEYS.some((suffix) => k.endsWith(suffix)),
    [accountId],
  );
  // État du scan en cours : petite clé mise à jour à chaque page.
  const { data: progress } = useStorageQuery<ScanProgress | undefined>(
    async () => (accountId ? localKv.get<ScanProgress>(keys.scanProgress(accountId)) : undefined),
    (k) => !!accountId && k === keys.scanProgress(accountId),
    [accountId],
  );
  const data = useMemo(() => (stored ? { ...stored, progress } : undefined), [stored, progress]);

  const seenOnView = !!options.seenOnView;
  const { fresh, setFresh } = useSeenOnView(accountId, data?.events, seenOnView);

  // « Vu » optimiste : les écritures sont regroupées côté service worker (§ 5.3).
  const [seenOverride, setSeenOverride] = useState<Set<string> | 'all'>(new Set());
  const events = useMemo(() => {
    const list = data?.events ?? [];
    // Vu à l'affichage : seul ce qui est arrivé depuis l'ouverture de la page reste « nouveau ».
    if (seenOnView) return list.map((e) => ({ ...e, seen: !fresh.has(e.id) }));
    if (seenOverride !== 'all' && seenOverride.size === 0) return list;
    return list.map((e) =>
      e.type === 'departure' && (seenOverride === 'all' || seenOverride.has(e.id)) ? { ...e, seen: true } : e,
    );
  }, [data?.events, seenOverride, seenOnView, fresh]);

  const markSeenLocally = useCallback(
    (ids: string[] | 'all') => {
      if (seenOnView) {
        const drop = new Set(ids === 'all' ? [] : ids);
        setFresh((prev) => (ids === 'all' ? new Set() : new Set([...prev].filter((id) => !drop.has(id)))));
        return;
      }
      setSeenOverride((prev) => (ids === 'all' || prev === 'all' ? 'all' : new Set([...prev, ...ids])));
    },
    [seenOnView, setFresh],
  );

  return {
    loading,
    data: data ? { ...data, events } : undefined,
    markSeenLocally,
  };
}

export const visibilityContext = (
  data: AccountData | undefined,
  settings: Settings,
  account: TrackedAccount | undefined,
): VisibilityContext => ({
  ignored: data?.ignored ?? new Set(),
  ignoreSuspended: settings.ignoreSuspended,
  mutualsOnly: account?.mutualsOnly ?? false,
});

/** Actions sur les événements, avec toasts (copie, suppression annulable). */
export function useEventActions(accountId: string | undefined, markSeenLocally: (ids: string[] | 'all') => void) {
  const toast = useToast();

  const markSeen = useCallback(
    (ids: string[] | 'all') => {
      if (!accountId) return;
      markSeenLocally(ids);
      void send('events:mark-seen', { accountId, eventIds: ids });
    },
    [accountId, markSeenLocally],
  );

  const copyHandle = useCallback(
    async (handle: string) => {
      await navigator.clipboard.writeText(`@${handle}`);
      toast.show(`@${handle} copié`);
    },
    [toast],
  );

  const ignore = useCallback(
    async (profileId: string, handle: string, ignored = true) => {
      if (!accountId) return;
      await send('profile:ignore', { accountId, profileId, ignored });
      toast.show(ignored ? `@${handle} est ignoré` : `@${handle} n’est plus ignoré`);
    },
    [accountId, toast],
  );

  const remove = useCallback(
    async (event: FollowEvent) => {
      if (!accountId) return;
      const { removed } = await send('events:delete', { accountId, eventId: event.id });
      if (!removed) return;
      toast.show('Supprimé de l’historique', {
        durationMs: 5000,
        action: { label: 'Annuler', run: () => void send('events:restore', { accountId, event: removed }) },
      });
    },
    [accountId, toast],
  );

  return { markSeen, copyHandle, ignore, remove };
}
