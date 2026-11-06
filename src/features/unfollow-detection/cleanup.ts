import { loadAccounts } from '@/features/accounts/repository';
import { refreshBadge } from '@/features/alerts/badge';
import { loadEvents, updateEvents, updateRemoved } from '@/features/events/repository';
import { byProfile } from '@/domain/events/selectors';
import type { FollowEvent } from '@/shared/types';

/**
 * Nettoyage des faux départs laissés par les versions précédentes : un scan coupé déclarait
 * partis d'un coup des abonnés toujours présents, que le scan suivant retrouvait d'un coup.
 *
 * Seul ce motif est reconnu : un lot de départs de même date dont presque tous reviennent dans un
 * même lot d'arrivées. Un faux départ isolé ressemble à un vrai départ suivi d'un retour : il est
 * laissé tel quel. Les mouvements retirés sont conservés (clé `repaired`, sauvegardée avec le compte).
 */

/** Taille minimale d'un lot de départs : en dessous, le motif ne prouve rien. */
const MIN_BATCH = 5;
/** Part du lot qui doit revenir d'un coup. */
const RETURN_RATIO = 0.9;

/** Paires départ puis arrivée à retirer de l'historique (fonction pure). */
export function falseMovements(events: readonly FollowEvent[]): FollowEvent[] {
  const index = byProfile(events);
  const batches = new Map<number, { departure: FollowEvent; back?: FollowEvent }[]>();
  for (const list of index.values()) {
    list.forEach((e, i) => {
      if (e.type !== 'departure') return;
      const next = list[i + 1];
      const batch = batches.get(e.at) ?? [];
      batch.push({ departure: e, back: next?.type === 'arrival' ? next : undefined });
      batches.set(e.at, batch);
    });
  }
  const removed: FollowEvent[] = [];
  for (const batch of batches.values()) {
    if (batch.length < MIN_BATCH) continue;
    const returns = new Map<number, number>();
    for (const { back } of batch) if (back) returns.set(back.at, (returns.get(back.at) ?? 0) + 1);
    for (const [at, count] of returns) {
      if (count < batch.length * RETURN_RATIO) continue;
      for (const { departure, back } of batch) if (back?.at === at) removed.push(departure, back);
    }
  }
  return removed;
}

/** Retire les faux départs d'un compte et les conserve à part. Renvoie le nombre de mouvements retirés. */
export async function cleanFalseMovements(accountId: string): Promise<number> {
  // Lecture d'abord : rien n'est réécrit pour un historique sans faux départs.
  if (falseMovements(await loadEvents(accountId)).length === 0) return 0;
  let removed: FollowEvent[] = [];
  await updateEvents(accountId, (events) => {
    removed = falseMovements(events);
    const ids = new Set(removed.map((e) => e.id));
    return events.filter((e) => !ids.has(e.id));
  });
  if (removed.length === 0) return 0;
  await updateRemoved(accountId, { add: removed });
  await refreshBadge();
  return removed.length;
}

/** Nettoyage de tous les comptes (mise à jour de l'extension). */
export async function cleanAllFalseMovements(): Promise<void> {
  for (const accountId of Object.keys(await loadAccounts())) await cleanFalseMovements(accountId);
}
