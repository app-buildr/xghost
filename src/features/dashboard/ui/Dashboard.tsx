import { ALARM_CHECK } from '@/features/scheduler/alarms';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AccountData } from '@/features/app-state/hooks';
import type { ScanProgress } from '@/features/followers-sync/repository';
import { DeparturesPanel } from '@/features/departures/ui/DeparturesPanel';
import { dailyBuckets, stats7d, type VisibilityContext } from '@/features/events/selectors';
import { ScanStatusBanner } from '@/features/scan-status/ui/ScanStatusBanner';
import type { GlobalStatus, TrackedAccount } from '@/shared/types';
import { formatAgo, formatIn, formatNumber, formatSigned, plural, pluralS } from '@/shared/utils/format';
import { ActivityChart } from './ActivityChart';
import { CheckNowButton } from './CheckNowButton';
import { ScanCoverageCard } from './ScanCoverageCard';
import './dashboard.css';


function useNextCheck(): number | undefined {
  const [next, setNext] = useState<number>();
  useEffect(() => {
    const read = () => chrome.alarms.get(ALARM_CHECK).then((a) => setNext(a?.scheduledTime));
    void read();
    const t = setInterval(read, 60_000);
    return () => clearInterval(t);
  }, []);
  return next;
}

/** Résultat du dernier contrôle rapide, en une phrase claire (témoin de ce que xGhost a fait). */
function quickSummary(account: TrackedAccount): string | undefined {
  const q = account.lastQuick;
  if (!q || (account.lastScan && account.lastScan.at > q.at)) return undefined;
  const seen = [
    q.arrivals > 0 ? plural(q.arrivals, 'nouvel abonné', 'nouveaux abonnés') : undefined,
    q.departed ? plural(q.departed, 'départ récent', 'départs récents') : undefined,
  ]
    .filter(Boolean)
    .join(' et ');
  const missing = plural(q.missing, 'abonné', 'abonnés');
  if (q.overflow) return 'trop de nouveaux abonnés d’un coup, scan complet lancé.';
  if (q.staleRuns) return `${seen || 'rien de nouveau'}, mais le total affiché par X n’est pas encore à jour : nouvelle vérification dans 10 min.`;
  if (q.missing > 0) {
    return seen
      ? `${seen}, et il manque encore ${missing}, scan complet lancé pour savoir qui est parti.`
      : `il manque ${missing}, scan complet lancé pour savoir qui est parti.`;
  }
  return seen ? `${seen}.` : 'aucun changement.';
}

export function DashboardHeader({
  account,
  progress,
  now,
}: {
  account: TrackedAccount;
  progress?: ScanProgress;
  now: number;
}) {
  const next = useNextCheck();
  const parts = [
    account.lastScanAt ? `Dernière vérification ${formatAgo(account.lastScanAt, now)}` : 'Pas encore vérifié',
    next && next > now ? `prochaine ${formatIn(next, now)}` : undefined,
  ].filter(Boolean);
  const summary = quickSummary(account);
  return (
    <header className="xg-dash__header">
      <div className="xg-dash__heading">
        <h1>Tableau de bord</h1>
        <p className="xg-dash__sub">{parts.join(' · ')}</p>
        {summary && <p className="xg-dash__result">Dernier contrôle rapide : {summary}</p>}
      </div>
      <CheckNowButton progress={progress} />
    </header>
  );
}

interface Props {
  account: TrackedAccount;
  data: AccountData;
  ctx: VisibilityContext;
  status?: GlobalStatus;
  now: number;
  markSeenLocally: (ids: string[] | 'all') => void;
  onShowAllDepartures: () => void;
  /** Colonne affichée à droite de la liste des départs (réglages). */
  aside?: ReactNode;
}

export function Dashboard({ account, data, ctx, status, now, markSeenLocally, onShowAllDepartures, aside }: Props) {
  const stats = useMemo(() => stats7d(data.events, ctx, now), [data.events, ctx, now]);
  const buckets = useMemo(() => dailyBuckets(data.events, ctx, 30, now), [data.events, ctx, now]);

  return (
    <>
      <DashboardHeader account={account} progress={data.progress} now={now} />
      <ScanStatusBanner account={account} progress={data.progress} status={status} now={now} />

      <div className="xg-kpis xg-kpis--coverage">
        <ScanCoverageCard account={account} progress={data.progress} now={now} />
        <div className="xg-card xg-kpi">
          <span className="xg-kpi__label">Départs, 7 jours</span>
          <strong className="xg-kpi__value xg-kpi__value--danger">{formatSigned(-stats.departures)}</strong>
          <span className="xg-kpi__hint">
            dont {formatNumber(stats.unseen)} non vu{pluralS(stats.unseen)}
          </span>
        </div>
        <div className="xg-card xg-kpi">
          <span className="xg-kpi__label">Arrivées, 7 jours</span>
          <strong className="xg-kpi__value xg-kpi__value--primary">{formatSigned(stats.arrivals)}</strong>
          <span className="xg-kpi__hint">Solde net {formatSigned(stats.net)}</span>
        </div>
      </div>

      <section className="xg-card">
        <ActivityChart buckets={buckets} />
      </section>

      <div className="xg-dash__split">
        <DeparturesPanel
          title="Derniers départs"
          account={account}
          data={data}
          ctx={ctx}
          now={now}
          markSeenLocally={markSeenLocally}
          limit={6}
          onShowAll={onShowAllDepartures}
        />
        {aside}
      </div>
    </>
  );
}
