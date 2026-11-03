import { isOnboarded } from '@/features/accounts/repository';
import { useEffect, useMemo, useRef, useState } from 'react';
import { UnseenCount } from '@/features/accounts/ui/UnseenCount';
import { useUnseenByAccount } from '@/features/accounts/ui/useUnseenByAccount';
import { useAccountData, useVisibilityContext } from '@/features/app-state/useAccountData';
import { useAppState } from '@/features/app-state/useAppState';
import { DisplayedContext, useMarkDisplayed } from '@/features/app-state/useSeenOnView';
import { currentDepartures, stats7d } from '@/features/events/selectors';
import { joinParts } from '@/features/events/ui/display';
import { departureMeta } from '@/features/events/ui/DeparturesPanel';
import { EventRow } from '@/features/events/ui/EventRow';
import { scanCoverage } from '@/features/scan-status/progress';
import { ScanStatusBanner } from '@/features/scan-status/ui/ScanStatusBanner';
import { useStartScan } from '@/features/scan-status/ui/useStartScan';
import { UpdateBanner } from '@/features/updates/ui/UpdateBanner';
import { focusOrOpenExtensionPage } from '@/shared/browser/tabs';
import { useNow } from '@/shared/hooks/useNow';
import { t } from '@/shared/i18n';
import { localKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import type { FollowEvent } from '@/shared/types';
import { ActionMenu } from '@/shared/ui/ActionMenu';
import { IconChevronDown, IconRefresh, IconSettings } from '@/shared/ui/icons';
import { Logo, StatTile } from '@/shared/ui/primitives';
import { formatAgo, formatNumber, formatPercent, formatSigned } from '@/shared/utils/format';
import './popup.css';

/** Ouvre une section des options (onglet réutilisé s'il existe), puis ferme la popup. */
async function openOptions(section: 'dashboard' | 'settings'): Promise<void> {
  await focusOrOpenExtensionPage('/options.html', section);
  window.close();
}

/** Ouvre l'onboarding (ou ramène l'onglet existant au premier plan), puis ferme la popup. */
async function openOnboarding(): Promise<void> {
  await focusOrOpenExtensionPage('/onboarding.html');
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
      setPrevious(typeof v === 'number' ? v : null);
      await localKv.set({ [keys.lastVisit(accountId)]: Date.now() });
    });
  }, [accountId]);
  return previous;
}

/** Derniers départs de la popup (lignes compactes), signalés comme affichés. */
function LatestDepartures({
  events,
  latest,
  profiles,
  baselineAt,
  now,
}: {
  events: FollowEvent[];
  latest: FollowEvent[];
  profiles: Parameters<typeof EventRow>[0]['profiles'];
  baselineAt?: number;
  now: number;
}) {
  useMarkDisplayed(latest);
  if (latest.length === 0) return <p className="xg-popup__empty">{t('dashboard.departures.empty')}</p>;
  return (
    <ul className="xg-dep-list">
      {latest.map((e) => (
        <EventRow
          key={e.id}
          event={e}
          profiles={profiles}
          now={now}
          variant="compact"
          meta={departureMeta(e, events, baselineAt, now, true)}
        />
      ))}
    </ul>
  );
}

