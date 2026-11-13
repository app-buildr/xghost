import type { AccountData } from '@/features/app-state/useAccountData';
import { useRemoveAccount } from '@/features/accounts/ui/useRemoveAccount';
import { useEventActions } from '@/features/events/ui/useEventActions';
import { t } from '@/shared/i18n';
import type { TrackedAccount } from '@/shared/types';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { Avatar, Card } from '@/shared/ui/primitives';
import './settings.css';

/** Réglages propres au compte (§ 4.4) : comptes ignorés (réversible)… */
export function IgnoredAccounts({ account, data }: { account: TrackedAccount; data: AccountData }) {
  const actions = useEventActions(account.id);
  const ignored = [...data.ignored];
  const handleOf = (id: string) =>
    data.profiles[id]?.handle ?? data.events.find((e) => e.profileId === id)?.handle ?? id;

  return (
    <Card title={t('options.account.ignoredTitle')}>
      {ignored.length === 0 ? (
        <p className="xg-setting__hint">{t('options.account.noIgnored', { handle: account.handle })}</p>
      ) : (
        <ul className="xg-ignored">
          {ignored.map((id) => {
            const handle = handleOf(id);
            return (
              <li key={id}>
                <Avatar id={id} name={data.profiles[id]?.name ?? handle} src={data.profiles[id]?.avatar} size={36} />
                <span className="xg-ignored__handle">@{handle}</span>
                <button
                  type="button"
                  className="xg-btn xg-btn--secondary"
                  onClick={() => void actions.ignore(id, handle, false)}
                >
                  {t('options.account.unignore')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** …et retrait du compte, placé en dernier (action destructrice). */
export function RemoveAccount({ account }: { account: TrackedAccount }) {
  const remove = useRemoveAccount();
  return (
    <Card title={t('options.account.removeTitle', { handle: account.handle })}>
      <p className="xg-setting__hint">{t('options.account.removeHint')}</p>
      <ConfirmAction
        danger
        label={t('options.account.remove')}
        confirmLabel={t('options.account.confirmRemove')}
        onConfirm={async () => {
          await remove(account);
        }}
      />
    </Card>
  );
}
