import { percentOf } from '@/shared/utils/format';

/** Couverture d'un scan (abonnés relus / annoncés par X), en %. Liste vide : 100 %. */
export const scanCoverage = (scan: { scanned: number; detected: number }) =>
  percentOf(scan.scanned, scan.detected, { emptyIsFull: true });

/** Maximum de la barre de progression d'un scan en cours (total X inconnu : barre presque pleine). */
export const progressMax = (p: { collected: number; expected: number }) => p.expected || p.collected + 1;
