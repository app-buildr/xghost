import { accountIdOfKey } from '@/shared/storage/keys';
import { loadAccounts, settleWrites as settleAccounts } from '@/features/accounts/repository';
import { refreshBadge } from '@/features/alerts/badge';
import { settleSeen } from '@/features/events/commands';
import { cancelScan, settleAnalyses } from '@/features/followers-sync/scan-engine';
import { settleWrites as settleEvents } from '@/features/events/repository';
import { clearAccountAlarms } from '@/features/scheduler/alarms';
import { installedVersion } from '@/features/updates/version';
import { isTransientKey, MAX_BACKUP_BYTES, validateBackup, type BackupError } from './format';
import { withImportLock } from './lock';

/**
 * Import d'une sauvegarde (service worker, seul écrivain des données).
 *
 * 1. Validation complète du fichier : rien n'est touché s'il est refusé.
 * 2. Verrou d'import : le moteur ne lance ni ne poursuit de scan (voir lock.ts).
 * 3. Arrêt des scans, des alarmes de compte et des « vus » en attente.
 * 4. Écriture des nouvelles valeurs, puis suppression des clés absentes de la sauvegarde.
 *    En cas d'échec, l'état d'avant (copie en mémoire) est réécrit.
 */

/** `exportedAt` : date de la sauvegarde importée (affichée par l'onboarding). */
export type ImportResult = { ok: true; exportedAt: number } | { ok: false; error: BackupError | 'failed' };


/** Comptes concernés par des clés de stockage (scans et alarmes à arrêter). */
const accountIdsOf = (keys: string[]) =>
  keys.map(accountIdOfKey).filter((id): id is string => id !== undefined);

const persistent = (items: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(items).filter(([key]) => !isTransientKey(key)));

/**
 * Écrit `target`, puis supprime les clés persistantes qui n'y figurent pas (l'état passager
 * de cette installation est conservé). Écrire avant de supprimer : un échec en cours de route
 * ne laisse jamais le stockage vide.
 */
async function writeData(target: Record<string, unknown>): Promise<void> {
  await chrome.storage.local.set(target);
  const current = await chrome.storage.local.get(null);
  const stale = Object.keys(current).filter((k) => !isTransientKey(k) && !(k in target));
  if (stale.length) await chrome.storage.local.remove(stale);
}


export async function importBackup(raw: unknown): Promise<ImportResult> {
  // Taille vérifiée côté service worker aussi (le message peut venir d'une autre page de l'extension).
  if (JSON.stringify(raw ?? null).length > MAX_BACKUP_BYTES) return { ok: false, error: 'too-large' };
  const check = validateBackup(raw, installedVersion());
  if (!check.ok) return check;
  const backup = check.backup;

  return withImportLock(async () => {
    // Plus aucun travail ne démarre (verrou) ; on attend celui déjà lancé : une analyse de fin
    // de scan ou une écriture en file réécrirait sinon l'ancien état par-dessus la sauvegarde.
    await settleSeen();
    await settleAnalyses();
    await Promise.all([settleEvents(), settleAccounts()]);

    // Lecture de l'état courant : en cas d'échec, l'import s'arrête ici, sans rien modifier.
    const before = await chrome.storage.local.get(null).catch(() => undefined);
    if (!before) return { ok: false, error: 'failed' } as const;
    const affected = new Set([
      ...Object.keys(await loadAccounts()),
      ...accountIdsOf(Object.keys(before)),
      ...accountIdsOf(Object.keys(backup.data)),
    ]);
    // Plus aucun scan ni alarme de compte ne doit écrire pendant le remplacement.
    for (const accountId of affected) {
      await cancelScan(accountId);
      await clearAccountAlarms(accountId);
    }

    // Copie de secours de l'état courant, réécrite si l'import échoue en cours de route.
    const previous = persistent(before);
    try {
      await writeData(backup.data);
    } catch (err) {
      console.error(err);
      await writeData(previous).catch((e) => console.error(e));
      await refreshBadge().catch(() => undefined);
      return { ok: false, error: 'failed' } as const;
    }
    await refreshBadge();
    return { ok: true, exportedAt: backup.exportedAt } as const;
  });
}
