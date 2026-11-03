import { UpdateBanner } from '@/features/updates/UpdateBanner';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useUnseenByAccount } from '@/features/accounts/ui/AccountsList';
import { useAccountData, useAppState, visibilityContext } from '@/features/app-state/hooks';
import { DepartureRowCompact } from '@/features/departures/ui/DepartureRow';
import { currentDepartures, stats7d } from '@/features/events/selectors';
import { ScanStatusBanner } from '@/features/scan-status/ui/ScanStatusBanner';
import { useNow } from '@/shared/hooks/useNow';
import { send } from '@/shared/messaging/client';
import { localKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import { IconChevronDown, IconRefresh, IconSettings } from '@/shared/ui/icons';
import { Logo } from '@/shared/ui/primitives';
import { formatAgo, formatNumber, formatSigned, percentOf, plural } from '@/shared/utils/format';
import './popup.css';

const openOptions = () => {
  void chrome.runtime.openOptionsPage();
  window.close();
};

/** Ouvre l'onboarding (ou ramène l'onglet existant au premier plan), puis ferme la popup. */
async function openOnboarding(): Promise<void> {
  const url = chrome.runtime.getURL('/onboarding.html');
  const [existing] = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB], documentUrls: [url] });
  if (existing && existing.tabId >= 0) {
    await chrome.tabs.update(existing.tabId, { active: true });
    if (existing.windowId >= 0) await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
}

/**
 * Date de la visite précédente, figée à l'ouverture de la popup, puis mise à jour :
 * l'encart « depuis ta dernière visite » reste stable tant que la popup est ouverte.
 */
function usePreviousVisit(accountId: string | undefined): number | null | undefined {
  const [previous, setPrevious] = useState<number | null>();
  const done = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!accountId || done.current === accountId) return;
    done.current = accountId;
    void localKv.get<number>(keys.lastVisit(accountId)).then(async (v) => {
      setPrevious(v ?? null);
      await localKv.set({ [keys.lastVisit(accountId)]: Date.now() });
    });
  }, [accountId]);
  return previous;
}

export function PopupApp() {
  const app = useAppState();
  const now = useNow();
  const account = app.selected;
  const { data } = useAccountData(account?.id, { seenOnView: true });
  const ctx = useMemo(() => visibilityContext(data, app.settings, account), [data, app.settings, account]);
  const previousVisit = usePreviousVisit(account?.id);
  const unseenByAccount = useUnseenByAccount(app.accounts, app.settings);
  const [menuOpen, setMenuOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  const list = useMemo(() => (data ? currentDepartures(data.events, ctx) : []), [data, ctx]);
  const latest = list.slice(0, 5);
  const stats = useMemo(() => stats7d(data?.events ?? [], ctx, now), [data?.events, ctx, now]);
  // `list` ne contient déjà que les comptes toujours absents.
  const fresh = useMemo(
    () => list.filter((e) => !e.seen && (previousVisit == null || e.at > previousVisit)).length,
    [list, previousVisit],
  );

  // Tant que la première synchronisation n'est pas terminée, un clic sur l'icône
  // ouvre l'écran de synchronisation plutôt que la popup.
  const onboarded = app.accounts.some((a) => a.baselineAt);
  useEffect(() => {
    if (!app.loading && !onboarded) void openOnboarding();
  }, [app.loading, onboarded]);

  if (app.loading || !onboarded) return <div className="xg-popup" />;

  return (
    <div className="xg-popup">
      <header className="xg-popup__head">
        <Logo size={40} />
        <div className="xg-popup__account">
          {account ? (
            <button
              type="button"
              className="xg-popup__switch"
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              disabled={app.accounts.length < 2}
            >
              <span className="xg-popup__handle">@{account.handle}</span>
              {app.accounts.length > 1 && <IconChevronDown size={18} />}
            </button>
          ) : (
            <span className="xg-popup__handle">xGhost</span>
          )}
          {account && (
            <span className="xg-popup__sub">
              {account.followersCount !== undefined ? `${formatNumber(account.followersCount)} abonnés · ` : ''}
              {plural(app.accounts.length, 'compte')} X
            </span>
          )}
          {menuOpen && (
            <ul className="xg-popup__menu" role="listbox" aria-label="Changer de compte">
              {app.accounts.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={a.id === account?.id}
                    onClick={() => {
                      void app.select(a.id);
                      setMenuOpen(false);
                    }}
                  >
                    <span>@{a.handle}</span>
                    {(unseenByAccount[a.id] ?? 0) > 0 && <span className="xg-count">{unseenByAccount[a.id]}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" className="xg-icon-btn" aria-label="Réglages" onClick={openOptions}>
          <IconSettings size={24} />
        </button>
      </header>

      <ScanStatusBanner account={account} progress={data?.progress} status={app.status} now={now} compact />

      {fresh > 0 && (
        <div className="xg-popup__alert" role="status">
          <strong>{fresh}</strong>
          <span>
            <b>{fresh > 1 ? 'nouveaux départs' : 'nouveau départ'}</b>
            <br />
            depuis ta dernière visite
          </span>
        </div>
      )}

      {account?.lastScan && !account.lastScan.complete && !data?.progress && (
        <button
          type="button"
          className="xg-popup__alert xg-popup__alert--link"
          onClick={() => void chrome.runtime.openOptionsPage().then(() => window.close())}
        >
          <span>
            <b>Scan incomplet ({percentOf(account.lastScan.scanned, account.lastScan.detected, { emptyIsFull: true })} %)</b>
            <br />
            ouvre le tableau de bord pour le terminer
          </span>
        </button>
      )}

      {account && (
        <section>
          <h2 className="xg-popup__section">Derniers unfollows</h2>
          {latest.length === 0 ? (
            <p className="xg-popup__empty">Aucun départ pour l’instant. xGhost veille.</p>
          ) : (
            <ul className="xg-dep-list">
              {latest.map((e) => (
                <DepartureRowCompact
                  key={e.id}
                  event={e}
                  events={data?.events ?? []}
                  profiles={data?.profiles}
                  baselineAt={account.baselineAt}
                  now={now}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {account && (
        <div className="xg-popup__stats">
          <div>
            <span>Départs, 7 j</span>
            <strong className="is-danger">{formatSigned(-stats.departures)}</strong>
          </div>
          <div>
            <span>Arrivées, 7 j</span>
            <strong className="is-primary">{formatSigned(stats.arrivals)}</strong>
          </div>
          <div>
            <span>Solde</span>
            <strong>{formatSigned(stats.net)}</strong>
          </div>
        </div>
      )}

      {!account && app.status?.session !== 'disconnected' && (
        <p className="xg-popup__empty">Ouvre x.com et connecte-toi : xGhost détectera ton compte.</p>
      )}

      <UpdateBanner compact />

      <footer className="xg-popup__foot">
        <button
          type="button"
          className="xg-btn xg-btn--ghost"
          disabled={checking || !account}
          title="Relancer une vérification"
          onClick={async () => {
            setChecking(true);
            try {
              await send('scan:start', {});
            } finally {
              setChecking(false);
            }
          }}
        >
          <IconRefresh size={20} />
          {data?.progress?.status === 'running'
            ? 'Vérification en cours…'
            : account?.lastScanAt
              ? `Vérifié ${formatAgo(account.lastScanAt, now)}`
              : 'Vérifier maintenant'}
        </button>
        <button type="button" className="xg-btn xg-btn--ink xg-btn--lg" onClick={openOptions}>
          Tout voir
        </button>
      </footer>
    </div>
  );
}
