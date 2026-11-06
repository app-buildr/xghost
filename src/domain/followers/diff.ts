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
  departures: number;
}

/**
 * Scan complet si les abonnés récupérés atteignent 99 % du total annoncé par X (§ 4.7) :
 * X compte des comptes qu'il n'affiche pas (suspendus, restreints, bloqués).
 */
const COMPLETE_RATIO = 0.99;
/** Reprise qui n'apporte rien : acceptée seulement à partir de cette couverture (X cache peu de comptes). */
const RESUMED_FLOOR_RATIO = 0.9;

/** Comptes que X peut compter sans les afficher : sur un petit compte, un ratio n'y suffit pas. */
const HIDDEN_MARGIN = 5;
const reachesResumedFloor = (scanned: number, detected: number) =>
  scanned >= detected * RESUMED_FLOOR_RATIO || detected - scanned <= HIDDEN_MARGIN;

/** Liste arrêtée trop loin du total annoncé pour être une vraie fin de liste. */
export const belowResumedFloor = (scanned: number, detected: number) => detected > 0 && !reachesResumedFloor(scanned, detected);

/** Le scan atteint la couverture d'un scan complet (total X connu). */
export const reachesCoverage = (scanned: number, detected: number) => detected > 0 && scanned >= detected * COMPLETE_RATIO;

/**
 * Couverture d'un scan. Également complet :
 * - si une reprise a relu la liste jusqu'au bout sans rien ajouter aux abonnés du passage
 *   précédent (`reread` : abonnés relus par ce passage), avec une couverture minimale : X n'en
 *   montrera pas davantage. Une page vide ou une liste coupée par X ne suffit pas ;
 * - sans total connu : liste lue jusqu'au bout. Pour un compte sans abonné, il faut aussi le
 *   total 0 réellement lu sur le profil (`totalKnown`) : une page illisible ne suffit pas.
 */
export function isComplete(a: {
  scanned: number;
  detected: number;
  reachedEnd?: boolean;
  seeded?: number;
  reread?: number;
  totalKnown?: boolean;
}): boolean {
  if (a.detected <= 0) return !!a.reachedEnd && (a.scanned > 0 || !!a.totalKnown);
  if (reachesCoverage(a.scanned, a.detected)) return true;
  const seeded = a.seeded ?? 0;
  return (
    !!a.reachedEnd &&
    seeded > 0 &&
    a.scanned <= seeded &&
    reachesResumedFloor(a.scanned, a.detected) &&
    (a.reread ?? 0) >= seeded * COMPLETE_RATIO
  );
}

/** Marge du contrôle par le total : au moins ce nombre de départs… */
const TOTAL_TOLERANCE_MIN = 5;
/** …ou cette part de la liste (compteur X un peu en retard, comptes qu'il n'affiche pas). */
const TOTAL_TOLERANCE_RATIO = 0.005;

/**
 * Contrôle par le total : les départs trouvés doivent être expliqués par la baisse du total
 * annoncé par X. Sinon la liste lue est coupée (page manquante, fin de liste prématurée) : ces
 * abonnés ne sont pas partis, le scan n'est pas comparé.
 */
export function departuresExplained(a: {
  /** Total X de la liste précédente, écart en attente compris. */
  previousTotal: number;
  currentTotal: number;
  arrivals: number;
  departures: number;
  previousCount: number;
}): boolean {
  const explained = Math.max(0, a.previousTotal + a.arrivals - a.currentTotal);
  const tolerance = Math.max(TOTAL_TOLERANCE_MIN, Math.ceil(a.previousCount * TOTAL_TOLERANCE_RATIO));
  return a.departures <= explained + tolerance;
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
 * - Un abonné connu mais absent du haut de la liste précédente est remonté (parti puis revenu :
 *   x.com le replace en tête) ou entré par le bas de la page : il décale la fenêtre comme une arrivée.
 * - Les abonnés récents qui sont partis se voient aussi : dans la liste précédente, ceux qui
 *   étaient dans les `page − arrivées − remontés` premiers doivent figurer dans la nouvelle
 *   première page ; s'ils n'y sont plus, ils sont partis. Jamais plus de départs que la baisse du
 *   total ne l'explique : sinon rien n'est conclu, le prochain contrôle tranchera.
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
  const top = a.previousTop ?? [];
  const previousPage = new Set(top.slice(0, a.pageIds.length));
  const moved = a.pageIds.filter((id) => a.knownIds.has(id) && !previousPage.has(id));
  const window = top.slice(0, Math.max(0, a.pageIds.length - arrivals.length - moved.length));
  const drop = Math.max(0, a.previousTotal + arrivals.length - a.currentTotal);
  const seen = window.filter((id) => !page.has(id));
  const departed = seen.length > drop ? [] : seen;
  const missing = Math.max(0, drop - departed.length);
  // Total qui n'a pas baissé : l'écart peut venir d'un compteur X en retard sur la liste.
  const maybeStale = missing > 0 && arrivals.length > 0 && a.currentTotal >= a.previousTotal - departed.length;
  return { arrivals, departed, overflow, missing, maybeStale };
}

/**
 * Arrêt anticipé d'un scan complet (déclenché par un écart du contrôle léger).
 *
 * La liste est classée par date d'abonnement : en la relisant, le dernier abonné relu marque où
 * on en est dans l'ancienne liste. Tous ceux qui le précédaient et qu'on n'a pas revus sont
 * partis. Un abonné parti puis revenu remonte en tête : c'est pourquoi on part du dernier relu et
 * non du plus ancien revu, qui ferait passer pour partis tous ceux qui n'ont pas encore été relus.
 * Quand on a trouvé autant de départs que l'écart annoncé, la suite de la liste est inchangée.
 * Beaucoup plus de départs que l'écart : l'ordre n'est pas fiable, on continue de lire.
 */
export function earlyStop(
  previousOrder: readonly string[],
  /** Position de chaque abonné dans l'ancienne liste (`orderIndex`), calculée une fois par scan. */
  index: ReadonlyMap<string, number>,
  currentOrder: readonly string[],
  /** Abonnés déjà relus, tenus à jour par le moteur. */
  current: ReadonlySet<string>,
  target: number,
): { matchedIndex: number } | undefined {
  if (target <= 0 || previousOrder.length === 0) return undefined;
  const matchedIndex = lastReadIndex(index, currentOrder);
  if (matchedIndex < 0) return undefined;
  let departed = 0;
  for (let i = 0; i < matchedIndex; i++) if (!current.has(previousOrder[i]!)) departed++;
  const slack = Math.max(TOTAL_TOLERANCE_MIN, target);
  return departed >= target && departed <= target + slack ? { matchedIndex } : undefined;
}

/** Position dans l'ancienne liste du dernier abonné relu qui y figure, sinon -1. */
function lastReadIndex(index: ReadonlyMap<string, number>, currentOrder: readonly string[]): number {
  for (let i = currentOrder.length - 1; i >= 0; i--) {
    const position = index.get(currentOrder[i]!);
    if (position !== undefined) return position;
  }
  return -1;
}

/** Position de chaque abonné dans une liste. */
export const orderIndex = (order: readonly string[]): Map<string, number> => new Map(order.map((id, i) => [id, i]));

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
  const index = lastReadIndex(orderIndex(previousOrder), currentOrder);
  return index < 0 ? [...currentOrder] : assembleOrder(previousOrder, currentOrder, index);
}
