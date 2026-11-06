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
  /** Scan terminé, analyse en cours. */
  finishing?: boolean;
  pausedReason?: ScanJob['pausedReason'];
  resumeAt?: number;
}

/**
 * Scan sans aucune page depuis ce délai (hors limite de X annoncée) : arrêté d'office, onglet
 * fermé, et gardé comme incomplet (« Continuer le scan »). Jamais de blocage sans fin.
 */
export const GIVE_UP_MS = 5 * MINUTE;

/** Environ trois ans de points quotidiens (limite aussi appliquée à l'import d'une sauvegarde). */
export const MAX_TOTALS = 1100;

/** Un scan complet de contrôle tous les N contrôles légers. */
export const SAFETY_EVERY = 10;
/** Total X en retard sur la liste : nouvelle vérification après ce délai. */
export const STALE_RECHECK_MS = 10 * MINUTE;
/** Contrôle léger : seule la première page compte, gardée dans la limite de ce nombre d'abonnés. */
export const QUICK_TOP_SIZE = 100;
/** Haut de la liste gardé dans l'ordre de x.com : doit couvrir la page d'un contrôle léger. */
export const SNAPSHOT_TOP_SIZE = 200;

/** Sans nouvel abonné depuis ce délai pendant un scan en cours, l'interface le signale comme bloqué. */
export const SHOW_STUCK_AFTER_MS = 45 * SECOND;
