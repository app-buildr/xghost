import { refreshBadge } from '@/features/alerts/badge';
import type { FollowEvent } from '@/shared/types';
import { updateEvents } from './repository';

/**
 * Commandes sur les événements, exécutées par le service worker.
 * Les changements « vu » sont regroupés quelques secondes (§ 5.3) pour
 * respecter les limites d'écriture de `storage.sync`.
 */

const SEEN_DEBOUNCE_MS = 2_500;
const pendingSeen = new Map<string, Set<string> | 'all'>();
let timer: ReturnType<typeof setTimeout> | undefined;

async function flushSeen(): Promise<void> {
  timer = undefined;
  const batch = [...pendingSeen.entries()];
  pendingSeen.clear();
  for (const [accountId, ids] of batch) {
    await updateEvents(accountId, (events) =>
      events.map((e) => (ids === 'all' || ids.has(e.id) ? { ...e, seen: true } : e)),
    );
  }
  await refreshBadge();
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
