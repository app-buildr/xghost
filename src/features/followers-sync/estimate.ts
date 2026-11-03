/** Estimation du temps restant d'un scan, partagée par l'overlay, l'onboarding et le tableau de bord. */

export interface ScanPace {
  collected: number;
  /** Abonnés repris d'un scan incomplet : exclus du calcul de vitesse. */
  seeded?: number;
  expected: number;
  startedAt: number;
}

/** Temps restant en ms, ou `undefined` tant que la vitesse n'est pas mesurable. */
function estimateRemainingMs(p: ScanPace, now = Date.now()): number | undefined {
  const fresh = p.collected - (p.seeded ?? 0);
  const elapsed = now - p.startedAt;
  if (p.expected <= 0 || fresh <= 0 || elapsed < 5_000 || p.collected >= p.expected) return undefined;
  return (p.expected - p.collected) / (fresh / elapsed);
}

/** « Environ 2 min restantes », « Moins d’une minute restante », ou `undefined`. */
export function remainingLabel(p: ScanPace, now = Date.now()): string | undefined {
  const ms = estimateRemainingMs(p, now);
  if (ms === undefined) return undefined;
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'Moins d’une minute restante';
  if (min < 60) return `Environ ${min} min restante${min > 1 ? 's' : ''}`;
  return `Environ ${Math.round(min / 60)} h restantes`;
}
