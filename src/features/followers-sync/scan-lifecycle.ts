import { clearQuickTimeout } from '@/features/scheduler/alarms';
import type { ScanJob, ScanPauseReason, TrackedAccount } from '@/shared/types';
import { HOUR, MINUTE, SECOND } from '@/shared/utils/time';
import { scanHooks } from './scan-context';
import { dropJob, putJob } from './scan-store';
import { closeTab, send, sendVeil } from './scan-tab';

/** Passages d'un scan à l'état « en pause » ou « terminé sans analyse ». Appelées dans la file `serial`. */

/** Limite de X sans heure de reprise annoncée : nouvel essai après ce délai. */
const RATE_LIMIT_FALLBACK_MS = 15 * MINUTE;
/** Limite de X : attente minimale, et marge après l'heure annoncée. */
const RATE_LIMIT_MIN_WAIT_MS = 30 * SECOND;
const RATE_LIMIT_MARGIN_MS = 5 * SECOND;

export async function pause(job: ScanJob, reason: ScanPauseReason, resumeAt?: number) {
  // Limite de X : inutile de continuer à faire défiler (chaque essai serait refusé).
  if (reason === 'rate-limit' && job.tabId !== undefined) await send(job.tabId, 'drive-stop');
  job.status = 'paused';
  job.pausedReason = reason;
  job.resumeAt = resumeAt;
  job.updatedAt = Date.now();
  await putJob(job);
  if (resumeAt) await scanHooks().scheduleResume(job.accountId, resumeAt);
  await scanHooks().onStateChange();
}

/** Limite de requêtes de X : pause jusqu'à l'heure de reprise annoncée (au moins 30 s). */
export async function pauseForRateLimit(job: ScanJob, account: TrackedAccount, rateReset?: number): Promise<void> {
  const now = Date.now();
  // Heure annoncée dans la réponse : bornée, une valeur aberrante ne suspend pas le scan sans fin.
  const announced = rateReset !== undefined && Number.isFinite(rateReset) ? Math.min(rateReset, now + HOUR) : now + RATE_LIMIT_FALLBACK_MS;
  const resumeAt = Math.max(announced, now + RATE_LIMIT_MIN_WAIT_MS) + RATE_LIMIT_MARGIN_MS;
  await pause(job, 'rate-limit', resumeAt);
  await sendVeil(job, account);
}

/** Onglet fermé, scan en pause (autre compte connecté, session perdue). */
export async function closeAndPause(job: ScanJob, reason: ScanPauseReason): Promise<void> {
  await closeTab(job);
  await pause(job, reason);
}

/** Scan gardé comme incomplet, puis effacé. */
export async function finalizeIncomplete(job: ScanJob): Promise<void> {
  await scanHooks().onInterrupted(job);
  await dropJob(job.accountId);
  await scanHooks().onStateChange();
}

export async function discardQuick(job: ScanJob): Promise<void> {
  // Son délai d'expiration ne doit pas sonner plus tard sur un autre scan.
  await clearQuickTimeout(job.accountId);
  await closeTab(job);
  await dropJob(job.accountId);
  await scanHooks().onStateChange();
}

/** Arrête un scan en le gardant comme incomplet : ses abonnés serviront à « Continuer le scan ». */
export async function interrupt(job: ScanJob): Promise<void> {
  if (job.kind === 'quick') return discardQuick(job);
  await closeTab(job);
  await finalizeIncomplete(job);
}
