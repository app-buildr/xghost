import type { FollowEvent } from '@/shared/types';

/** Fonctions pures de lecture des événements, partagées par le badge et les interfaces. */

export interface VisibilityContext {
  ignored: ReadonlySet<string>;
  mutualsOnly: boolean;
}

export function isVisible(e: FollowEvent, ctx: VisibilityContext): boolean {
  if (ctx.ignored.has(e.profileId)) return false;
  if (e.type === 'arrival') return true;
  if (ctx.mutualsOnly && !e.mutual) return false;
  return true;
}

const departures = (events: readonly FollowEvent[], ctx: VisibilityContext) =>
  events.filter((e) => e.type === 'departure' && isVisible(e, ctx));

export const arrivals = (events: readonly FollowEvent[], ctx: VisibilityContext) =>
  events.filter((e) => e.type === 'arrival' && isVisible(e, ctx));

/**
 * Mouvements par compte, du plus ancien au plus récent. Calculé une fois par liste
 * d'événements (mis en cache) : les tests « revenu depuis ? » restent en temps constant
 * au lieu de reparcourir tout l'historique pour chaque ligne affichée.
 */
const indexCache = new WeakMap<readonly FollowEvent[], Map<string, FollowEvent[]>>();
export function byProfile(events: readonly FollowEvent[]): Map<string, FollowEvent[]> {
  let index = indexCache.get(events);
  if (!index) {
    index = new Map();
    for (const e of events) {
      const list = index.get(e.profileId);
      if (list) list.push(e);
      else index.set(e.profileId, [e]);
    }
    for (const list of index.values()) list.sort((a, b) => a.at - b.at);
    indexCache.set(events, index);
  }
  return index;
}

/** Un mouvement de type `type` a eu lieu pour ce compte après `event`. */
const movedSince = (event: FollowEvent, events: readonly FollowEvent[], type: FollowEvent['type']) =>
  (byProfile(events).get(event.profileId) ?? []).some((e) => e.type === type && e.at > event.at);

/** Le compte n'est pas revenu depuis ce départ (§ 4.3, « part puis revient »). */
const stillAbsent = (departure: FollowEvent, events: readonly FollowEvent[]) =>
  !movedSince(departure, events, 'arrival');

/** Le compte n'est pas reparti depuis cette arrivée. */
const stillPresent = (arrival: FollowEvent, events: readonly FollowEvent[]) =>
  !movedSince(arrival, events, 'departure');

/**
 * Listes « Départs » et « Nouveaux abonnés » : l'état actuel de chaque compte.
 * Un compte qui part puis revient quitte la liste des départs (et inversement) ;
 * les événements restent enregistrés pour l'historique, les chiffres et la durée de suivi.
 */
export const currentDepartures = (events: FollowEvent[], ctx: VisibilityContext) =>
  departures(events, ctx).filter((e) => stillAbsent(e, events));

export const currentArrivals = (events: FollowEvent[], ctx: VisibilityContext) =>
  arrivals(events, ctx).filter((e) => stillPresent(e, events));

/** Départs non vus et toujours absents : ce que compte le badge. */
export function unseenDepartures(events: FollowEvent[], ctx: VisibilityContext): FollowEvent[] {
  return departures(events, ctx).filter((e) => !e.seen && stillAbsent(e, events));
}

export interface PeriodStats {
  departures: number;
  unseen: number;
  arrivals: number;
  net: number;
}

/**
 * Bilan d'un compte sur une période (ses mouvements dans l'ordre chronologique) : son dernier
 * mouvement s'il change sa situation, rien s'il est revenu à son état de départ.
 */
export function netMovement(inPeriod: readonly FollowEvent[]): FollowEvent | undefined {
  const first = inPeriod[0];
  const last = inPeriod[inPeriod.length - 1];
  return first && last && first.type === last.type ? last : undefined;
}

/**
 * Bilan de la période, compte par compte, cohérent avec les listes :
 * - départ : compte parti pendant la période et toujours absent à la fin (comme « Derniers
 *   départs »), y compris un compte arrivé puis reparti ;
 * - arrivée : compte qui s'est mis à te suivre pendant la période (son premier mouvement de la
 *   période est une arrivée), même s'il est reparti ensuite ;
 * - un compte parti puis revenu ne compte ni comme départ ni comme arrivée.
 * Le solde (arrivées − départs) reste exact : un compte arrivé puis reparti donne +1 − 1.
 */
