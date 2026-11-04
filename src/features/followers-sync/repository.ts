import { localKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import type { PartialScan, Profile, ScanJob, Snapshot } from '@/shared/types';

/** Données locales d'un compte : instantané, cache des profils, scan en cours (§ 5.2). */

export type ProfileCache = Record<string, Omit<Profile, 'id'>>;

export const loadSnapshot = (accountId: string) => localKv.get<Snapshot>(keys.snapshot(accountId));
export const saveSnapshot = (accountId: string, snapshot: Snapshot) =>
  localKv.set({ [keys.snapshot(accountId)]: snapshot });

export async function loadProfiles(accountId: string): Promise<ProfileCache> {
  return (await localKv.get<ProfileCache>(keys.profiles(accountId))) ?? {};
}
export const saveProfiles = (accountId: string, profiles: ProfileCache) =>
  localKv.set({ [keys.profiles(accountId)]: profiles });

/** Total d'abonnés relevé par jour : `[date, total]`, du plus ancien au plus récent. */
export type TotalPoint = [number, number];
/** Environ trois ans de points quotidiens. */
const MAX_TOTALS = 1100;

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
  const day = new Date(at).toDateString();
  const points = (await loadTotals(accountId)).filter(([t]) => new Date(t).toDateString() !== day);
  points.push([at, total]);
  points.sort((a, b) => a[0] - b[0]);
  await localKv.set({ [keys.totals(accountId)]: points.slice(-MAX_TOTALS) });
}

export const loadJob = (accountId: string) => localKv.get<ScanJob>(keys.scanJob(accountId));

export const loadPartial = (accountId: string) => localKv.get<PartialScan>(keys.partialScan(accountId));
export const savePartial = (accountId: string, partial: PartialScan) =>
  localKv.set({ [keys.partialScan(accountId)]: partial });
export const clearPartial = (accountId: string) => localKv.remove(keys.partialScan(accountId));

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
  error?: string;
}

const toProgress = (job: ScanJob): ScanProgress => ({
  kind: job.kind,
  status: job.status,
  collected: job.count ?? Object.keys(job.collected).length,
  seeded: job.seeded ?? 0,
  expected: job.expectedTotal,
  startedAt: job.startedAt,
  updatedAt: job.updatedAt,
  lastProgressAt: job.lastProgressAt,
  reason: job.reason,
  pausedReason: job.pausedReason,
  resumeAt: job.resumeAt,
  error: job.error,
});

export const saveJob = (job: ScanJob) =>
  localKv.set({ [keys.scanJob(job.accountId)]: job, [keys.scanProgress(job.accountId)]: toProgress(job) });
export const saveProgressOnly = (job: ScanJob) => localKv.set({ [keys.scanProgress(job.accountId)]: toProgress(job) });
export const clearJob = (accountId: string) =>
  localKv.remove([keys.scanJob(accountId), keys.scanProgress(accountId)]);

export async function deleteLocalAccountData(accountId: string): Promise<void> {
  await localKv.remove([
    keys.snapshot(accountId),
    keys.profiles(accountId),
    keys.scanJob(accountId),
    keys.scanProgress(accountId),
    keys.partialScan(accountId),
    keys.suspicious(accountId),
    keys.lastVisit(accountId),
    keys.totals(accountId),
  ]);
}