export function PopupApp() {
  const app = useAppState();
  const now = useNow();
  const account = app.selected;
  const { data, markDisplayed } = useAccountData(account?.id, { seenOnView: true });
  const ctx = useVisibilityContext(data, account);
  const previousVisit = usePreviousVisit(account?.id);
  const unseenByAccount = useUnseenByAccount(app.accounts);
  const { start, busy } = useStartScan();

  const list = useMemo(() => (data ? currentDepartures(data.events, ctx) : []), [data, ctx]);
  const latest = useMemo(() => list.slice(0, 5), [list]);
  const stats = useMemo(() => stats7d(data?.events ?? [], ctx, now), [data?.events, ctx, now]);
  // `list` ne contient déjà que les comptes toujours absents.
  const fresh = useMemo(
    () => list.filter((e) => !e.seen && (previousVisit == null || e.at > previousVisit)).length,
    [list, previousVisit],
  );

  // Tant que la première synchronisation n'est pas terminée, un clic sur l'icône
  // ouvre l'écran de synchronisation plutôt que la popup.
  const onboarded = isOnboarded(app.accounts);
  useEffect(() => {
    if (!app.loading && !onboarded) void openOnboarding();
  }, [app.loading, onboarded]);

  if (app.loading || !onboarded) return <div className="xg-popup" />;

  const handle = account ? (
    <>
      <span className="xg-popup__handle">@{account.handle}</span>
      {app.accounts.length > 1 && <IconChevronDown size={18} />}
    </>
  ) : null;

  return (
    <DisplayedContext.Provider value={markDisplayed}>
      <div className="xg-popup">
        <header className="xg-popup__head">
          <Logo size={40} />
          <div className="xg-popup__account">
            {!account ? (
              <span className="xg-popup__handle">{t('common.appName')}</span>
            ) : app.accounts.length > 1 ? (
              <ActionMenu
                label={t('popup.switchAccount')}
                trigger={handle}
                triggerClassName="xg-popup__switch"
                align="start"
                actions={app.accounts.map((a) => {
                  const count = unseenByAccount[a.id] ?? 0;
                  return {
                    key: a.id,
                    label: `@${a.handle}`,
                    checked: a.id === account.id,
                    trailing: count > 0 ? <UnseenCount count={count} /> : undefined,
                    onSelect: () => void app.select(a.id),
                  };
                })}
              />
            ) : (
              <span className="xg-popup__switch">{handle}</span>
            )}
            {account && (
              <span className="xg-popup__sub">
                {joinParts([
                  account.followersCount !== undefined
                    ? t('popup.followers', { count: account.followersCount, n: formatNumber(account.followersCount) })
                    : undefined,
                  t('popup.accounts', { count: app.accounts.length, n: formatNumber(app.accounts.length) }),
                ])}
              </span>
            )}
          </div>
          <button
            type="button"
            className="xg-icon-btn"
            aria-label={t('popup.settings')}
            onClick={() => void openOptions('settings')}
          >
            <IconSettings size={24} />
          </button>
        </header>

        <ScanStatusBanner account={account} progress={data?.progress} status={app.status} now={now} compact />

        {fresh > 0 && (
          <div className="xg-popup__alert" role="status">
            <strong>{formatNumber(fresh)}</strong>
            <span>
              <b>{t('popup.fresh', { count: fresh })}</b>
              <br />
              {t('popup.sinceLastVisit')}
            </span>
          </div>
        )}

        {account?.lastScan && !account.lastScan.complete && !data?.progress && (
          <button
            type="button"
            className="xg-popup__alert xg-popup__alert--link"
            onClick={() => void openOptions('dashboard')}
          >
            <span>
              <b>{t('popup.incomplete', { pct: formatPercent(scanCoverage(account.lastScan)) })}</b>
              <br />
              {t('popup.incompleteHint')}
            </span>
          </button>
        )}

        <UpdateBanner />

        {account && data && (
          <section>
            <h2 className="xg-eyebrow xg-popup__section">{t('popup.latest')}</h2>
            <LatestDepartures
              events={data.events}
              latest={latest}
              profiles={data.profiles}
              baselineAt={account.baselineAt}
              now={now}
            />
          </section>
        )}

        {account && (
          <div className="xg-popup__stats">
            <StatTile size="sm" label={t('popup.departures7d')} value={formatSigned(-stats.departures)} tone="danger" />
            <StatTile size="sm" label={t('popup.arrivals7d')} value={formatSigned(stats.arrivals)} tone="primary" />
            <StatTile size="sm" label={t('popup.net')} value={formatSigned(stats.net)} />
          </div>
        )}

        {!account && app.status?.session !== 'disconnected' && <p className="xg-popup__empty">{t('popup.noAccount')}</p>}

        <footer className="xg-popup__foot">
          <button
            type="button"
            className="xg-btn xg-btn--ghost"
            disabled={busy || !account}
            title={t('popup.recheckTitle')}
            onClick={() => void start()}
          >
            <IconRefresh size={20} />
            {data?.progress?.status === 'running'
              ? t('popup.checking')
              : account?.lastScanAt
                ? t('common.checkedAgo', { ago: formatAgo(account.lastScanAt, now) })
                : t('dashboard.check.checkNow')}
          </button>
          <button type="button" className="xg-btn xg-btn--ink xg-btn--lg" onClick={() => void openOptions('dashboard')}>
            {t('popup.openDashboard')}
          </button>
        </footer>
      </div>
    </DisplayedContext.Provider>
  );
}
