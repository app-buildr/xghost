import type { ScanJob } from '@/shared/types';
import { MINUTE, SECOND } from '@/shared/utils/time';

/** Modèle du scan partagé par le moteur et les interfaces (sans stockage ni API Chrome). */

/** État léger du scan, lu par les interfaces (barre de progression) sans charger la liste. */
export interface ScanProgress {
  kind: ScanJob['kind'];
  status: ScanJob['status'];
  collected: number;
  /** Abonnés repris d'un scan incomplet (exclus du calcul de vitesse). */
  seeded: number;
  expected: number;
  startedAt: number;
  updatedAt: number;
  reason?: ScanJob['reason'];
  /** Dernière page de la liste reçue (détection d'un scan bloqué). */
  lastProgressAt?: number;
  pausedReason?: ScanJob['pausedReason'];
  resumeAt?: number;
}

/**
 * Scan sans aucune page depuis ce délai (hors limite de X annoncée) : arrêté d'office, onglet
 * fermé, et gardé comme incomplet (« Continuer le scan »). Jamais de blocage sans fin.
 */
export const GIVE_UP_MS = 5 * MINUTE;

/** Sans nouvel abonné depuis ce délai pendant un scan en cours, l'interface le signale comme bloqué. */
export const SHOW_STUCK_AFTER_MS = 45 * SECOND;
