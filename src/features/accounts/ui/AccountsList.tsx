import { useEffect, useState } from 'react';
import { unseenCountsByAccount } from '@/features/events/unseen';
import { onStorageChange } from '@/shared/storage/kv';
import type { GlobalStatus, Settings, TrackedAccount } from '@/shared/types';
import { Avatar } from '@/shared/ui/primitives';
import { formatAgo, formatBadgeCount } from '@/shared/utils/format';
import './accounts.css';

/** Départs non vus par compte, pour les compteurs de la liste et du sélecteur. */
export function useUnseenByAccount(accounts: TrackedAccount[], settings: Settings): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const ids = accounts.map((a) => `${a.id}:${a.mutualsOnly}`).join(',');
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const next = await unseenCountsByAccount(accounts, settings);
      if (alive) setCounts(next);
    };
    void run();
    const off = onStorageChange((k) => k.includes(':ev') || k.includes(':ign') || k.includes(':archive'), () => void run());
    return () => {
      alive = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, settings.ignoreSuspended]);
  return counts;
}

/** Bloc « Comptes X » de la page d'options (§ 3.4). Pas de bouton d'ajout : la détection est automatique. */
export function AccountsList({
  accounts,
  selectedId,
  status,
  unseen,
  now,
  onSelect,
}: {
  accounts: TrackedAccount[];
  selectedId?: string;
  status?: GlobalStatus;
  unseen: Record<string, number>;
  now: number;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="xg-accounts">
      <h2 className="xg-accounts__title">Comptes X</h2>
      {accounts.length > 0 && (
        <ul className="xg-accounts__list">
          {accounts.map((a) => {
            const active = status?.session === 'ok' && status.activeAccountId === a.id;
            const count = unseen[a.id] ?? 0;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  className={`xg-account${a.id === selectedId ? ' is-selected' : ''}`}
                  aria-current={a.id === selectedId}
                  onClick={() => onSelect(a.id)}
                >
                  <Avatar id={a.id} name={a.handle} size={40} />
                  <span className="xg-account__text">
                    <span className="xg-account__handle">@{a.handle}</span>
                    <span className={`xg-account__state${active ? ' is-active' : ''}`}>
                      {active
                        ? 'Session active'
                        : a.lastScanAt
                          ? `Vérifié ${formatAgo(a.lastScanAt, now)}`
                          : 'En attente de vérification'}
                    </span>
                  </span>
                  {count > 0 && (
                    <span className="xg-count" aria-label={`${count} départs non vus`}>
                      {formatBadgeCount(count)}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="xg-accounts__help">Connecte-toi à un autre compte sur x.com, xGhost le détecte tout seul.</p>
    </div>
  );
}
