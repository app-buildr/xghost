import type { ScanJob } from '@/shared/types';
import { clearJob, loadJob, loadProgress, saveJob, saveProgressOnly } from './repository';

// Scan en cours, gardé en mémoire (le service worker reste éveillé pendant un scan).

/**
 * État en mémoire d'un scan, par compte : le scan, les ids déjà lus et l'ancienne liste
 * ordonnée (arrêt anticipé, chargée une fois par scan). Un compte ne touche jamais à l'état
 * d'un autre (un contrôle léger abandonné ne peut pas évincer le scan d'un autre compte).
 */
export interface Live {
  job: ScanJob;
  /** Dernière écriture de la liste complète. */
  persistedAt?: number;
  readIds?: Set<string>;
  previousOrder?: string[] | null;
  /** Position de chaque abonné dans l'ancienne liste. */
  previousIndex?: Map<string, number>;
}
const live = new Map<string, Live>();

/** État en mémoire du scan d'un compte (créé s'il manque). */
export function liveOf(job: ScanJob): Live {
  const state = live.get(job.accountId) ?? { job };
  live.set(job.accountId, state);
  return state;
}
export async function getJob(accountId: string): Promise<ScanJob | undefined> {
  const cached = live.get(accountId);
  if (cached) return cached.job;
  const job = await loadJob(accountId);
  if (!job) return undefined;
  if (!job.finishing && job.kind !== 'quick') {
    // La liste complète n'est écrite que toutes les N pages : si l'état léger en compte plus,
    // le service worker a été relancé et les pages intermédiaires sont perdues.
    const progress = await loadProgress(accountId);
    if ((progress?.collected ?? 0) > (job.count ?? 0)) job.gap = true;
  }
  live.set(accountId, { job });
  return job;
}

/** Enregistre le scan : complet (liste comprise) si `full`, sinon seulement son état léger. */
export async function putJob(job: ScanJob, full = true): Promise<void> {
  // Nouvel objet de scan : son état en mémoire (ids lus, ancienne liste) repart de zéro.
  if (live.get(job.accountId)?.job !== job) live.set(job.accountId, { job });
  await (full ? saveJob(job) : saveProgressOnly(job));
}

export async function dropJob(accountId: string): Promise<void> {
  live.delete(accountId);
  await clearJob(accountId);
}