export function statsSince(events: FollowEvent[], ctx: VisibilityContext, since: number): PeriodStats {
  let departuresCount = 0;
  let arrivalsCount = 0;
  let unseen = 0;
  for (const list of byProfile(events).values()) {
    const inPeriod = list.filter((e) => e.at >= since && isVisible(e, ctx));
    const first = inPeriod[0];
    const last = inPeriod.at(-1);
    if (!first || !last) continue;
    if (first.type === 'arrival') arrivalsCount++;
    if (last.type === 'departure') {
      departuresCount++;
      if (!last.seen) unseen++;
    }
  }
  return { departures: departuresCount, unseen, arrivals: arrivalsCount, net: arrivalsCount - departuresCount };
}

/**
 * Durée du suivi (§ 4.5). Jamais estimée :
 * - arrivée observée avant le départ → durée entre les deux ;
 * - sinon → « depuis <référence> ou avant ».
 */
export type FollowDuration = { kind: 'during'; ms: number } | { kind: 'since-or-before'; since: number } | { kind: 'unknown' };

export function followDuration(departure: FollowEvent, events: readonly FollowEvent[], baselineAt?: number): FollowDuration {
  // Mouvement qui précède ce départ : une arrivée observée donne la durée exacte.
  const before = (byProfile(events).get(departure.profileId) ?? []).filter((e) => e.at < departure.at).at(-1);
  if (before?.type === 'arrival') return { kind: 'during', ms: departure.at - before.at };
  if (baselineAt) return { kind: 'since-or-before', since: baselineAt };
  return { kind: 'unknown' };
}

/**
 * Cohérence entre l'historique et la liste d'abonnés (réparation) : pour chaque compte dont le
 * dernier mouvement contredit la liste actuelle, renvoie le mouvement manquant.
 * Ex. dernier mouvement « arrivée » mais absent de la liste → départ manquant.
 * Seuls les mouvements antérieurs à `before` (date de la liste) sont examinés : un mouvement
 * plus récent que la liste, par exemple venu d'une sauvegarde importée, est laissé de côté.
 */
export function missingMovements(
  events: FollowEvent[],
  followers: ReadonlySet<string>,
  before: number,
): { profileId: string; type: FollowEvent['type']; from: FollowEvent }[] {
  const out: { profileId: string; type: FollowEvent['type']; from: FollowEvent }[] = [];
  for (const [profileId, list] of byProfile(events)) {
    const e = list[list.length - 1]!;
    if (e.at >= before) continue;
    const present = followers.has(profileId);
    if (e.type === 'arrival' && !present) out.push({ profileId, type: 'departure', from: e });
    if (e.type === 'departure' && present) out.push({ profileId, type: 'arrival', from: e });
  }
  return out;
}

/**
 * Mouvement manquant que l'utilisateur a retiré exprès : le dernier mouvement retiré de ce compte
 * est de ce type, et rien de plus récent n'est arrivé depuis. Une paire retirée par le nettoyage se
 * termine par une arrivée : elle ne bloque pas un vrai départ arrivé après.
 */
export function wasRemoved(
  fix: { profileId: string; type: FollowEvent['type']; from: FollowEvent },
  removed: readonly FollowEvent[],
): boolean {
  const last = removed.filter((e) => e.profileId === fix.profileId).sort((a, b) => a.at - b.at).at(-1);
  return !!last && last.type === fix.type && last.at >= fix.from.at;
}

/**
 * Comptes dont le mouvement `type` est nouveau au regard de l'historique : on écarte ceux dont
 * le dernier mouvement connu est déjà de ce type. Évite d'enregistrer deux fois le même départ
 * (ou la même arrivée), par exemple après l'import d'une sauvegarde plus ancienne que la liste.
 */
export function newMovements(
  type: FollowEvent['type'],
  profileIds: readonly string[],
  events: readonly FollowEvent[],
): string[] {
  const index = byProfile(events);
  return profileIds.filter((id) => index.get(id)?.at(-1)?.type !== type);
}
