import { useCallback, useState } from 'react';
import { MAX_BACKUP_BYTES, type BackupError } from '@/features/backup/format';
import { t } from '@/shared/i18n';
import { send } from '@/shared/messaging/client';
import { useToast } from '@/shared/ui/toast';

/** Fichier choisi et lu, prêt à être importé. */
export interface PickedBackup {
  name: string;
  backup: unknown;
}

/**
 * Import d'une sauvegarde, partagé par les réglages et l'onboarding : lecture du fichier
 * (taille vérifiée avant lecture, JSON), puis envoi au service worker qui valide tout avant
 * de remplacer les données. Les échecs sont annoncés par un toast.
 */
export function useBackupImport() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const failure = useCallback(
    (error: BackupError | 'failed') => toast.show(t(`backup.errors.${error}`)),
    [toast],
  );

  const readFile = useCallback(
    async (file: File | undefined): Promise<PickedBackup | undefined> => {
      if (!file) return undefined;
      // Taille vérifiée avant lecture : un fichier énorme ne peut pas bloquer la page.
      if (file.size > MAX_BACKUP_BYTES) return void failure('too-large');
      try {
        return { name: file.name, backup: JSON.parse(await file.text()) as unknown };
      } catch {
        return void failure('invalid');
      }
    },
    [failure],
  );

  /** Remplace les données par la sauvegarde ; renvoie sa date en cas de succès. */
  const importBackup = useCallback(
    async (picked: PickedBackup): Promise<number | undefined> => {
      setBusy(true);
      try {
        const result = await send('data:import', { backup: picked.backup });
        if (result.ok) return result.exportedAt;
        failure(result.error);
      } catch {
        failure('failed');
      } finally {
        setBusy(false);
      }
      return undefined;
    },
    [failure],
  );

  return { readFile, importBackup, busy };
}
