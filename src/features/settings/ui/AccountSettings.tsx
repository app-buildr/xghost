import { useState } from 'react';
import { useEventActions, type AccountData } from '@/features/app-state/hooks';
import { send } from '@/shared/messaging/client';
import type { TrackedAccount } from '@/shared/types';
import { Avatar } from '@/shared/ui/primitives';
import { useToast } from '@/shared/ui/toast';

const noop = () => undefined;

/** Réglages propres au compte : comptes ignorés (réversible) et retrait du compte (§ 4.4). */
export function AccountSettings({ account, data }: { account: TrackedAccount; data: AccountData }) {
  const toast = useToast();
  const actions = useEventActions(account.id, noop);
  const [confirming, setConfirming] = useState(false);
  const ignored = [...data.ignored];
  const handleOf = (id: string) =>
    data.profiles[id]?.handle ?? data.events.find((e) => e.profileId === id)?.handle ?? id;

  return (
    <div className="xg-settings">
      <section className="xg-card">
        <h2 className="xg-card__title">Comptes ignorés</h2>
        {ignored.length === 0 ? (
          <p className="xg-setting__hint">Aucun compte ignoré pour @{account.handle}.</p>
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
                    Ne plus ignorer
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="xg-card">
        <h2 className="xg-card__title">Retirer @{account.handle}</h2>
        <p className="xg-setting__hint">
          Efface la référence, l’historique et les réglages de ce compte. Il sera de nouveau détecté si tu te reconnectes
          à lui sur x.com.
        </p>
        {confirming ? (
          <div className="xg-confirm">
            <button
              type="button"
              className="xg-btn xg-btn--danger"
              onClick={async () => {
                await send('account:remove', { accountId: account.id });
                toast.show(`@${account.handle} a été retiré`);
              }}
            >
              Confirmer le retrait
            </button>
            <button type="button" className="xg-btn xg-btn--secondary" onClick={() => setConfirming(false)}>
              Annuler
            </button>
          </div>
        ) : (
          <button type="button" className="xg-btn xg-btn--danger" onClick={() => setConfirming(true)}>
            Retirer ce compte
          </button>
        )}
      </section>
    </div>
  );
}
