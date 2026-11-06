import { useMemo, type ReactNode } from 'react';
import { EyeOff } from 'lucide-react';
import type { AccountData } from '@/features/app-state/useAccountData';
import type { VisibilityContext } from '@/domain/events/selectors';
import { useChartVisibility } from '@/features/settings/useChartVisibility';
import { activityUnit, netUnit, periodStart, type DashboardPeriod } from '@/features/stats/period';
import { daysBefore, startOfDay } from '@/shared/utils/time';
import { departuresByDuration, followerSeries, movementBuckets, retention } from '@/features/stats/selectors';
import { t } from '@/shared/i18n';
import type { DashboardChart, TrackedAccount } from '@/shared/types';
import { useToast } from '@/shared/ui/toast';
import { Tooltip } from '@/shared/ui/Tooltip';
import { ActivityChart } from './ActivityChart';
import { DurationChart } from './DurationChart';
import { FollowersChart } from './FollowersChart';
import { NetChart } from './NetChart';
import { RetentionCard } from './RetentionCard';

/**
 * Carte d'un graphique, avec un bouton « Cacher » (au survol de la carte) : le graphique est
 * masqué tout de suite, un toast propose d'annuler ; il se réaffiche dans les réglages.
 */
function ChartCard({ onHide, children }: { onHide: () => void; children: ReactNode }) {
  return (
    <section className="xg-card xg-stat-card">
      {children}
      <span className="xg-stat-card__hide">
        <Tooltip label={t('stats.hide')} align="end">
          <button type="button" className="xg-icon-btn" aria-label={t('stats.hide')} onClick={onHide}>
            <EyeOff size={16} aria-hidden="true" />
          </button>
        </Tooltip>
      </span>
    </section>
  );
}

/**
 * Cartes des graphiques du tableau de bord (§ 3.4) sur la période choisie, prêtes à placer :
 * `null` pour un graphique masqué dans les réglages. La disposition revient au tableau de bord.
 *
 * `from` : début des chiffres (jamais avant le début du suivi, `floor`). L'axe des graphes couvre
 * toute la période, même avant le suivi : ces tranches sont grisées. « Tout » sur un suivi récent
 * garde au moins 30 jours de repères.
 */
export function useChartCards({
  account,
  data,
  ctx,
  period,
  from,
  floor,
  now,
  hidden,
}: {
  account: TrackedAccount;
  data: AccountData;
  ctx: VisibilityContext;
  period: DashboardPeriod;
  from: number;
  floor?: number;
  now: number;
  hidden: readonly DashboardChart[];
}): Record<DashboardChart, ReactNode> {
  const baselineAt = account.baselineAt;
  const axisFrom = period === 'all' ? Math.min(from, daysBefore(now, 29)) : periodStart(period, now);
  const unit = activityUnit(axisFrom, now);
  const net = netUnit(axisFrom, now);
  // Recalcul quand les données, la période ou le jour changent (pas à chaque tic de l'horloge).
  const today = startOfDay(now);
  const charts = useMemo(
    () => ({
      activity: movementBuckets(data.events, ctx, unit, axisFrom, now),
      net: movementBuckets(data.events, ctx, net, axisFrom, now),
      followers: followerSeries(data.events, data.totals, account.followersCount, from, now),
      durations: departuresByDuration(data.events, ctx, from, now, baselineAt),
      retention: retention(data.events, ctx, from, now),
    }),
    // `now` n'est pas une dépendance : il suit `today` (voir ci-dessus).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.events, data.totals, ctx, from, axisFrom, unit, net, today, account.followersCount, baselineAt],
  );
  const setShown = useChartVisibility(hidden);
  const toast = useToast();
  const card = (chart: DashboardChart, content: ReactNode) =>
    hidden.includes(chart) ? null : (
      <ChartCard
        key={chart}
        onHide={() => {
          setShown(chart, false);
          toast.show(t('stats.hidden'), { action: { label: t('common.actions.undo'), run: () => setShown(chart, true) } });
        }}
      >
        {content}
      </ChartCard>
    );

  return {
    followers: card('followers', <FollowersChart series={charts.followers} all={period === 'all'} axisFrom={axisFrom} />),
    activity: card('activity', <ActivityChart buckets={charts.activity} since={floor} unit={unit} />),
    net: card('net', <NetChart buckets={charts.net} unit={net} since={floor} />),
    duration: card('duration', <DurationChart buckets={charts.durations} baselineAt={baselineAt} />),
    retention: card('retention', <RetentionCard values={charts.retention} />),
  };
}
