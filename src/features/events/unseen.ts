import { loadIgnored } from '@/features/accounts/repository';
import type { TrackedAccount } from '@/shared/types';
import { loadEvents, loadUnseen } from './repository';
import { unseenDepartures } from '@/domain/events/selectors';

/**
 * Départs non vus par compte (badge de l'icône, compteurs de la liste des comptes). Compteurs
 * enregistrés ; l'historique n'est décodé que pour un compte encore sans compteur.
 */
export async function unseenCountsByAccount(accounts: readonly TrackedAccount[]): Promise<Record<string, number>> {
  const stored = await loadUnseen();
  const entries = await Promise.all(
    accounts.map(async (a) => {
      const known = stored[a.id];
      if (known !== undefined) return [a.id, known] as const;
      const [events, ignored] = await Promise.all([loadEvents(a.id), loadIgnored(a.id)]);
      const ctx = { ignored, mutualsOnly: a.mutualsOnly };
      return [a.id, unseenDepartures(events, ctx).length] as const;
    }),
  );
  return Object.fromEntries(entries);
}
