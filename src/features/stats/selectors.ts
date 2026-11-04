import { byProfile, followDuration, isVisible, netMovement, type VisibilityContext } from '@/features/events/selectors';
import type { FollowEvent } from '@/shared/types';
import { DAY, startOfDay } from './period';

/**
 * Statistiques du tableau de bord (§ 3.4), calculées à partir de l'historique des départs et des
 * arrivées. Fonctions pures, testées dans stats.test.ts. Dates en heure locale.
 */

export type Unit = 'day' | 'week' | 'month';

/** Date du plus ancien mouvement, ou `undefined` sans historique. */
export const oldestEventAt = (events: readonly FollowEvent[]): number | undefined =>
  events.length ? Math.min(...events.map((e) => e.at)) : undefined;

/** Début (local) du jour, de la semaine (lundi) ou du mois contenant `at`. */
export function startOf(unit: Unit, at: number): number {
  const d = new Date(startOfDay(at));
  if (unit === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (unit === 'month') d.setDate(1);
  return d.getTime();
}

function next(unit: Unit, at: number): number {
  const d = new Date(at);
  if (unit === 'day') d.setDate(d.getDate() + 1);
  else if (unit === 'week') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

/** Débuts des tranches (jours, semaines ou mois) qui couvrent [from, to]. */
export function bucketStarts(unit: Unit, from: number, to: number): number[] {
  const starts: number[] = [];
  for (let at = startOf(unit, from); at <= to; at = next(unit, at)) starts.push(at);
  return starts;
}

export interface Bucket {
  /** Début de la tranche. */
  day: number;
  arrivals: number;
  departures: number;
}

/**
 * Arrivées et départs par tranche, avec la règle des bilans appliquée à chaque tranche : un compte
 * parti puis revenu dans la même tranche ne compte pas. Les mouvements avant `from` sont ignorés.
 */
export function movementBuckets(
  events: readonly FollowEvent[],
  ctx: VisibilityContext,
  unit: Unit,
  from: number,
  to: number,
): Bucket[] {
  const starts = bucketStarts(unit, from, to);
  const buckets: Bucket[] = starts.map((day) => ({ day, arrivals: 0, departures: 0 }));
  const indexOf = new Map(starts.map((s, i) => [s, i]));
  for (const list of byProfile(events).values()) {
    const perBucket = new Map<number, FollowEvent[]>();
    for (const e of list) {
      if (e.at < from || e.at > to || !isVisible(e, ctx)) continue;
      const i = indexOf.get(startOf(unit, e.at));
      if (i === undefined) continue;
      const list = perBucket.get(i);
      if (list) list.push(e);
      else perBucket.set(i, [e]);
    }
    for (const [i, inBucket] of perBucket) {
      const last = netMovement(inBucket);
      const bucket = buckets[i];
      if (!last || !bucket) continue;
      if (last.type === 'arrival') bucket.arrivals++;
      else bucket.departures++;
    }
  }
  return buckets;
}

export interface FollowerPoint {
  day: number;
  total: number;
}

export interface FollowerSeries {
  /** Total à la fin de chaque jour, du premier jour de la période à aujourd'hui. */
  points: FollowerPoint[];
  /** Total au début de la période (avant les mouvements du premier jour) : base de la variation. */
  start: number;
}

/**
 * Nombre d'abonnés à la fin de chaque jour, de `from` à aujourd'hui. Un total relevé ce jour-là
 * (vérification) fait foi ; sinon il est déduit du jour suivant en retirant les arrivées et en
 * rajoutant les départs du jour suivant. Tous les mouvements comptent (comptes ignorés compris) :
 * le total de X les compte aussi. Sans total actuel connu, pas de courbe.
 */
export function followerSeries(
  events: readonly FollowEvent[],
  recorded: readonly (readonly [number, number])[],
  currentTotal: number | undefined,
  from: number,
  now: number,
): FollowerSeries {
  if (currentTotal === undefined) return { points: [], start: 0 };
  const days = bucketStarts('day', from, now);
  const net = new Map<number, number>();
  for (const e of events) {
    if (e.at < days[0]!) continue;
    const day = startOfDay(e.at);
    net.set(day, (net.get(day) ?? 0) + (e.type === 'arrival' ? 1 : -1));
  }
  const known = new Map<number, number>();
  for (const [at, total] of recorded) known.set(startOfDay(at), total);
  const points: FollowerPoint[] = new Array(days.length);
  let total = currentTotal;
  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i]!;
    if (i < days.length - 1) total -= net.get(days[i + 1]!) ?? 0;
    // Aujourd'hui : le total actuel fait foi ; avant : le total relevé ce jour-là, s'il existe.
    if (i < days.length - 1) total = known.get(day) ?? total;
    points[i] = { day, total: Math.max(0, total) };
  }
  // Mouvements du premier jour retirés : la variation couvre toute la période (comme les chiffres).
  const start = Math.max(0, (points[0]?.total ?? 0) - (net.get(days[0]!) ?? 0));
  return { points, start };
}

