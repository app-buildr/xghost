import { installedVersion } from '@/shared/utils/version';
import { BACKUP_APP, BACKUP_FORMAT, backupItems, type Backup } from './format';

/**
 * Export, exécuté directement dans la page d'options : les pages de l'extension lisent le
 * stockage elles-mêmes, ce qui évite la limite de taille des messages vers le service worker.
 */
export async function exportBackup(): Promise<Backup> {
  const stored = await chrome.storage.local.get(null);
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    version: installedVersion(),
    exportedAt: Date.now(),
    data: backupItems(stored),
  };
}
