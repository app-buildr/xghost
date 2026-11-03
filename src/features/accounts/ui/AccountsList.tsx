import type { GlobalStatus, TrackedAccount } from '@/shared/types';
import { t } from '@/shared/i18n';
import { Avatar } from '@/shared/ui/primitives';
import { formatAgo } from '@/shared/utils/format';
import { UnseenCount } from './UnseenCount';
import './accounts.css';

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
      <h2 className="xg-eyebrow xg-accounts__title">{t('options.accounts.title')}</h2>
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
                  aria-current={a.id === selectedId ? 'true' : undefined}
                  onClick={() => onSelect(a.id)}
                >
                  <Avatar id={a.id} name={a.handle} size={40} />
                  <span className="xg-account__text">
                    <span className="xg-account__handle">@{a.handle}</span>
                    <span className={`xg-account__state${active ? ' is-active' : ''}`}>
                      {active
                        ? t('options.accounts.activeSession')
                        : a.lastScanAt
                          ? t('common.checkedAgo', { ago: formatAgo(a.lastScanAt, now) })
                          : t('options.accounts.awaitingCheck')}
                    </span>
                  </span>
                  <UnseenCount count={count} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="xg-accounts__help">{t('options.accounts.help')}</p>
    </div>
  );
}
