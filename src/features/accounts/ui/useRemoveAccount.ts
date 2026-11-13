import { t } from '@/shared/i18n';
import { send } from '@/shared/messaging/client';
import type { TrackedAccount } from '@/shared/types';
import { useToast } from '@/shared/ui/toast';

/**
 * Retrait d'un compte (liste des comptes, réglages) : le service worker efface toutes ses données
 * (référence, historique, réglages, alarmes) et change de compte affiché si besoin.
 * Renvoie `true` si le compte a été retiré ; un échec est signalé sans lever d'erreur.
 */
export function useRemoveAccount(): (account: Pick<TrackedAccount, 'id' | 'handle'>) => Promise<boolean> {
  const toast = useToast();
  return async (account) => {
    try {
      await send('account:remove', { accountId: account.id });
      toast.show(t('options.account.removed', { handle: account.handle }));
      return true;
    } catch {
      toast.show(t('common.actions.failed'));
      return false;
    }
  };
}
