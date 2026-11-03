import { useMemo } from 'react';
import { loadIgnored } from '@/features/accounts/repository';
import { loadEvents } from '@/features/events/repository';
import type { VisibilityContext } from '@/features/events/selectors';
import { loadProfiles, type ProfileCache, type ScanProgress } from '@/features/followers-sync/repository';
import { useStorageQuery } from '@/shared/hooks/useStorageQuery';
import { localKv } from '@/shared/storage/kv';
import { isAccountKey, keys } from '@/shared/storage/keys';
import type { FollowEvent, TrackedAccount } from '@/shared/types';
import { useSeenOnView } from './useSeenOnView';

export interface AccountData {
  events: FollowEvent[];
  ignored: ReadonlySet<string>;
  profiles: ProfileCache;
  progress?: ScanProgress;
}

/** Clés d'un compte qui ne concernent pas l'affichage de l'historique (scan, instantané, visite). */
const SCAN_STATE_KEYS = [':job', ':progress', ':partial', ':snapshot', ':suspicious', ':visit'];

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Données d'un compte, rechargées à chaque changement de ses clés.
 * `seenOnView` (popup, options) : les événements affichés par les listes sont marqués vus ;
 * `markDisplayed` est à fournir aux listes par `DisplayedContext`.
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

  const seenOnView = !!options.seenOnView;
  const { fresh, markDisplayed } = useSeenOnView(seenOnView ? accountId : undefined, stored?.events);

  // `seen` = « plus nouveau » : un événement affiché pendant cette visite garde « Nouveau ».
  const events = useMemo(() => {
    const list = stored?.events ?? [];
    if (!seenOnView || fresh.size === 0) return list;
    return list.map((e) => (fresh.has(e.id) ? { ...e, seen: false } : e));
  }, [stored?.events, seenOnView, fresh]);

  // Objet stable entre deux rendus : les calculs mémoïsés des listes ne se relancent pas.
  const data = useMemo<AccountData | undefined>(
    () => (stored ? { ...stored, events, progress } : undefined),
    [stored, events, progress],
  );

  return { loading, data, markDisplayed };
}

/** Règles d'affichage d'un compte (comptes ignorés, follow back seulement), stables entre rendus. */
export function useVisibilityContext(data: AccountData | undefined, account: TrackedAccount | undefined): VisibilityContext {
  const ignored = data?.ignored ?? EMPTY_SET;
  const mutualsOnly = account?.mutualsOnly ?? false;
  return useMemo(() => ({ ignored, mutualsOnly }), [ignored, mutualsOnly]);
}
