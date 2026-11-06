import { bucketStarts, type FollowerSeries } from '@/features/stats/selectors';
import { t } from '@/shared/i18n';
import { dayMonth, formatNumber, formatSigned, longDay } from '@/shared/utils/format';
import { ChartHits, ChartTip, StatHead, useChartHover } from './chart';

/** Repères de dates sous la courbe : début, fin, et deux intermédiaires. */
const ticks = (days: readonly number[]): readonly number[] =>
  days.length < 2
    ? days
    : [...new Set([0, Math.round((days.length - 1) / 3), Math.round(((days.length - 1) * 2) / 3), days.length - 1])].map(
        (i) => days[i]!,
      );

/**
 * Courbe du nombre d'abonnés (§ 3.4) : un point par jour, avec la variation sur la période.
 * L'axe couvre toute la période choisie (`axisFrom`) : les jours antérieurs au début du suivi
 * restent visibles, en pointillés gris. Survol : date et nombre d'abonnés du jour (infobulle en
 * fondu, comme les autres graphes).
 */
export function FollowersChart({ series, all, axisFrom }: { series: FollowerSeries; all: boolean; axisFrom?: number }) {
  const { points, start } = series;
  const { hover, shown, enter, leave } = useChartHover();
  const first = points[0];
  const end = points.at(-1);
  if (!first || !end) {
    return (
      <figure className="xg-chart-card">
        <StatHead title={t('stats.followers.title')} />
        <p className="xg-empty">{t('stats.followers.empty')}</p>
      </figure>
    );
  }

  // Jours de l'axe : ceux d'avant le suivi (sans donnée), puis ceux de la courbe.
  const before = axisFrom === undefined || axisFrom >= first.day ? [] : bucketStarts('day', axisFrom, first.day - 1);
  const days = [...before, ...points.map((p) => p.day)];
  const offset = before.length;

  const width = 600;
  const height = 150;
  const totals = [start, ...points.map((p) => p.total)];
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  // Marge verticale : une courbe plate reste au milieu, une courbe qui bouge garde de l'air.
  const pad = Math.max(1, (max - min) * 0.15);
  const lo = min - pad;
  const hi = max + pad;
  const x = (j: number) => (days.length === 1 ? width / 2 : (j / (days.length - 1)) * width);
  const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
  // Un seul jour : segment horizontal sur la largeur restante (pas de triangle).
  const line =
    points.length === 1
      ? `M${offset ? x(offset) : 0},${y(first.total).toFixed(1)} L${width},${y(first.total).toFixed(1)}`
      : points.map((p, i) => `${i ? 'L' : 'M'}${x(offset + i).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ');
  const left = points.length === 1 && !offset ? 0 : x(offset);
  const area = `${line} L${width},${height} L${left.toFixed(1)},${height} Z`;
  const placeholder = offset ? `M0,${y(start).toFixed(1)} L${x(offset).toFixed(1)},${y(start).toFixed(1)}` : undefined;
  // Variation sur toute la période, mouvements du premier jour compris (comme les chiffres).
  const variation = end.total - start;
  const active = shown === undefined ? undefined : points[shown - offset];
  const range = t(all ? 'stats.followers.rangeAll' : 'stats.followers.range', {
    from: formatNumber(start),
    to: formatNumber(end.total),
    date: dayMonth.format(first.day),
  });

  return (
    <figure className="xg-chart-card">
      <StatHead
        title={t('stats.followers.title')}
        sub={range}
        aside={<strong className={`xg-stat__delta${variation < 0 ? ' is-down' : ''}`}>{formatSigned(variation)}</strong>}
      />
      <div className="xg-stat__plot" onMouseLeave={leave}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="xg-followers__svg"
          role="img"
          aria-label={t('stats.followers.aria', { from: formatNumber(start), to: formatNumber(end.total) })}
        >
          {placeholder && <path d={placeholder} className="xg-followers__placeholder" vectorEffect="non-scaling-stroke" />}
          <path d={area} className="xg-followers__area" />
          <path d={line} className="xg-followers__line" vectorEffect="non-scaling-stroke" />
          {shown !== undefined && (
            <line
              x1={x(shown)}
              x2={x(shown)}
              y1={0}
              y2={height}
              className={`xg-followers__cursor${hover === undefined ? '' : ' is-visible'}`}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        <ChartHits count={days.length} onEnter={enter} />
        {shown !== undefined && days[shown] !== undefined && (
          <ChartTip index={shown} count={days.length} left={(x(shown) / width) * 100} visible={hover !== undefined}>
            <strong>{longDay.format(days[shown])}</strong>
            <span>
              {active
                ? t('stats.followers.tip', { count: active.total, n: formatNumber(active.total) })
                : t('stats.followers.noData')}
            </span>
          </ChartTip>
        )}
      </div>
      <div className="xg-stat__axis" aria-hidden="true">
        {ticks(days).map((day) => (
          <span key={day}>{dayMonth.format(day)}</span>
        ))}
      </div>
    </figure>
  );
}