/** Tranches de durée de suivi des départs (§ 3.4). `before` : déjà abonné au premier scan. */
export const DURATION_BUCKETS = ['lt1w', 'w1to3', 'm1to3', 'gt3m', 'before'] as const;
export type DurationBucket = (typeof DURATION_BUCKETS)[number];

/** Durée minimale de chaque tranche : une tranche plus longue que le suivi est impossible. */
const BUCKET_MIN: Record<Exclude<DurationBucket, 'before'>, number> = {
  lt1w: 0,
  w1to3: 7 * DAY,
  m1to3: 21 * DAY,
  gt3m: 90 * DAY,
};

const bucketOf = (ms: number): Exclude<DurationBucket, 'before'> =>
  ms < 7 * DAY ? 'lt1w' : ms < 21 * DAY ? 'w1to3' : ms < 90 * DAY ? 'm1to3' : 'gt3m';

export interface DurationRow {
  bucket: DurationBucket;
  count: number;
  /** `false` : le suivi est encore trop court pour cette tranche. */
  available: boolean;
}

/**
 * Départs de la période classés par durée de suivi. Toutes les tranches sont renvoyées ; celles
 * qui dépassent la durée du suivi depuis la référence sont marquées indisponibles (grisées).
 */
export function departuresByDuration(
  events: readonly FollowEvent[],
  ctx: VisibilityContext,
  from: number,
  now: number,
  baselineAt?: number,
): DurationRow[] {
  const counts: Record<DurationBucket, number> = { lt1w: 0, w1to3: 0, m1to3: 0, gt3m: 0, before: 0 };
  // Un départ par compte encore parti à la fin de la période : parti puis revenu ne compte pas,
  // parti deux fois compte une fois, arrivé puis reparti compte (sa durée de suivi est connue).
  for (const list of byProfile(events).values()) {
    const last = list.filter((e) => e.at >= from && e.at <= now && isVisible(e, ctx)).at(-1);
    if (last?.type !== 'departure') continue;
    const d = followDuration(last, events, baselineAt);
    counts[d.kind === 'during' ? bucketOf(d.ms) : 'before']++;
  }
  // Tranche plus longue que le suivi : gardée en attente (grisée), elle ne peut encore rien contenir.
  const tracked = baselineAt === undefined ? 0 : now - baselineAt;
  return DURATION_BUCKETS.map((bucket) => ({
    bucket,
    count: counts[bucket],
    available: bucket === 'before' || BUCKET_MIN[bucket] <= tracked,
  }));
}

export const RETENTION_DAYS = [7, 14, 30] as const;

/**
 * Rétention des arrivées : part des nouveaux abonnés encore là `n` jours après leur arrivée (pas
 * de départ dans l'intervalle). La cohorte jugée est celle d'une fenêtre de la même durée que la
 * période, décalée de `n` jours (arrivées entre `from - n` et `now - n`) : sinon, sur 7 ou 30 jours,
 * aucune arrivée de la période ne serait assez ancienne. Sans arrivée à juger (historique trop
 * court), la valeur est `null` (affichée « — »).
 */
export function retention(
  events: readonly FollowEvent[],
  ctx: VisibilityContext,
  from: number,
  now: number,
): Record<(typeof RETENTION_DAYS)[number], number | null> {
  const index = byProfile(events);
  const arrivals = events.filter((e) => e.type === 'arrival' && isVisible(e, ctx));
  const result = {} as Record<(typeof RETENTION_DAYS)[number], number | null>;
  for (const n of RETENTION_DAYS) {
    const judged = arrivals.filter((a) => a.at >= from - n * DAY && a.at + n * DAY <= now);
    if (judged.length === 0) {
      result[n] = null;
      continue;
    }
    const stayed = judged.filter(
      (a) => !(index.get(a.profileId) ?? []).some((e) => e.type === 'departure' && e.at > a.at && e.at <= a.at + n * DAY),
    );
    result[n] = stayed.length / judged.length;
  }
  return result;
}
