import { t } from '@/shared/i18n';
import { useStartScan } from './useStartScan';

/** « Continuer le scan » : reprend un scan incomplet, avec les abonnés déjà lus. */
export function ContinueScanButton({ accountId }: { accountId: string }) {
  const { start, busy } = useStartScan(accountId);
  return (
    <button type="button" className="xg-btn xg-btn--primary" disabled={busy} onClick={() => void start({ full: true, announce: false })}>
      {t('common.continueScan')}
    </button>
  );
}
