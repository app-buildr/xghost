import { useMemo } from 'react';
import type { AccountData } from '@/features/app-state/useAccountData';
import { statsSince, type VisibilityContext } from '@/features/events/selectors';
import { activityUnit, DASHBOARD_PERIODS, netUnit, periodStart, type DashboardPeriod } from '@/features/stats/period';
import { departuresByDuration, followerSeries, movementBuckets, retention } from '@/features/stats/selectors';
import { DurationChart } from '@/features/stats/ui/DurationChart';
import { FollowersChart } from '@/features/stats/ui/FollowersChart';
import { NetChart } from '@/features/stats/ui/NetChart';
import { RetentionCard } from '@/features/stats/ui/RetentionCard';
import { useStoredChoice } from '@/shared/hooks/useStoredChoice';
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

/**
 * Tableau de bord (§ 3.4) : état, dernier scan, chiffres et graphes sur la période choisie
 * (7 j / 30 j / 90 j / Tout, mémorisée), listes des derniers départs et nouveaux abonnés.
 */
export function Dashboard({ account, data, ctx, status, now, onShowAllDepartures, onShowAllArrivals }: Props) {
  const [period, setPeriod] = useStoredChoice<DashboardPeriod>('xg.dashboardPeriod', DASHBOARD_PERIODS, '30d');
  const baselineAt = account.baselineAt;
  const from = periodStart(period, now, baselineAt);
  const unit = activityUnit(period);
  const charts = useMemo(
    () => ({
      stats: statsSince(data.events, ctx, from),
      activity: movementBuckets(data.events, ctx, unit, from, now),
      net: movementBuckets(data.events, ctx, netUnit(period), from, now),
      followers: followerSeries(data.events, data.totals, account.followersCount, from, now),
      durations: departuresByDuration(data.events, ctx, from, now, baselineAt),
      retention: retention(data.events, ctx, from, now),
    }),
    [data.events, data.totals, ctx, from, unit, period, now, account.followersCount, baselineAt],
  );
  const stats = charts.stats;

  return (
    <>
      <DashboardHeader
        account={account}
        progress={data.progress}
        now={now}
        period={{ value: period, onChange: setPeriod }}
      />
      <ScanStatusBanner account={account} progress={data.progress} status={status} now={now} />

      <div className="xg-kpis xg-kpis--coverage">
        <ScanCoverageCard account={account} progress={data.progress} now={now} />
        <StatTile
          label={t(`stats.kpi.departures.${period}`)}
          value={formatSigned(-stats.departures)}
          tone="danger"
          hint={t('dashboard.kpi.new', { count: stats.unseen, n: formatNumber(stats.unseen) })}
        />
        <StatTile
          label={t(`stats.kpi.arrivals.${period}`)}
          value={formatSigned(stats.arrivals)}
          tone="primary"
          hint={t('dashboard.kpi.net', { net: formatSigned(stats.net) })}
        />
      </div>

      <div className="xg-stats__row xg-stats__row--wide">
        <section className="xg-card">
          <FollowersChart points={charts.followers} all={period === 'all'} />
        </section>
        <section className="xg-card">
          <ActivityChart
            buckets={charts.activity}
            since={baselineAt}
            unit={unit}
            title={t('stats.activity.title')}
            footnote={t(unit === 'day' ? 'stats.activity.byDay' : 'stats.activity.byWeek')}
          />
        </section>
      </div>
      <div className="xg-stats__row">
        <section className="xg-card">
          <NetChart buckets={charts.net} unit={netUnit(period)} />
        </section>
        <section className="xg-card">
          <DurationChart buckets={charts.durations} baselineAt={baselineAt} />
        </section>
        <section className="xg-card">
          <RetentionCard values={charts.retention} />
        </section>
      </div>

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
