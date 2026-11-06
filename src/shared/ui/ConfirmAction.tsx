import { useState } from 'react';
import { t } from '@/shared/i18n';

/**
 * Action à confirmer (retrait de compte) : un premier bouton, puis « Confirmer / Annuler ».
 * Le bouton de confirmation est désactivé pendant l'action ; une erreur rend la main sans fermer.
 */
export function ConfirmAction({
  label,
  confirmLabel,
  onConfirm,
  danger = false,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  danger?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const tone = danger ? 'xg-btn--danger' : 'xg-btn--primary';

  if (!confirming) {
    return (
      <button type="button" className={`xg-btn ${tone}`} onClick={() => setConfirming(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="xg-confirm">
      <button
        type="button"
        className={`xg-btn ${tone}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
            setConfirming(false);
          } finally {
            setBusy(false);
          }
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="xg-btn xg-btn--secondary" disabled={busy} onClick={() => setConfirming(false)}>
        {t('common.actions.cancel')}
      </button>
    </div>
  );
}
