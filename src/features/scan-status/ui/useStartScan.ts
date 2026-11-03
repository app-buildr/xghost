import { useCallback, useState } from 'react';
import { t } from '@/shared/i18n';
import { send } from '@/shared/messaging/client';
import { useToast } from '@/shared/ui/toast';

/** Raisons pour lesquelles le service worker refuse de lancer une vérification. */
type ScanRefusal = 'disconnected' | 'already-running' | 'rate-limit';

const REFUSALS: Record<ScanRefusal, () => string> = {
  disconnected: () => t('dashboard.check.reasons.disconnected'),
  'already-running': () => t('dashboard.check.reasons.alreadyRunning'),
  'rate-limit': () => t('dashboard.check.reasons.rateLimit'),
};

const refusalText = (reason: string | undefined) =>
  (reason && reason in REFUSALS ? REFUSALS[reason as ScanRefusal]() : undefined) ?? t('dashboard.check.impossible');

/**
 * Lance une vérification (contrôle léger, ou scan complet avec `full`) depuis n'importe quel
 * écran : un seul envoi à la fois, refus et erreurs annoncés par un toast.
 * Renvoie `true` si la vérification a démarré.
 */
export function useStartScan() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const start = useCallback(
    async ({ full = false, announce = full }: { full?: boolean; announce?: boolean } = {}) => {
      setBusy(true);
      try {
        const res = await send('scan:start', { full });
        if (!res.started) {
          toast.show(refusalText(res.reason));
          return false;
        }
        if (announce) toast.show(full ? t('dashboard.check.fullStarted') : t('dashboard.check.quickStarted'));
        return true;
      } catch {
        toast.show(t('dashboard.check.impossible'));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  return { start, busy };
}
