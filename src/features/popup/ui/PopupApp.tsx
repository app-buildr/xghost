import { ChevronDown, RefreshCw, Settings, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isOnboarded } from '@/domain/accounts/model';
import { FollowerLimitAlert } from '@/features/accounts/ui/FollowerLimitAlert';
import { UnseenCount } from '@/features/accounts/ui/UnseenCount';
import { useUnseenByAccount } from '@/features/accounts/ui/useUnseenByAccount';
import { useAccountData, useVisibilityContext } from '@/features/app-state/useAccountData';
import { useAppState } from '@/features/app-state/useAppState';
import { DisplayedContext, useMarkVisible } from '@/features/app-state/useSeenOnView';
import { currentDepartures, statsSince } from '@/domain/events/selectors';
import { departureMeta } from '@/features/events/labels';
import { EventRow } from '@/features/events/ui/EventRow';
import { scanCoverage } from '@/features/scan-status/progress';
import { ScanStatusBanner } from '@/features/scan-status/ui/ScanStatusBanner';
import { useStartScan } from '@/features/scan-status/ui/useStartScan';
import { periodStart, POPUP_PERIODS, type PopupPeriod } from '@/features/stats/period';
import type { OptionSection } from '@/features/options/sections';
import { trackingFloor } from '@/features/stats/selectors';
import { PeriodPicker } from '@/features/stats/ui/PeriodPicker';
import { focusOrOpenExtensionPage } from '@/shared/browser/tabs';
import { useNow } from '@/shared/hooks/useNow';
import { useScrollFade } from '@/shared/hooks/useScrollFade';
import { useStoredChoice } from '@/shared/hooks/useStoredChoice';
import { t } from '@/shared/i18n';
import type { FollowEvent, ProfileCache } from '@/shared/types';
import { ActionMenu } from '@/shared/ui/ActionMenu';
import { Logo, StatTile } from '@/shared/ui/primitives';
import { Tooltip } from '@/shared/ui/Tooltip';
import { formatAgo, formatNumber, formatPercent, formatSigned, joinParts } from '@/shared/utils/format';
import './popup.css';

/** Ouvre une section des options (onglet réutilisé s'il existe), puis ferme la popup. */
async function openOptions(section: OptionSection): Promise<void> {
  await focusOrOpenExtensionPage('/options.html', section);
  window.close();
}

/** Ouvre l'onboarding (ou ramène l'onglet existant au premier plan), puis ferme la popup. */
async function openOnboarding(): Promise<void> {
  await focusOrOpenExtensionPage('/onboarding.html');
  window.close();
}

/** Lignes visibles sans défiler ; les suivantes (jusqu'à `POPUP_LATEST`) s'atteignent en défilant. */
const VISIBLE_ROWS = 3;
const POPUP_LATEST = 10;

/**
 * Derniers départs de la popup (lignes compactes) : trois visibles, la suite en défilant dans la
 * liste. Seules les lignes réellement passées à l'écran sont signalées comme affichées (vues).
 */
