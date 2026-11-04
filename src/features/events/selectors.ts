import type { FollowEvent } from '@/shared/types';

/** Fonctions pures de lecture des événements, partagées par le badge et les interfaces. */

export interface VisibilityContext {
  ignored: ReadonlySet<string>;
  mutualsOnly: boolean;
}

const DAY = 24 * 3600_000;

export function isVisible(e: FollowEvent, ctx: VisibilityContext): boolean {
  if (ctx.ignored.has(e.profileId)) return false;
  if (e.type === 'arrival') return true;
  if (ctx.mutualsOnly && !e.mutual) return false;
  return true;
}

export const departures = (events: FollowEvent[], ctx: VisibilityContext) =>
  events.filter((e) => e.type === 'departure' && isVisible(e, ctx));

export const arrivals = (events: FollowEvent[], ctx: VisibilityContext) =>
  events.filter((e) => e.type === 'arrival' && isVisible(e, ctx));

/**
 * Mouvements par compte, du plus ancien au plus récent. Calculé une fois par liste
 * d'événements (mis en cache) : les tests « revenu depuis ? » restent en temps constant
 * au lieu de reparcourir tout l'historique pour chaque ligne affichée.
 */
const indexCache = new WeakMap<readonly FollowEvent[], Map<string, FollowEvent[]>>();
function byProfile(events: readonly FollowEvent[]): Map<string, FollowEvent[]> {
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
export const stillAbsent = (departure: FollowEvent, events: readonly FollowEvent[]) =>
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
function netMovement(inPeriod: readonly FollowEvent[]): FollowEvent | undefined {
  const first = inPeriod[0];
  const last = inPeriod[inPeriod.length - 1];
  return first && last && first.type === last.type ? last : undefined;
}

/**
 * Bilan de la période, compte par compte : on compare la situation de chaque compte avant
 * et après la période. Un compte parti puis revenu (ou arrivé puis reparti) ne compte pas ;
 * plusieurs allers-retours ne comptent qu'une fois.
 */
export function statsSince(events: FollowEvent[], ctx: VisibilityContext, since: number): PeriodStats {
  let departuresCount = 0;
  let arrivalsCount = 0;
  let unseen = 0;
  for (const list of byProfile(events).values()) {
    const last = netMovement(list.filter((e) => e.at >= since && isVisible(e, ctx)));
    if (!last) continue; // revenu, ou arrivé puis reparti
    if (last.type === 'arrival') arrivalsCount++;
    else {
      departuresCount++;
      if (!last.seen) unseen++;
    }
  }
  return { departures: departuresCount, unseen, arrivals: arrivalsCount, net: arrivalsCount - departuresCount };
}

export const stats7d = (events: FollowEvent[], ctx: VisibilityContext, now = Date.now()) =>
  statsSince(events, ctx, now - 7 * DAY);

export interface DayBucket {
  day: number;
  arrivals: number;
  departures: number;
}

/**
 * Arrivées et départs par jour (local) sur les `days` derniers jours, du plus ancien au plus récent.
 * Même règle que le bilan sur 7 jours, appliquée à chaque journée : un compte parti puis revenu
 * le même jour ne compte pas ce jour-là.
 */
export function dailyBuckets(events: FollowEvent[], ctx: VisibilityContext, days = 30, now = Date.now()): DayBucket[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const buckets: DayBucket[] = Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return { day: d.getTime(), arrivals: 0, departures: 0 };
  });
  const dayIndex = (at: number) => {
    const d = new Date(at);
    d.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - start.getTime()) / DAY);
  };
  for (const list of byProfile(events).values()) {
    const perDay = new Map<number, FollowEvent[]>();
    for (const e of list) {
      if (e.at < start.getTime() || !isVisible(e, ctx)) continue;
      const i = dayIndex(e.at);
      perDay.set(i, [...(perDay.get(i) ?? []), e]);
    }
    for (const [i, dayEvents] of perDay) {
      const last = netMovement(dayEvents);
      const bucket = buckets[i];
      if (!last || !bucket) continue;
      if (last.type === 'arrival') bucket.arrivals++;
      else bucket.departures++;
    }
  }
  return buckets;
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
