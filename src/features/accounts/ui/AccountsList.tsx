import { useEffect, useId, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { GlobalStatus, TrackedAccount } from '@/shared/types';
import { t } from '@/shared/i18n';
import { Avatar } from '@/shared/ui/primitives';
import { formatAgo } from '@/shared/utils/format';
import { UnseenCount } from './UnseenCount';
import { useRemoveAccount } from './useRemoveAccount';
import './accounts.css';

/**
 * Bloc « Comptes X » de la page d'options (§ 3.4). Pas de bouton d'ajout : la détection est automatique.
 * Chaque compte peut être supprimé avec ses données : la corbeille de sa ligne ouvre une confirmation.
 */
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
  const remove = useRemoveAccount();
  const confirmIds = useId();
  // Compte dont la suppression attend confirmation (une seule à la fois).
  const [confirming, setConfirming] = useState<string>();
  const list = useRef<HTMLUListElement>(null);
  const trashButtons = useRef(new Map<string, HTMLButtonElement>());
  // Compte en cours de suppression depuis sa ligne : le focus, perdu avec elle, est replacé ensuite.
  const removing = useRef<string>(undefined);

  // Compte disparu de la liste (supprimé ici ou dans les réglages) : la confirmation se ferme, et
  // ne se rouvre pas si le compte est de nouveau détecté plus tard.
  if (confirming && !accounts.some((a) => a.id === confirming)) setConfirming(undefined);

  useEffect(() => {
    const id = removing.current;
    if (!id || accounts.some((a) => a.id === id)) return;
    removing.current = undefined;
    if (document.activeElement !== document.body) return;
    const target =
      list.current?.querySelector<HTMLElement>('.xg-account[aria-current="true"]') ??
      list.current?.querySelector<HTMLElement>('.xg-account');
    target?.focus();
  }, [accounts]);

  const closeConfirm = (id: string) => {
    setConfirming(undefined);
    trashButtons.current.get(id)?.focus();
  };

  const confirmRemove = async (account: TrackedAccount) => {
    // Posé avant l'envoi : la liste peut changer avant la réponse du service worker.
    removing.current = account.id;
    if (await remove(account)) return true;
    removing.current = undefined;
    return false;
  };

  return (
    <div className="xg-accounts">
      <h2 className="xg-eyebrow xg-accounts__title">{t('options.accounts.title')}</h2>
      {accounts.length > 0 && (
        <ul ref={list} className="xg-boxlist xg-accounts__list">
          {accounts.map((a) => {
            const active = status?.session === 'ok' && status.activeAccountId === a.id;
            const selected = a.id === selectedId;
            const open = confirming === a.id;
            const confirmId = `${confirmIds}-${a.id}`;
            const removeLabel = t('options.accounts.remove', { handle: a.handle });
            return (
              <li key={a.id} className={`xg-account-row${selected ? ' is-selected' : ''}`}>
                <div className="xg-account-row__main">
                  <button
                    type="button"
                    className="xg-account"
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => onSelect(a.id)}
                  >
                    <Avatar id={a.id} name={a.handle} src={a.avatar} size={40} />
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
                    {/* Emplacement fixe : la corbeille s'y superpose (largeur du texte inchangée). */}
                    <span className="xg-account__end">
                      <UnseenCount count={unseen[a.id] ?? 0} />
                    </span>
                  </button>
                  <button
                    ref={(el) => {
                      if (el) trashButtons.current.set(a.id, el);
                      else trashButtons.current.delete(a.id);
                    }}
                    type="button"
                    className="xg-account-row__remove"
                    aria-label={removeLabel}
                    title={removeLabel}
                    aria-expanded={open}
                    aria-controls={open ? confirmId : undefined}
                    onClick={() => (open ? closeConfirm(a.id) : setConfirming(a.id))}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
                {open && (
                  <ConfirmRemove
                    id={confirmId}
                    account={a}
                    onConfirm={() => confirmRemove(a)}
                    onCancel={() => closeConfirm(a.id)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="xg-accounts__help">{t('options.accounts.help')}</p>
    </div>
  );
}

/** Confirmation dans la ligne du compte : ce qui sera effacé, puis « Supprimer / Annuler ». */
function ConfirmRemove({
  id,
  account,
  onConfirm,
  onCancel,
}: {
  id: string;
  account: TrackedAccount;
  onConfirm: () => Promise<boolean>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);

  // Focus sur « Annuler » : un Entrée de trop après la corbeille ne supprime rien.
  useEffect(() => cancel.current?.focus(), []);

  return (
    <div
      id={id}
      className="xg-account-row__confirm"
      role="group"
      aria-label={t('options.accounts.remove', { handle: account.handle })}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onCancel();
      }}
    >
      <p>{t('options.accounts.removeConfirm', { handle: account.handle })}</p>
      <div className="xg-account-row__actions">
        <button
          type="button"
          className="xg-btn xg-btn--danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            // Supprimé : la ligne disparaît avec la liste. Échec : la confirmation reste ouverte.
            if (!(await onConfirm())) setBusy(false);
          }}
        >
          {t('options.accounts.removeAction')}
        </button>
        <button ref={cancel} type="button" className="xg-btn xg-btn--secondary" disabled={busy} onClick={onCancel}>
          {t('common.actions.cancel')}
        </button>
      </div>
    </div>
  );
}
