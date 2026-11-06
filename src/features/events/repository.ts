import { createSerialQueue } from '@/shared/utils/serial';
import { loadAccounts, loadIgnored } from '@/features/accounts/repository';
import { encodeStored, localKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import type { FollowEvent } from '@/shared/types';
import { compactEventsOf, decodeEvent, dedupeEvents, encodeEvent } from '@/domain/events/codec';
import { unseenDepartures } from '@/domain/events/selectors';

/** Historique d'un compte (§ 5.2) : une seule clé locale, au format compact. */

export async function loadEvents(accountId: string): Promise<FollowEvent[]> {
  // Entrées invalides ignorées : des données corrompues ne bloquent ni le badge ni les scans.
  const raw = await localKv.getLarge<unknown>(keys.events(accountId));
  return dedupeEvents(compactEventsOf(raw).map(decodeEvent));
}

async function saveEvents(accountId: string, events: FollowEvent[]): Promise<void> {
  await localKv.set({ [keys.events(accountId)]: encodeStored(dedupeEvents(events).map(encodeEvent)) });
}

/**
 * Départs non vus par compte, tenus à jour à chaque écriture de l'historique : le badge et les
 * interfaces les lisent sans décoder l'historique de tous les comptes.
 */
export const loadUnseen = async () => (await localKv.get<Record<string, number>>(keys.unseen)) ?? {};

async function recordUnseen(accountId: string, events: FollowEvent[]): Promise<void> {
  const [accounts, ignored, counts] = await Promise.all([loadAccounts(), loadIgnored(accountId), loadUnseen()]);
  const ctx = { ignored, mutualsOnly: accounts[accountId]?.mutualsOnly ?? false };
  await localKv.set({ [keys.unseen]: { ...counts, [accountId]: unseenDepartures(events, ctx).length } });
}

/** Retire le compteur d'un compte (retrait du compte). */
export const forgetUnseen = (accountId: string): Promise<void> =>
  writes.run(async () => {
    const { [accountId]: _removed, ...counts } = await loadUnseen();
    await localKv.set({ [keys.unseen]: counts });
  });

/** Recalcule le compteur d'un compte (comptes ignorés ou filtre follow back changés). */
export const refreshUnseen = (accountId: string): Promise<void> =>
  writes.run(async () => recordUnseen(accountId, await loadEvents(accountId)));

/** Mouvements retirés de l'historique (suppression, nettoyage), conservés à part. */
export async function loadRemoved(accountId: string): Promise<FollowEvent[]> {
  return compactEventsOf(await localKv.get<unknown>(keys.repaired(accountId))).map(decodeEvent);
}

/** Ajoute (`add`) ou reprend (`drop`, par id) des mouvements retirés. */
export function updateRemoved(accountId: string, { add = [], drop }: { add?: FollowEvent[]; drop?: string }): Promise<void> {
  return writes.run(async () => {
    const kept = (await loadRemoved(accountId)).filter((e) => e.id !== drop);
    await localKv.set({ [keys.repaired(accountId)]: [...kept, ...add].map(encodeEvent) });
  });
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
    await recordUnseen(accountId, next);
    return next;
  });
}
