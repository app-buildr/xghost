import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { IgnoredAccounts, RemoveAccount } from '@/features/settings/ui/AccountSettings';
import { SettingsPanel } from '@/features/settings/ui/SettingsPanel';
import { useNow } from '@/shared/hooks/useNow';
import { t } from '@/shared/i18n';
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary';
import { ExternalLink } from '@/shared/ui/ExternalLink';
import { Logo, useSlidingIndicator } from '@/shared/ui/primitives';
import { X_LOGIN_URL } from '@/shared/x-urls';
import { OptionsFooter } from './OptionsFooter';
import './options.css';
import { OPTION_SECTIONS, type OptionSection } from '../sections';


function useSection(): [OptionSection, (s: OptionSection) => void] {
  const read = () => {
    const h = location.hash.slice(1) as OptionSection;
    return OPTION_SECTIONS.includes(h) ? h : 'dashboard';
  };
  const [section, setSection] = useState<OptionSection>(read);
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
 * OptionSection protégée : une erreur de rendu n'emporte pas le reste de la page. Elle est retentée
 * quand les données affichées changent (autre compte, sauvegarde importée).
 */
const Guard = ({ children, resetKey }: { children: ReactNode; resetKey?: unknown }) => (
  <ErrorBoundary resetKey={resetKey}>{children}</ErrorBoundary>
);

export function OptionsApp() {
  const app = useAppState();
  const now = useNow();
  const [section, go] = useSection();
  const navItems = useRef<(HTMLAnchorElement | null)[]>([]);
  const navThumb = useSlidingIndicator(navItems, Math.max(0, OPTION_SECTIONS.indexOf(section)), 'y');
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
            {/* Pastille de la section courante : elle glisse d'une section à l'autre. */}
            <span className="xg-nav__thumb" style={navThumb} aria-hidden="true" />
            {OPTION_SECTIONS.map((id, i) => (
              <a
                key={id}
                ref={(el) => {
                  navItems.current[i] = el;
                }}
                href={`#${id}`}
                className={`xg-nav__item${section === id ? ' is-current' : ''}`}
                aria-current={section === id ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  go(id);
                }}
              >
                {t(`options.nav.${id}`)}
                {id === 'departures' && <UnseenCount count={unseenSelected} />}
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
                  hiddenCharts={app.settings.hiddenCharts}
                  onShowAllDepartures={() => go('departures')}
                  onShowAllArrivals={() => go('arrivals')}
                />
              </Guard>
            </div>
          ) : section === 'departures' ? (
            <div className="xg-options__content xg-options__content--list">
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
            <div className="xg-options__content xg-options__content--list">
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
                    <IgnoredAccounts account={account} data={data} />
                  </Guard>
                  {/* Hors de toute zone dépendant des données : la restauration reste toujours possible. */}
                  <DataPanel />
                  <RemoveAccount account={account} />
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
