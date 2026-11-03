import { loadIgnored } from '@/features/accounts/repository';
import type { Settings, TrackedAccount } from '@/shared/types';
import { loadEvents } from './repository';
import { unseenDepartures } from './selectors';

/** Départs non vus par compte (badge de l'icône, compteurs de la liste des comptes). */
export async function unseenCountsByAccount(
  accounts: readonly TrackedAccount[],
  settings: Pick<Settings, 'ignoreSuspended'>,
): Promise<Record<string, number>> {
  const entries = await Promise.all(
    accounts.map(async (a) => {
      const [events, ignored] = await Promise.all([loadEvents(a.id), loadIgnored(a.id)]);
      const ctx = { ignored, ignoreSuspended: settings.ignoreSuspended, mutualsOnly: a.mutualsOnly };
      return [a.id, unseenDepartures(events, ctx).length] as const;
    }),
  );
  return Object.fromEntries(entries);
}
