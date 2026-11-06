/** Comparaison pure de deux listes d'abonnés et garde-fous contre les faux départs (§ 4.2, 4.3). */

export interface FollowersDiff {
  departures: string[];
  arrivals: string[];
}

export function diffFollowers(previous: readonly string[], current: readonly string[]): FollowersDiff {
  const prev = new Set(previous);
  const curr = new Set(current);
  return {
    departures: previous.filter((id) => !curr.has(id)),
    arrivals: current.filter((id) => !prev.has(id)),
  };
}

export type ScanVerdict = 'ok' | 'suspicious';

export interface ScanAssessment {
  previousCount: number;
  collected: number;
  /** Nombre d'abonnés annoncé par X. */
  expected: number;
  departures: number;
}

/**
 * Scan complet si les abonnés récupérés atteignent 99 % du total annoncé par X (§ 4.7) :
 * X compte des comptes qu'il n'affiche pas (suspendus, restreints, bloqués).
 */
const COMPLETE_RATIO = 0.99;

/**
 * Couverture d'un scan. Également complet :
 * - si la fin de liste est atteinte sans rien ajouter aux abonnés repris du passage précédent
 *   (X n'en montrera pas davantage) ;
 * - pour un compte sans abonné : total 0 réellement lu sur le profil (`totalKnown`) et liste,
 *   vide, lue jusqu'au bout. Un total inconnu (0 par défaut) avec une page illisible ne suffit pas.
 */
export function isComplete(a: {
  scanned: number;
  detected: number;
  reachedEnd?: boolean;
  seeded?: number;
  totalKnown?: boolean;
}): boolean {
  if (a.detected <= 0) return a.scanned > 0 || (!!a.reachedEnd && !!a.totalKnown);
  if (a.scanned >= a.detected * COMPLETE_RATIO) return true;
  return !!a.reachedEnd && (a.seeded ?? 0) > 0 && a.scanned <= (a.seeded ?? 0);
}

/** Variation anormale : plus de 20 % de départs d'un coup… */
const SUSPICIOUS_RATIO = 0.2;
/** …et au moins ce nombre de départs (évite de bloquer les petits comptes). */
const SUSPICIOUS_MIN = 10;
/** Après ce nombre de résultats suspects identiques à la suite, on accepte la variation. */
export const SUSPICIOUS_MAX_RETRIES = 3;

export function assessScan(a: ScanAssessment): ScanVerdict {
  if (a.departures >= SUSPICIOUS_MIN && a.departures > a.previousCount * SUSPICIOUS_RATIO) return 'suspicious';
  return 'ok';
}

export interface QuickAssessment {
  /** Abonnés de la première page absents de l'instantané : nouveaux abonnés. */
  arrivals: string[];
  /** Toute la première page est nouvelle : d'autres arrivées peuvent suivre, le calcul n'est pas fiable. */
  overflow: boolean;
  /** Abonnés récents absents des nouveaux premiers : partis à coup sûr, identifiés sans scan complet. */
  departed: string[];
  /** Abonnés manquants non identifiés (départs plus anciens) : il faut un scan complet. */
  missing: number;
  /**
   * Nouveaux abonnés visibles mais total X pas encore à jour (X met à jour son compteur
   * avec du retard) : l'écart ne prouve pas un départ, il faut revérifier plus tard.
   */
  maybeStale: boolean;
}

/**
 * Contrôle léger : x.com classe les abonnés du plus récent au plus ancien.
 *
 * - Les nouveaux abonnés sont en tête : ce sont les ids de la première page absents de l'instantané.
 * - Les abonnés récents qui sont partis se voient aussi : dans la liste précédente, ceux qui
 *   étaient dans les `page − arrivées` premiers doivent forcément figurer dans la nouvelle
 *   première page ; s'ils n'y sont plus, ils sont partis.
 * - Le reste de l'écart de total (ancien total + arrivées − départs vus − total actuel)
 *   correspond à des départs plus anciens, qu'il faut un scan complet pour identifier.
 */
export function assessQuick(a: {
  previousTotal: number;
  currentTotal: number;
  knownIds: ReadonlySet<string>;
  /** Première page actuelle, dans l'ordre de x.com. */
  pageIds: readonly string[];
  /** Haut de la liste précédente, dans l'ordre de x.com. */
  previousTop?: readonly string[];
}): QuickAssessment {
  const arrivals = a.pageIds.filter((id) => !a.knownIds.has(id));
  const overflow = a.pageIds.length > 0 && arrivals.length === a.pageIds.length;
  const page = new Set(a.pageIds);
  const window = (a.previousTop ?? []).slice(0, Math.max(0, a.pageIds.length - arrivals.length));
  const departed = window.filter((id) => !page.has(id));
  const missing = Math.max(0, a.previousTotal + arrivals.length - departed.length - a.currentTotal);
  // Total qui n'a pas baissé : l'écart peut venir d'un compteur X en retard sur la liste.
  const maybeStale = missing > 0 && arrivals.length > 0 && a.currentTotal >= a.previousTotal - departed.length;
  return { arrivals, departed, overflow, missing, maybeStale };
}

/**
 * Arrêt anticipé d'un scan complet (déclenché par un écart du contrôle léger).
 *
 * La liste est classée par date d'abonnement et cet ordre ne change pas : en la relisant,
 * dès qu'on a revu un abonné de l'ancienne liste, tous ceux qui le précédaient dans
 * l'ancienne liste et qu'on n'a pas revus sont partis. Quand on en a trouvé autant que
 * l'écart annoncé par le total, la suite de la liste est forcément inchangée.
 */
export function earlyStop(
  previousOrder: readonly string[],
  current: ReadonlySet<string>,
  target: number,
): { matchedIndex: number } | undefined {
  if (target <= 0 || previousOrder.length === 0) return undefined;
  let matchedIndex = -1;
  for (let i = previousOrder.length - 1; i >= 0; i--) {
    if (current.has(previousOrder[i]!)) {
      matchedIndex = i;
      break;
    }
  }
  if (matchedIndex < 0) return undefined;
  let departed = 0;
  for (let i = 0; i < matchedIndex; i++) if (!current.has(previousOrder[i]!)) departed++;
  return departed >= target ? { matchedIndex } : undefined;
}

/** Liste complète reconstituée après un arrêt anticipé : partie relue + suite inchangée. */
export function assembleOrder(previousOrder: readonly string[], currentOrder: readonly string[], matchedIndex: number) {
  const current = new Set(currentOrder);
  return [...currentOrder, ...previousOrder.slice(matchedIndex + 1).filter((id) => !current.has(id))];
}

/**
 * Scan arrêté avant la fin de la liste (chargement bloqué, couverture ≥ 99 % malgré tout) :
 * la partie non relue est considérée comme inchangée au lieu d'être déclarée partie.
 * L'ancienne liste étant dans l'ordre de x.com, tout ce qui suit le dernier abonné relu
 * est repris tel quel ; seuls les abonnés qui le précédaient et qu'on n'a pas revus sont partis.
 */
export function fillUnreadTail(previousOrder: readonly string[], currentOrder: readonly string[]): string[] {
  const current = new Set(currentOrder);
  for (let i = previousOrder.length - 1; i >= 0; i--) {
    if (current.has(previousOrder[i]!)) return assembleOrder(previousOrder, currentOrder, i);
  }
  return [...currentOrder];
}
