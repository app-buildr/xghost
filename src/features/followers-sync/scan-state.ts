import type { FollowersPage } from '@/features/x-api/parse';
import type { ScanJob } from '@/shared/types';
import { MINUTE, SECOND } from '@/shared/utils/time';
import { GIVE_UP_MS, QUICK_TOP_SIZE } from './model';

/** Décisions pures du moteur de scan (sans onglet, stockage ni horloge). */

/** Sans nouvel abonné depuis ce délai, on considère le chargement bloqué. */
const STALL_MS = 20 * SECOND;
/** Onglet caché : délai plus long avant de demander à l'afficher (rendu simulé, plus lent). */
const HIDDEN_STALL_MS = MINUTE;
/** Bloqué alors que l'onglet est visible, après un « Réessayer » : fin de liste probable. */
const END_MS = MINUTE;
/**
 * La liste complète n'est écrite en stockage que toutes les N pages, et pas plus d'une fois par
 * intervalle (l'état léger, lui, à chaque page) : sur un gros compte, chaque écriture fait
 * plusieurs Mo. Un arrêt du service worker entre deux écritures est repéré (`gap`).
 */
const PERSIST_EVERY = 5;
const PERSIST_MIN_INTERVAL_MS = 30 * SECOND;

/** Fusionne une page de la liste dans le scan : abonnés, ordre de x.com, compteurs. */
export function mergePage(job: ScanJob, readIds: Set<string>, page: FollowersPage, now: number): void {
  const order = (job.top ??= []);
  let added = 0;
  for (const { id, ...profile } of page.users) {
    if (!(id in job.collected)) added++;
    job.collected[id] = profile;
    if (!readIds.has(id) && !(job.kind === 'quick' && order.length >= QUICK_TOP_SIZE)) {
      order.push(id);
      readIds.add(id);
    }
  }
  job.count = (job.count ?? 0) + added;
  if (page.skipped) job.skipped = (job.skipped ?? 0) + page.skipped;
  job.pages++;
  job.updatedAt = now;
  // Toute page reçue est un progrès, même sans nouvel abonné (reprise qui relit la zone déjà lue).
  job.lastProgressAt = now;
  job.failedPages = undefined;
  job.failureCycles = undefined;
  job.xError = undefined;
}

/** Faut-il écrire la liste complète après cette page ? */
export const shouldPersist = (job: ScanJob, persistedAt: number | undefined, now: number) =>
  job.kind === 'quick' || (job.pages % PERSIST_EVERY === 0 && now - (persistedAt ?? 0) >= PERSIST_MIN_INTERVAL_MS);

/** Scan sans aucune page depuis `GIVE_UP_MS`, hors pause qui attend une échéance. */
export function isStalled(
  p: Pick<ScanJob, 'status' | 'pausedReason' | 'lastProgressAt' | 'startedAt'>,
  now: number,
): boolean {
  if (p.status === 'paused' && p.pausedReason !== 'needs-focus') return false;
  return now - (p.lastProgressAt ?? p.startedAt) >= GIVE_UP_MS;
}

export type StallAction = 'none' | 'lookup' | 'retry' | 'rate-limit' | 'needs-focus' | 'finish';

/** Que faire à un pas de défilement, selon le temps passé sans nouvelle page. */
export function decideStall(job: ScanJob, visible: boolean, now: number): StallAction {
  if (job.status === 'paused' && job.pausedReason === 'rate-limit') return 'none';
  const idle = now - (job.lastProgressAt ?? job.startedAt);
  if (idle < STALL_MS) return 'none';
  // Rien de lu : le @handle enregistré a pu changer. Un seul passage par l'id du compte.
  if (job.pages === 0 && !job.totalSeen && !job.totalLookupAt) return 'lookup';
  // Chargement arrêté : un essai sur le bouton « Réessayer » de x.com, onglet visible ou non.
  if (!job.retriedAt || job.retriedAt < (job.lastProgressAt ?? 0)) return 'retry';
  // Toujours refusé après l'essai : comme une limite de X, pause puis reprise automatique
  // (au lieu d'attendre qu'on affiche l'onglet, ce qui n'y changerait rien).
  if (job.xError && idle >= HIDDEN_STALL_MS) return 'rate-limit';
  // Le rendu simulé fait normalement avancer la page cachée ; sinon, on demande à l'afficher.
  if (!visible) return idle >= HIDDEN_STALL_MS && job.pausedReason !== 'needs-focus' ? 'needs-focus' : 'none';
  // Toujours rien, onglet visible, après un nouvel essai : on considère la liste terminée.
  // Une liste trop courte est marquée incomplète (§ 4.7) et pourra être continuée.
  return idle >= END_MS ? 'finish' : 'none';
}
