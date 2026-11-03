import { createSerialQueue } from '@/shared/utils/serial';
import { localKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import type { FollowEvent } from '@/shared/types';
import { compactEventsOf, decodeEvent, dedupeEvents, encodeEvent } from './codec';

/** Historique d'un compte (§ 5.2) : une seule clé locale, au format compact. */

export async function loadEvents(accountId: string): Promise<FollowEvent[]> {
  // Entrées invalides ignorées : des données corrompues ne bloquent ni le badge ni les scans.
  const raw = await localKv.get<unknown>(keys.events(accountId));
  return dedupeEvents(compactEventsOf(raw).map(decodeEvent));
}

async function saveEvents(accountId: string, events: FollowEvent[]): Promise<void> {
  await localKv.set({ [keys.events(accountId)]: dedupeEvents(events).map(encodeEvent) });
}

export async function deleteAccountEvents(accountId: string): Promise<void> {
  await localKv.remove(keys.events(accountId));
}

/** Modifie les événements d'un compte de façon sérialisée (une seule écriture à la fois). */
const writes = createSerialQueue();
/** Attend la fin des écritures en file (import d'une sauvegarde). */
export const settleWrites = (): Promise<void> => writes.idle();

export function updateEvents(
  accountId: string,
  mutate: (events: FollowEvent[]) => FollowEvent[] | Promise<FollowEvent[]>,
): Promise<FollowEvent[]> {
  return writes.run(async () => {
    const next = await mutate(await loadEvents(accountId));
    await saveEvents(accountId, next);
    return next;
  });
}
