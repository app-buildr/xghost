import { t } from '@/shared/i18n';
import { send } from '@/shared/messaging/client';

/** « Afficher l'onglet » : montre l'onglet de scan quand Chrome a mis son chargement en pause. */
export function ShowScanTabButton({ accountId }: { accountId: string }) {
  return (
    <button
      type="button"
      className="xg-btn xg-btn--secondary"
      onClick={() => void send('scan:focus', { accountId }).catch(() => undefined)}
    >
      {t('common.scanStatus.showTab')}
    </button>
  );
}
