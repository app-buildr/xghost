import { UpdateBanner } from '@/features/updates/UpdateBanner';
import { installedVersion } from '@/features/updates/version';
import { formatBadgeCount } from '@/shared/utils/format';
import { useEffect, useMemo, useState } from 'react';
import { send } from '@/shared/messaging/client';
import { AccountsList, useUnseenByAccount } from '@/features/accounts/ui/AccountsList';
import { useAccountData, useAppState, visibilityContext } from '@/features/app-state/hooks';
import { Dashboard, DashboardHeader } from '@/features/dashboard/ui/Dashboard';
import { ArrivalsPanel } from '@/features/departures/ui/ArrivalsPanel';
import { DeparturesPanel } from '@/features/departures/ui/DeparturesPanel';
import { ScanStatusBanner } from '@/features/scan-status/ui/ScanStatusBanner';
import { AccountSettings } from '@/features/settings/ui/AccountSettings';
import { SettingsPanel } from '@/features/settings/ui/SettingsPanel';
import { useNow } from '@/shared/hooks/useNow';
import { Logo } from '@/shared/ui/primitives';
import './options.css';

type Section = 'dashboard' | 'departures' | 'arrivals' | 'settings';
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'dashboard', label: 'Tableau de bord' },
  { id: 'departures', label: 'Départs' },
  { id: 'arrivals', label: 'Nouveaux abonnés' },
  { id: 'settings', label: 'Réglages' },
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

export function OptionsApp() {
  // Ouverture des options : on relève tout de suite la dernière version publiée.
  useEffect(() => void send('update:check', undefined).catch(() => undefined), []);
  const app = useAppState();
  const now = useNow();
  const [section, go] = useSection();
  const account = app.selected;
  const { data, markSeenLocally } = useAccountData(account?.id, { seenOnView: true });
  const ctx = useMemo(() => visibilityContext(data, app.settings, account), [data, app.settings, account]);
  const unseen = useUnseenByAccount(app.accounts, app.settings);
  const unseenSelected = account ? (unseen[account.id] ?? 0) : 0;

  return (
    <div className="xg-options">
      <aside className="xg-options__side">
        <div className="xg-brand">
          <Logo size={44} />
          <span>xGhost</span>
        </div>
        <nav aria-label="Navigation" className="xg-nav">
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
              {s.label}
              {s.id === 'departures' && unseenSelected > 0 && (
                <span className="xg-count">{formatBadgeCount(unseenSelected)}</span>
              )}
            </a>
          ))}
        </nav>
        <AccountsList
          accounts={app.accounts}
          selectedId={account?.id}
          status={app.status}
          unseen={unseen}
          now={now}
          onSelect={(id) => void app.select(id)}
        />
        <p className="xg-options__version">xGhost {installedVersion()}</p>
      </aside>

      <main className="xg-options__main">
        <UpdateBanner />
        {app.loading ? null : !account ? (
          <EmptyState statusBanner={<ScanStatusBanner status={app.status} now={now} />} />
        ) : !data ? null : section === 'dashboard' ? (
          <div className="xg-options__content">
            <Dashboard
              key={account.id}
              account={account}
              data={data}
              ctx={ctx}
              status={app.status}
              now={now}
              markSeenLocally={markSeenLocally}
              onShowAllDepartures={() => go('departures')}
              aside={
                <SettingsPanel settings={app.settings} account={account} onUpdate={(p) => void app.updateSettings(p)} />
              }
            />
          </div>
        ) : section === 'departures' ? (
          <div className="xg-options__content">
            <DashboardHeader account={account} progress={data.progress} now={now} />
            <ScanStatusBanner account={account} progress={data.progress} status={app.status} now={now} />
            <DeparturesPanel
              key={account.id}
              title="Tous les départs"
              account={account}
              data={data}
              ctx={ctx}
              now={now}
              markSeenLocally={markSeenLocally}
            />
          </div>
        ) : section === 'arrivals' ? (
          <div className="xg-options__content">
            <DashboardHeader account={account} progress={data.progress} now={now} />
            <ArrivalsPanel account={account} data={data} ctx={ctx} now={now} />
          </div>
        ) : (
          <div className="xg-options__content">
            <h1 className="xg-options__title">Réglages</h1>
            <div className="xg-options__settings">
              <SettingsPanel settings={app.settings} account={account} onUpdate={(p) => void app.updateSettings(p)} />
              <AccountSettings account={account} data={data} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function EmptyState({ statusBanner }: { statusBanner: React.ReactNode }) {
  return (
    <div className="xg-options__content">
      <h1 className="xg-options__title">Aucun compte suivi</h1>
      <p className="xg-options__lead">
        Connecte-toi à X dans ce navigateur : xGhost détecte ton compte et prend une photo de tes abonnés.
      </p>
      {statusBanner}
      <div>
        <a className="xg-btn xg-btn--ink xg-btn--lg" href="https://x.com/login" target="_blank" rel="noreferrer">
          Ouvrir x.com
        </a>
      </div>
    </div>
  );
}
