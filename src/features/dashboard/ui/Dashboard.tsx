import { useMemo } from 'react';
import type { AccountData } from '@/features/app-state/useAccountData';
import { dailyBuckets, stats7d, type VisibilityContext } from '@/features/events/selectors';
import { ArrivalsPanel } from '@/features/events/ui/ArrivalsPanel';
import { DeparturesPanel } from '@/features/events/ui/DeparturesPanel';
import { ScanStatusBanner } from '@/features/scan-status/ui/ScanStatusBanner';
import { t } from '@/shared/i18n';
import type { GlobalStatus, TrackedAccount } from '@/shared/types';
import { StatTile } from '@/shared/ui/primitives';
import { formatNumber, formatSigned } from '@/shared/utils/format';
import { ActivityChart } from './ActivityChart';
import { DashboardHeader } from './DashboardHeader';
import { ScanCoverageCard } from './ScanCoverageCard';
import './dashboard.css';

interface Props {
  account: TrackedAccount;
  data: AccountData;
  ctx: VisibilityContext;
  status?: GlobalStatus;
  now: number;
  onShowAllDepartures: () => void;
  onShowAllArrivals: () => void;
}

/** Tableau de bord (§ 3.4) : état, dernier scan, chiffres sur 7 jours, graphique, listes. */
export function Dashboard({ account, data, ctx, status, now, onShowAllDepartures, onShowAllArrivals }: Props) {
  const stats = useMemo(() => stats7d(data.events, ctx, now), [data.events, ctx, now]);
  const buckets = useMemo(() => dailyBuckets(data.events, ctx, 30, now), [data.events, ctx, now]);

  return (
    <>
      <DashboardHeader account={account} progress={data.progress} now={now} />
      <ScanStatusBanner account={account} progress={data.progress} status={status} now={now} />

      <div className="xg-kpis xg-kpis--coverage">
        <ScanCoverageCard account={account} progress={data.progress} now={now} />
        <StatTile
          label={t('dashboard.kpi.departures')}
          value={formatSigned(-stats.departures)}
          tone="danger"
          hint={t('dashboard.kpi.new', { count: stats.unseen, n: formatNumber(stats.unseen) })}
        />
        <StatTile
          label={t('dashboard.kpi.arrivals')}
          value={formatSigned(stats.arrivals)}
          tone="primary"
          hint={t('dashboard.kpi.net', { net: formatSigned(stats.net) })}
        />
      </div>

      <section className="xg-card">
        <ActivityChart buckets={buckets} since={account.baselineAt} />
      </section>

      <div className="xg-dash__split">
        <DeparturesPanel
          title={t('dashboard.latestDepartures')}
          account={account}
          data={data}
          ctx={ctx}
          now={now}
          limit={6}
          onShowAll={onShowAllDepartures}
        />
        <ArrivalsPanel data={data} ctx={ctx} now={now} limit={6} onShowAll={onShowAllArrivals} />
      </div>
    </>
  );
}
