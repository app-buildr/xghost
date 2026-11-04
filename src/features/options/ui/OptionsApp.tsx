import { useEffect, useState, type ReactNode } from 'react';
import { AccountsList } from '@/features/accounts/ui/AccountsList';
import { UnseenCount } from '@/features/accounts/ui/UnseenCount';
import { useUnseenByAccount } from '@/features/accounts/ui/useUnseenByAccount';
import { useAccountData, useVisibilityContext } from '@/features/app-state/useAccountData';
import { useAppState } from '@/features/app-state/useAppState';
import { DisplayedContext } from '@/features/app-state/useSeenOnView';
import { DataPanel } from '@/features/backup/ui/DataPanel';
import { Dashboard } from '@/features/dashboard/ui/Dashboard';
import { DashboardHeader } from '@/features/dashboard/ui/DashboardHeader';
import { ArrivalsPanel } from '@/features/events/ui/ArrivalsPanel';
import { DeparturesPanel } from '@/features/events/ui/DeparturesPanel';
import { ScanStatusBanner } from '@/features/scan-status/ui/ScanStatusBanner';
import { AccountSettings } from '@/features/settings/ui/AccountSettings';
import { SettingsPanel } from '@/features/settings/ui/SettingsPanel';
import { useNow } from '@/shared/hooks/useNow';
import { t } from '@/shared/i18n';
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary';
import { ExternalLink } from '@/shared/ui/ExternalLink';
import { Logo } from '@/shared/ui/primitives';
import { X_LOGIN_URL } from '@/shared/x-urls';
import { OptionsFooter } from './OptionsFooter';
import './options.css';

type Section = 'dashboard' | 'departures' | 'arrivals' | 'settings';
const SECTIONS: { id: Section; label: `options.nav.${Section}` }[] = [
  { id: 'dashboard', label: 'options.nav.dashboard' },
  { id: 'departures', label: 'options.nav.departures' },
  { id: 'arrivals', label: 'options.nav.arrivals' },
  { id: 'settings', label: 'options.nav.settings' },
];

function useSection(): [Section, (s: Section) => void] {
  const read = () => {
    const h = location.hash.slice(1) as Section;
    return SECTIONS.some((s) => s.id === h) ? h : 'dashboard';
  };
  const [section, setSection] = useState<Section>(read);
  useEffect(() => {
    const onHash = () => setSection(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return [
    section,
    (s) => {
      location.hash = s;
      window.scrollTo({ top: 0 });
    },
  ];
}

/**
 * Page affichée quand les données ne peuvent pas être lues (sauvegarde ou stockage corrompu) :
 * la restauration d'une sauvegarde reste accessible.
 */
export function OptionsRecovery() {
  return (
    <main className="xg-options__content xg-options__recovery">
      <h1 className="xg-options__title">{t('options.recovery.title')}</h1>
      <p className="xg-options__lead">{t('options.recovery.lead')}</p>
      <DataPanel />
    </main>
  );
}

/**
 * Section protégée : une erreur de rendu n'emporte pas le reste de la page. Elle est retentée
 * quand les données affichées changent (autre compte, sauvegarde importée).
 */
const Guard = ({ children, resetKey }: { children: ReactNode; resetKey?: unknown }) => (
  <ErrorBoundary resetKey={resetKey}>{children}</ErrorBoundary>
);

export function OptionsApp() {
  const app = useAppState();
  const now = useNow();
  const [section, go] = useSection();
  const account = app.selected;
  // Les listes signalent leurs lignes affichées ; seules celles-ci sont marquées vues.
  const { data, markDisplayed } = useAccountData(account?.id, { seenOnView: true });
  const ctx = useVisibilityContext(data, account);
  const unseen = useUnseenByAccount(app.accounts);
  const unseenSelected = account ? (unseen[account.id] ?? 0) : 0;

  return (
    <DisplayedContext.Provider value={markDisplayed}>
      <div className="xg-options">
        <aside className="xg-options__side">
          <div className="xg-brand">
            <Logo size={44} />
            <span>{t('common.appName')}</span>
          </div>
          <nav aria-label={t('options.nav.label')} className="xg-nav">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={`xg-nav__item${section === s.id ? ' is-current' : ''}`}
                aria-current={section === s.id ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  go(s.id);
                }}
              >
                {t(s.label)}
                {s.id === 'departures' && <UnseenCount count={unseenSelected} />}
              </a>
            ))}
          </nav>
          <Guard resetKey={data}>
            <AccountsList
              accounts={app.accounts}
              selectedId={account?.id}
              status={app.status}
              unseen={unseen}
              now={now}
              onSelect={(id) => void app.select(id)}
            />
          </Guard>
        </aside>

        <main className="xg-options__main">
          {app.loading ? null : !account ? (
            <EmptyState statusBanner={<ScanStatusBanner status={app.status} now={now} />} />
          ) : !data ? null : section === 'dashboard' ? (
            <div className="xg-options__content">
              <Guard resetKey={data}>
                <Dashboard
                  key={account.id}
                  account={account}
                  data={data}
                  ctx={ctx}
                  status={app.status}
                  now={now}
                  onShowAllDepartures={() => go('departures')}
                  onShowAllArrivals={() => go('arrivals')}
                />
              </Guard>
            </div>
          ) : section === 'departures' ? (
            <div className="xg-options__content">
              <Guard resetKey={data}>
                <DashboardHeader account={account} progress={data.progress} now={now} />
                <ScanStatusBanner account={account} progress={data.progress} status={app.status} now={now} />
                <DeparturesPanel
                  key={account.id}
                  title={t('options.allDepartures')}
                  account={account}
                  data={data}
                  ctx={ctx}
                  now={now}
                />
              </Guard>
            </div>
          ) : section === 'arrivals' ? (
            <div className="xg-options__content">
              <Guard resetKey={data}>
                <DashboardHeader account={account} progress={data.progress} now={now} />
                <ScanStatusBanner account={account} progress={data.progress} status={app.status} now={now} />
                <ArrivalsPanel key={account.id} data={data} ctx={ctx} now={now} />
              </Guard>
            </div>
          ) : (
            <div className="xg-options__content">
              <h1 className="xg-options__title">{t('options.settingsTitle')}</h1>
              <div className="xg-options__settings">
                <Guard resetKey={data}>
                  <SettingsPanel settings={app.settings} account={account} onUpdate={(p) => void app.updateSettings(p)} />
                </Guard>
                <div className="xg-settings">
                  <Guard resetKey={data}>
                    <AccountSettings account={account} data={data} />
                  </Guard>
                  {/* Hors de toute zone dépendant des données : la restauration reste toujours possible. */}
                  <DataPanel />
                </div>
              </div>
            </div>
          )}
          <OptionsFooter />
        </main>
      </div>
    </DisplayedContext.Provider>
  );
}

function EmptyState({ statusBanner }: { statusBanner: ReactNode }) {
  return (
    <div className="xg-options__content">
      <h1 className="xg-options__title">{t('options.empty.title')}</h1>
      <p className="xg-options__lead">{t('options.empty.lead')}</p>
      {statusBanner}
      <div>
        <ExternalLink className="xg-btn xg-btn--ink xg-btn--lg" href={X_LOGIN_URL}>
          {t('common.openX')}
        </ExternalLink>
      </div>
    </div>
  );
}
