import type { AccountData } from '@/features/app-state/useAccountData';
import { useEventActions } from '@/features/events/ui/useEventActions';
import { t } from '@/shared/i18n';
import { send } from '@/shared/messaging/client';
import type { TrackedAccount } from '@/shared/types';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { Avatar } from '@/shared/ui/primitives';
import { useToast } from '@/shared/ui/toast';
import './settings.css';

/** Réglages propres au compte : comptes ignorés (réversible) et retrait du compte (§ 4.4). */
export function AccountSettings({ account, data }: { account: TrackedAccount; data: AccountData }) {
  const toast = useToast();
  const actions = useEventActions(account.id);
  const ignored = [...data.ignored];
  const handleOf = (id: string) =>
    data.profiles[id]?.handle ?? data.events.find((e) => e.profileId === id)?.handle ?? id;

  return (
    <>
      <section className="xg-card">
        <h2 className="xg-card__title">{t('options.account.ignoredTitle')}</h2>
        {ignored.length === 0 ? (
          <p className="xg-setting__hint">{t('options.account.noIgnored', { handle: account.handle })}</p>
        ) : (
          <ul className="xg-ignored">
            {ignored.map((id) => {
              const handle = handleOf(id);
              return (
                <li key={id}>
                  <Avatar id={id} name={data.profiles[id]?.name ?? handle} src={data.profiles[id]?.avatar} size={36} />
                  <span>@{handle}</span>
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
      </section>

      <section className="xg-card">
        <h2 className="xg-card__title">{t('options.account.removeTitle', { handle: account.handle })}</h2>
        <p className="xg-setting__hint">{t('options.account.removeHint')}</p>
        <ConfirmAction
          danger
          label={t('options.account.remove')}
          confirmLabel={t('options.account.confirmRemove')}
          onConfirm={async () => {
            try {
              await send('account:remove', { accountId: account.id });
              toast.show(t('options.account.removed', { handle: account.handle }));
            } catch {
              toast.show(t('common.actions.failed'));
            }
          }}
        />
      </section>
    </>
  );
}
