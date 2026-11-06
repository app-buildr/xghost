import { useMemo, useRef, useState } from 'react';
import { exportBackup } from '@/features/backup/export';
import { byteLength, MAX_BACKUP_BYTES, summarizeBackup } from '@/features/backup/format';
import { t } from '@/shared/i18n';
import { Card } from '@/shared/ui/primitives';
import { useToast } from '@/shared/ui/toast';
import { formatDate, formatList, formatNumber } from '@/shared/utils/format';
import { installedVersion } from '@/shared/utils/version';
import { type PickedBackup, useBackupImport } from './useBackupImport';

/** Ce que contient le fichier choisi : l'import remplace tout, le nom du fichier ne suffit pas. */
function backupSummaryText(backup: unknown): string | undefined {
  const summary = summarizeBackup(backup, installedVersion());
  if (!summary) return undefined;
  return t('backup.summary', {
    accounts: formatList(summary.handles.map((handle) => `@${handle}`)),
    count: summary.events,
    n: formatNumber(summary.events),
    date: formatDate(summary.exportedAt),
  });
}

/**
 * Bloc « Sauvegarde » des réglages : exporter toutes les données dans un fichier, et les
 * restaurer depuis ce fichier (après une réinstallation, ou sur un autre ordinateur).
 * L'export lit le stockage depuis la page ; l'import passe par le service worker, qui valide
 * le fichier entier avant de toucher aux données.
 */
export function DataPanel() {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  // Fichier plus gros que ce que l'import accepte : à signaler tout de suite, pas à la restauration.
  const [tooLarge, setTooLarge] = useState(false);
  // Fichier choisi, en attente de confirmation (l'import remplace tout).
  const [pending, setPending] = useState<PickedBackup>();
  const summary = useMemo(() => (pending ? backupSummaryText(pending.backup) : undefined), [pending]);
  const { readFile, importBackup, busy: importing } = useBackupImport();
  const busy = exporting || importing;

  const exportData = async () => {
    setExporting(true);
    try {
      const json = JSON.stringify(await exportBackup());
      setTooLarge(byteLength(json) > MAX_BACKUP_BYTES);
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = t('backup.fileName', { date: new Date().toISOString().slice(0, 10) });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.show(t('backup.exported'));
    } catch {
      toast.show(t('backup.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  const pickFile = async (file: File | undefined) => setPending(await readFile(file));

  const importData = async () => {
    if (!pending) return;
    if ((await importBackup(pending)) === undefined) return;
    setPending(undefined);
    toast.show(t('backup.imported'));
  };

  return (
    <Card title={t('backup.title')}>
      <p className="xg-setting__hint">{t('backup.hint')}</p>
      {tooLarge && (
        <p className="xg-setting__hint" role="alert">
          {t('backup.tooLargeWarning')}
        </p>
      )}
      {pending ? (
        <>
          <p className="xg-setting__hint">{t('backup.confirmText', { file: pending.name })}</p>
          <p className="xg-setting__hint">{summary}</p>
          <div className="xg-confirm">
            <button type="button" className="xg-btn xg-btn--danger" disabled={busy} onClick={() => void importData()}>
              {t('backup.confirmImport')}
            </button>
            <button type="button" className="xg-btn xg-btn--secondary" disabled={busy} onClick={() => void exportData()}>
              {t('backup.exportFirst')}
            </button>
            <button type="button" className="xg-btn xg-btn--secondary" disabled={busy} onClick={() => setPending(undefined)}>
              {t('common.actions.cancel')}
            </button>
          </div>
        </>
      ) : (
        <div className="xg-confirm">
          <button type="button" className="xg-btn xg-btn--secondary" disabled={busy} onClick={() => void exportData()}>
            {t('backup.export')}
          </button>
          <button type="button" className="xg-btn xg-btn--secondary" disabled={busy} onClick={() => input.current?.click()}>
            {t('backup.import')}
          </button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          void pickFile(e.target.files?.[0]);
          e.target.value = ''; // permet de choisir à nouveau le même fichier
        }}
      />
    </Card>
  );
}
