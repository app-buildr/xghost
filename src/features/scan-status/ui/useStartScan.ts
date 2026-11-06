import { useCallback, useState } from 'react';
import { t } from '@/shared/i18n';
import { send } from '@/shared/messaging/client';
import type { CheckRefusal } from '@/shared/messaging/protocol';
import { useToast } from '@/shared/ui/toast';

const REFUSALS: Partial<Record<CheckRefusal, () => string>> = {
  disconnected: () => t('dashboard.check.reasons.disconnected'),
  'follower-limit': () => t('dashboard.check.reasons.followerLimit'),
  'already-running': () => t('dashboard.check.reasons.alreadyRunning'),
  'account-switched': () => t('dashboard.check.reasons.accountSwitched'),
  importing: () => t('common.errors.importing'),
};

const refusalText = (reason: CheckRefusal | undefined) =>
  (reason && REFUSALS[reason]?.()) ?? t('dashboard.check.impossible');

/**
 * Lance une vérification (contrôle léger, ou scan complet avec `full`) depuis n'importe quel
 * écran : un seul envoi à la fois, refus et erreurs annoncés par un toast.
 * Renvoie `true` si la vérification a démarré. `accountId` : compte affiché ; si ce n'est pas
 * le compte connecté sur x.com, la vérification est refusée au lieu de viser un autre compte.
 */
export function useStartScan(accountId?: string) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const start = useCallback(
    async ({ full = false, announce = full }: { full?: boolean; announce?: boolean } = {}) => {
      setBusy(true);
      try {
        const res = await send('scan:start', { accountId, full });
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
    [accountId, toast],
  );

  return { start, busy };
}
