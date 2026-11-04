import { t } from '@/shared/i18n';
import { send } from '@/shared/messaging/client';

/**
 * « Arrêter le scan » : sortie d'un scan bloqué. L'onglet se ferme et les abonnés déjà lus sont
 * gardés : « Continuer le scan » repart de là.
 */
export function StopScanButton({ accountId }: { accountId: string }) {
  return (
    <button
      type="button"
      className="xg-btn xg-btn--ghost"
      onClick={() => void send('scan:interrupt', { accountId }).catch(() => undefined)}
    >
      {t('common.scanStatus.stop')}
    </button>
  );
}
