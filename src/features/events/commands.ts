import { isImporting } from '@/shared/storage/import-lock';
import { refreshBadge } from '@/features/alerts/badge';
import type { FollowEvent } from '@/shared/types';
import { compactEventsOf, decodeEvent, encodeEvent } from '@/domain/events/codec';
import { stillAbsent } from '@/domain/events/selectors';
import { updateFollowChecks, updateHidden } from '@/features/followers-sync/repository';
import { loadEvents, updateEvents, updateRemoved } from './repository';

/**
 * Commandes sur les événements, exécutées par le service worker.
 * Les changements « vu » sont regroupés quelques secondes (§ 5.3) : une seule écriture
 * de l'historique pour plusieurs lignes affichées d'un coup.
 */

const SEEN_DEBOUNCE_MS = 2_500;
const pendingSeen = new Map<string, Set<string>>();
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
        events.map((e) => (ids.has(e.id) ? { ...e, seen: true } : e)),
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

/** Retrait d'un compte : ses « vus » en attente recréeraient son historique. */
export function forgetSeen(accountId: string): void {
  pendingSeen.delete(accountId);
}

export async function markSeen(accountId: string, eventIds: readonly string[]): Promise<void> {
  pendingSeen.set(accountId, new Set([...(pendingSeen.get(accountId) ?? []), ...eventIds]));
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushSeen(), SEEN_DEBOUNCE_MS);
}

/**
 * Retire de l'historique l'événement `eventId` s'il passe `accept` ; le renvoie. Lu d'abord : rien
 * n'est réécrit (l'historique peut faire plusieurs Mo) pour un événement absent ou refusé.
 */
async function takeEvent(
  accountId: string,
  eventId: string,
  accept: (event: FollowEvent, events: readonly FollowEvent[]) => boolean = () => true,
): Promise<FollowEvent | undefined> {
  const current = await loadEvents(accountId);
  const found = current.find((e) => e.id === eventId);
  if (!found || !accept(found, current)) return undefined;
  let taken: FollowEvent | undefined;
  await updateEvents(accountId, (events) =>
    events.filter((e) => {
      if (e.id !== eventId || !accept(e, events)) return true;
      taken = e;
      return false;
    }),
  );
  return taken;
}

export async function deleteEvent(accountId: string, eventId: string): Promise<FollowEvent | undefined> {
  const removed = await takeEvent(accountId, eventId);
  // Gardé à part : la réparation de l'historique ne doit pas recréer ce qu'on a supprimé.
  if (removed) await updateRemoved(accountId, { add: [removed] });
  if (removed) await refreshBadge();
  return removed;
}

/**
 * « Faux départ » signalé par l'utilisateur : le compte le suit toujours, X le cache de la liste.
 * Comme un faux départ repéré sur le profil (voir `applyFollowChecks`), le départ est retiré de
 * l'historique et le compte noté comme caché : les scans le tiennent pour présent (pas de fausse
 * arrivée quand X le réaffiche), et son profil est revérifié après chaque scan complet ; s'il ne
 * suit plus l'utilisateur, le vrai départ est alors enregistré. Sans effet sur un départ suivi d'un
 * retour (affichage périmé) : le compte est dans la liste, il n'est pas caché.
 *
 * La vérification du départ encore en file devient celle du compte caché (`h:<id>`) : si son profil
 * dit qu'il ne suit plus l'utilisateur, le vrai départ est enregistré dès cette passe.
 */
export async function markFalseDeparture(accountId: string, eventId: string): Promise<FollowEvent | undefined> {
  const removed = await takeEvent(accountId, eventId, (e, events) => e.type === 'departure' && stillAbsent(e, events));
  if (!removed) return undefined;
  await updateHidden(accountId, { add: [removed.profileId] });
  const recheckId = `h:${removed.profileId}`;
  await updateFollowChecks(accountId, (queue) => {
    if (!queue.some((q) => q.eventId === removed.id)) return queue;
    const others = queue.filter((q) => q.eventId !== removed.id && q.eventId !== recheckId);
    const pending = queue.find((q) => q.eventId === removed.id)!;
    return [...others, { eventId: recheckId, profileId: pending.profileId, handle: pending.handle, recheck: true, result: pending.result }];
  });
  await refreshBadge();
  return removed;
}

/**
 * Annule un « faux départ » : le départ revient, puis le compte n'est plus tenu pour caché (dans cet
 * ordre : un départ refusé ou un arrêt entre les deux le laisse caché, pas sans départ ni cache).
 */
export async function restoreFalseDeparture(accountId: string, event: FollowEvent): Promise<void> {
  if (!(await restoreEvent(accountId, event))) return;
  await updateHidden(accountId, { drop: [event.profileId] });
  // Revérification du compte caché devenue sans objet (une réponse déjà lue est ignorée : il n'est plus caché).
  await updateFollowChecks(accountId, (queue) => queue.filter((q) => q.eventId !== `h:${event.profileId}` || !!q.result));
}

/** Remet un événement retiré (« Annuler ») ; faux si l'événement renvoyé est illisible. */
export async function restoreEvent(accountId: string, event: FollowEvent): Promise<boolean> {
  // Événement renvoyé par l'interface (« Annuler ») : repassé par le format compact, rien d'autre n'est écrit.
  const [clean] = compactEventsOf([encodeEvent(event)]).map(decodeEvent);
  if (!clean) return false;
  await updateEvents(accountId, (events) => (events.some((e) => e.id === clean.id) ? events : [clean, ...events]));
  await updateRemoved(accountId, { drop: clean.id });
  await refreshBadge();
  return true;
}
