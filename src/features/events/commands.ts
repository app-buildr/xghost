import { isImporting } from '@/features/backup/lock';
import { refreshBadge } from '@/features/alerts/badge';
import type { FollowEvent } from '@/shared/types';
import { updateEvents } from './repository';

/**
 * Commandes sur les événements, exécutées par le service worker.
 * Les changements « vu » sont regroupés quelques secondes (§ 5.3) : une seule écriture
 * de l'historique pour plusieurs lignes affichées d'un coup.
 */

const SEEN_DEBOUNCE_MS = 2_500;
const pendingSeen = new Map<string, Set<string> | 'all'>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** Écriture des « vus » en cours, attendue par l'import d'une sauvegarde. */
let flushing: Promise<void> = Promise.resolve();

function flushSeen(): Promise<void> {
  timer = undefined;
  const batch = [...pendingSeen.entries()];
  pendingSeen.clear();
  flushing = (async () => {
    for (const [accountId, ids] of batch) {
      // Import commencé entre deux comptes : le reste viserait des données remplacées.
      if (isImporting()) return;
      await updateEvents(accountId, (events) =>
        events.map((e) => (ids === 'all' || ids.has(e.id) ? { ...e, seen: true } : e)),
      );
    }
    await refreshBadge();
  })().catch((err) => console.error(err));
  return flushing;
}

/**
 * Import d'une sauvegarde : abandonne les « vus » en attente (ils visent des données remplacées)
 * et attend l'écriture déjà commencée.
 */
export async function settleSeen(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = undefined;
  pendingSeen.clear();
  await flushing;
}

export async function markSeen(accountId: string, eventIds: string[] | 'all'): Promise<void> {
  const current = pendingSeen.get(accountId);
  if (eventIds === 'all' || current === 'all') pendingSeen.set(accountId, 'all');
  else pendingSeen.set(accountId, new Set([...(current ?? []), ...eventIds]));
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushSeen(), SEEN_DEBOUNCE_MS);
}

export async function deleteEvent(accountId: string, eventId: string): Promise<FollowEvent | undefined> {
  let removed: FollowEvent | undefined;
  await updateEvents(accountId, (events) =>
    events.filter((e) => {
      if (e.id !== eventId) return true;
      removed = e;
      return false;
    }),
  );
  await refreshBadge();
  return removed;
}

export async function restoreEvent(accountId: string, event: FollowEvent): Promise<void> {
  await updateEvents(accountId, (events) => (events.some((e) => e.id === event.id) ? events : [event, ...events]));
  await refreshBadge();
}