function LatestDepartures({
  events,
  latest,
  profiles,
  baselineAt,
  now,
}: {
  events: FollowEvent[];
  latest: FollowEvent[];
  profiles: ProfileCache;
  baselineAt?: number;
  now: number;
}) {
  const list = useRef<HTMLUListElement>(null);
  const [height, setHeight] = useState<number>();
  useMarkVisible(list, latest, { scrolls: true });
  const fade = useScrollFade(list, height);

  // Hauteur de la liste : jusqu'au bas de la troisième ligne (les lignes n'ont pas toutes la même hauteur).
  // Mesure refaite une fois les polices chargées (elles changent la hauteur des lignes).
  useLayoutEffect(() => {
    let live = true;
    const measure = () => {
      const row = list.current?.children[VISIBLE_ROWS - 1] as HTMLElement | undefined;
      if (live) setHeight(latest.length > VISIBLE_ROWS && row ? row.offsetTop + row.offsetHeight : undefined);
    };
    measure();
    void document.fonts.ready.then(measure);
    return () => {
      live = false;
    };
  }, [latest]);

  if (latest.length === 0) return <p className="xg-empty">{t('common.departuresEmpty')}</p>;
  return (
    <ul
      ref={list}
      className={`xg-dep-list xg-scroll xg-popup__latest${fade.more ? ' xg-scroll-fade' : ''}`}
      style={{ maxHeight: height }}
      onScroll={fade.onScroll}
    >
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
  const unseenByAccount = useUnseenByAccount(app.accounts);
  const { start, busy } = useStartScan(account?.id);

  const events = data?.events;
  const list = useMemo(() => (events ? currentDepartures(events, ctx) : []), [events, ctx]);
  const latest = useMemo(() => list.slice(0, POPUP_LATEST), [list]);
  // Bilan sur la période choisie (24 h / 7 j / 30 j / Tout), mémorisée d'une ouverture à l'autre.
  const [period, setPeriod] = useStoredChoice<PopupPeriod>('xg.popupPeriod', POPUP_PERIODS, '7d');
  const since = periodStart(period, now, trackingFloor(account?.baselineAt, events ?? []));
  const stats = useMemo(() => statsSince(data?.events ?? [], ctx, since), [data?.events, ctx, since]);
  // Départs pas encore vus (comme le badge de l'icône). `list` ne contient que les comptes
  // toujours absents ; un départ affiché pendant cette visite reste compté jusqu'à la fermeture.
  const fresh = useMemo(() => list.filter((e) => !e.seen).length, [list]);
  const limited = !!account?.limit;

  // Alerte « nouveaux départs » fermée par l'utilisateur : se replie en douceur, puis disparaît.
  // Inutile de s'en souvenir : à la prochaine ouverture, ces départs ne sont plus nouveaux.
  const [alert, setAlert] = useState<'open' | 'closing' | 'closed'>('open');

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
      {app.accounts.length > 1 && <ChevronDown size={18} />}
    </>
  ) : null;

  return (
    <DisplayedContext.Provider value={markDisplayed}>
      <div className="xg-popup">
        <h1 className="xg-sr-only">{t('common.appName')}</h1>
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
            <Settings size={24} />
          </button>
        </header>

        <ScanStatusBanner account={account} progress={data?.progress} status={app.status} now={now} compact />

        {/* Limite d'abonnés dépassée (§ 4.9) : remplace l'alerte des nouveaux départs. */}
        {limited && account && <FollowerLimitAlert account={account} now={now} compact />}

        {!limited && fresh > 0 && alert !== 'closed' && (
          <div
            className={`xg-collapse${alert === 'closing' ? ' is-closing' : ''}`}
            onTransitionEnd={(e) => {
              if (e.target === e.currentTarget && e.propertyName === 'grid-template-rows') setAlert('closed');
            }}
          >
            <div className="xg-collapse__inner">
              <div className="xg-popup__alert" role="status">
                <strong>{formatNumber(fresh)}</strong>
                <span>
                  <b>{t('popup.fresh', { count: fresh })}</b>
                  <br />
                  {t('popup.notSeenYet', { count: fresh })}
                </span>
                <button
                  type="button"
                  className="xg-popup__alert-close"
                  aria-label={t('common.actions.close')}
                  onClick={() => setAlert(matchMedia('(prefers-reduced-motion: reduce)').matches ? 'closed' : 'closing')}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        )}

        {!limited && account?.lastScan && !account.lastScan.complete && !data?.progress && (
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
          <section className="xg-popup__summary" aria-label={t('popup.summary')}>
            <PeriodPicker periods={POPUP_PERIODS} value={period} onChange={setPeriod} />
            <div className="xg-popup__stats">
              <StatTile size="sm" label={t('popup.departures')} value={formatSigned(-stats.departures)} tone="danger" />
              <StatTile size="sm" label={t('popup.arrivals')} value={formatSigned(stats.arrivals)} tone="primary" />
              <StatTile size="sm" label={t('popup.net')} value={formatSigned(stats.net)} />
            </div>
          </section>
        )}

        {!account && app.status?.session !== 'disconnected' && <p className="xg-empty">{t('popup.noAccount')}</p>}

        <footer className="xg-popup__foot">
          <Tooltip label={t('popup.recheckTitle')}>
            <button
              type="button"
              className="xg-btn xg-btn--ghost"
              disabled={busy || !account || limited}
              onClick={() => void start()}
            >
              {/* Limite d'abonnés : pas d'icône, pour que « Vérifications arrêtées » tienne en entier. */}
              {!limited && (
                <RefreshCw size={20} className={busy || data?.progress?.status === 'running' ? 'xg-spin' : undefined} />
              )}
              {/* Largeur du bouton fixée par le pied (voir popup.css) : le libellé peut changer
                  sans élargir la popup. */}
              <span className="xg-popup__check-label">
                {limited
                  ? t('popup.stopped')
                  : data?.progress?.status === 'running'
                  ? t('popup.checking')
                  : account?.lastScanAt
                    ? t('common.checkedAgo', { ago: formatAgo(account.lastScanAt, now) })
                    : t('common.checkNow')}
              </span>
            </button>
          </Tooltip>
          <button type="button" className="xg-btn xg-btn--ink xg-btn--lg" onClick={() => void openOptions('dashboard')}>
            {t('popup.openDashboard')}
          </button>
        </footer>
      </div>
    </DisplayedContext.Provider>
  );
}
