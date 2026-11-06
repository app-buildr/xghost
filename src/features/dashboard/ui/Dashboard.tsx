import { useMemo } from 'react';
import { FollowerLimitAlert } from '@/features/accounts/ui/FollowerLimitAlert';
import type { AccountData } from '@/features/app-state/useAccountData';
import { statsSince, type VisibilityContext } from '@/features/events/selectors';
import { DASHBOARD_PERIODS, periodStart, type DashboardPeriod } from '@/features/stats/period';
import { oldestEventAt } from '@/features/stats/selectors';
import { useChartCards } from '@/features/stats/ui/useChartCards';
import { useStoredChoice } from '@/shared/hooks/useStoredChoice';
import { ArrivalsPanel } from '@/features/events/ui/ArrivalsPanel';
import { DeparturesPanel } from '@/features/events/ui/DeparturesPanel';
import { ScanStatusBanner } from '@/features/scan-status/ui/ScanStatusBanner';
import { t } from '@/shared/i18n';
import { DEFAULT_SETTINGS, type DashboardChart, type GlobalStatus, type TrackedAccount } from '@/shared/types';
import { StatTile } from '@/shared/ui/primitives';
import { formatNumber, formatSigned } from '@/shared/utils/format';
import { DashboardHeader } from './DashboardHeader';
import { ScanCoverageCard } from './ScanCoverageCard';
import './dashboard.css';

interface Props {
  account: TrackedAccount;
  data: AccountData;
  ctx: VisibilityContext;
  status?: GlobalStatus;
  now: number;
  /** Graphiques masqués dans les réglages. */
  hiddenCharts?: readonly DashboardChart[];
  onShowAllDepartures: () => void;
  onShowAllArrivals: () => void;
}

/**
 * Tableau de bord (§ 3.4), sur la période choisie (24 h / 7 j / 30 j / 90 j / Tout, mémorisée) :
 * - en haut, dernier scan et chiffres de la période ;
 * - les derniers départs, en grand à gauche ; à droite, arrivées et départs, départs par durée
 *   de suivi et rétention, empilés ;
 * - dessous, la courbe des abonnés et le solde net côte à côte ;
 * - enfin, les nouveaux abonnés.
 * Un graphique masqué dans les réglages libère sa place.
 */
export function Dashboard({ account, data, ctx, status, now, hiddenCharts = DEFAULT_SETTINGS.hiddenCharts, onShowAllDepartures, onShowAllArrivals }: Props) {
  const [period, setPeriod] = useStoredChoice<DashboardPeriod>('xg.dashboardPeriod', DASHBOARD_PERIODS, '30d');
  // Sans date de référence (cas rare), « Tout » part du plus ancien mouvement connu.
  const floor = account.baselineAt ?? oldestEventAt(data.events);
  const from = periodStart(period, now, floor);
  const stats = useMemo(() => statsSince(data.events, ctx, from), [data.events, ctx, from]);

  const cards = useChartCards({ account, data, ctx, period, from, floor, now, hidden: hiddenCharts });
  const side = [cards.activity, cards.duration, cards.retention].filter(Boolean);
  const bottom = [cards.followers, cards.net].filter(Boolean);

  return (
    <>
      <DashboardHeader
        account={account}
        progress={data.progress}
        now={now}
        period={{ value: period, onChange: setPeriod }}
      />
      <FollowerLimitAlert account={account} now={now} />
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

      {/* Avec la colonne de droite, les derniers départs en prennent la hauteur et défilent. */}
      <div className={`xg-dash__main${side.length ? '' : ' xg-dash__main--full'}`}>
        <div className="xg-dash__departures">
          <DeparturesPanel
            title={t('dashboard.latestDepartures')}
            account={account}
            data={data}
            ctx={ctx}
            now={now}
            limit={side.length ? 20 : 8}
            fill={side.length > 0}
            onShowAll={onShowAllDepartures}
          />
        </div>
        {side.length > 0 && <div className="xg-dash__side">{side}</div>}
      </div>

      {bottom.length > 0 && <div className={`xg-stats__row xg-stats__row--${bottom.length}`}>{bottom}</div>}

      <ArrivalsPanel data={data} ctx={ctx} now={now} limit={6} onShowAll={onShowAllArrivals} />
    </>
  );
}
