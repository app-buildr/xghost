import { unseenCountsByAccount } from '@/features/events/unseen';
import { useStorageQuery } from '@/shared/hooks/useStorageQuery';
import { keys } from '@/shared/storage/keys';
import type { TrackedAccount } from '@/shared/types';

/** Départs non vus par compte, pour les compteurs de la liste des comptes et du sélecteur de la popup. */
export function useUnseenByAccount(accounts: readonly TrackedAccount[]): Record<string, number> {
  // `accounts` change d'identité à chaque lecture : on suit ce qui compte (ids, follow back seulement).
  const ids = accounts.map((a) => `${a.id}:${a.mutualsOnly}`).join(',');
  return (
    useStorageQuery(() => unseenCountsByAccount(accounts).catch(() => ({})), (k) => k === keys.unseen, [ids]).data ?? EMPTY
  );
}

const EMPTY: Record<string, number> = {};
