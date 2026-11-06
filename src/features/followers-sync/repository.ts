import { isSameDay } from '@/shared/utils/time';
import { MAX_TOTALS, type ScanProgress } from './model';
import { encodeStored, localKv } from '@/shared/storage/kv';
import { accountKeysOf, keys } from '@/shared/storage/keys';
import type { PartialScan, ProfileCache, ScanJob, Snapshot } from '@/shared/types';

/** Données locales d'un compte : instantané, cache des profils, scan en cours (§ 5.2). */

export const loadSnapshot = (accountId: string) => localKv.get<Snapshot>(keys.snapshot(accountId));
export const saveSnapshot = (accountId: string, snapshot: Snapshot) =>
  localKv.set({ [keys.snapshot(accountId)]: snapshot });

export async function loadProfiles(accountId: string): Promise<ProfileCache> {
  return (await localKv.getLarge<ProfileCache>(keys.profiles(accountId))) ?? {};
}
export const saveProfiles = (accountId: string, profiles: ProfileCache) =>
  localKv.set({ [keys.profiles(accountId)]: encodeStored(profiles) });

/** Total d'abonnés relevé par jour : `[date, total]`, du plus ancien au plus récent. */
export type TotalPoint = [number, number];
export async function loadTotals(accountId: string): Promise<TotalPoint[]> {
  const raw = await localKv.get<unknown>(keys.totals(accountId));
  return Array.isArray(raw)
    ? raw.filter(
        (p): p is TotalPoint =>
          Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isSafeInteger(p[1]) && p[1] >= 0,
      )
    : [];
}

/** Retient le total annoncé par X pour le jour de `at` (le dernier relevé du jour l'emporte). */
export async function recordTotal(accountId: string, total: number, at: number): Promise<void> {
  if (!Number.isSafeInteger(total) || total < 0) return;
  const points = (await loadTotals(accountId)).filter(([t]) => !isSameDay(t, at));
  points.push([at, total]);
  points.sort((a, b) => a[0] - b[0]);
  await localKv.set({ [keys.totals(accountId)]: points.slice(-MAX_TOTALS) });
}

export const loadJob = (accountId: string) => localKv.getLarge<ScanJob>(keys.scanJob(accountId));

export const loadPartial = (accountId: string) => localKv.get<PartialScan>(keys.partialScan(accountId));
export const savePartial = (accountId: string, partial: PartialScan) =>
  localKv.set({ [keys.partialScan(accountId)]: partial });
export const clearPartial = (accountId: string) => localKv.remove(keys.partialScan(accountId));

const toProgress = (job: ScanJob): ScanProgress => ({
  kind: job.kind,
  status: job.status,
  collected: job.count ?? Object.keys(job.collected).length,
  seeded: job.seeded ?? 0,
  expected: job.expectedTotal,
  startedAt: job.startedAt,
  updatedAt: job.updatedAt,
  lastProgressAt: job.lastProgressAt,
  finishing: job.finishing,
  reason: job.reason,
  pausedReason: job.pausedReason,
  resumeAt: job.resumeAt,
});

export const saveJob = (job: ScanJob) =>
  localKv.set({ [keys.scanJob(job.accountId)]: encodeStored(job), [keys.scanProgress(job.accountId)]: toProgress(job) });
export const saveProgressOnly = (job: ScanJob) => localKv.set({ [keys.scanProgress(job.accountId)]: toProgress(job) });
export const clearJob = (accountId: string) =>
  localKv.remove([keys.scanJob(accountId), keys.scanProgress(accountId)]);

/** Efface toutes les données d'un compte. */
export const deleteAccountData = (accountId: string) => localKv.remove(accountKeysOf(accountId));

/** État léger du scan d'un compte (barre de progression, détection de blocage). */
export const loadProgress = (accountId: string) => localKv.get<ScanProgress>(keys.scanProgress(accountId));

/** États légers des scans de plusieurs comptes. */
export async function loadProgresses(accountIds: readonly string[]): Promise<(ScanProgress | undefined)[]> {
  const items = await localKv.getMany(accountIds.map(keys.scanProgress));
  return accountIds.map((id) => items[keys.scanProgress(id)] as ScanProgress | undefined);
}
