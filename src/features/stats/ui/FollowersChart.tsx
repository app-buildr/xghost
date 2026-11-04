import { useState } from 'react';
import type { FollowerPoint, FollowerSeries } from '@/features/stats/selectors';
import { LOCALE, t } from '@/shared/i18n';
import { formatNumber, formatSigned } from '@/shared/utils/format';
import './stats.css';

const shortDate = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const longDate = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });

/** Repères de dates sous la courbe : début, fin, et deux intermédiaires. */
const ticks = (points: readonly FollowerPoint[]): readonly FollowerPoint[] =>
  points.length < 2
    ? points
    : [...new Set([0, Math.round((points.length - 1) / 3), Math.round(((points.length - 1) * 2) / 3), points.length - 1])].map(
        (i) => points[i]!,
      );

/**
 * Courbe du nombre d'abonnés (§ 3.4) : un point par jour, avec la variation sur la période.
 * Survol : date et nombre d'abonnés du jour (infobulle en fondu, comme les autres graphes).
 */
export function FollowersChart({ series, all }: { series: FollowerSeries; all: boolean }) {
  const { points, start } = series;
  const [hover, setHover] = useState<number>();
  const [last, setLast] = useState<number>();
  const first = points[0];
  const end = points.at(-1);
  if (!first || !end) {
    return (
      <figure className="xg-stat">
        <figcaption className="xg-stat__head">
          <h2 className="xg-stat__title">{t('stats.followers.title')}</h2>
        </figcaption>
        <p className="xg-stat__empty">{t('stats.followers.empty')}</p>
      </figure>
    );
  }

  const width = 600;
  const height = 150;
  const totals = [start, ...points.map((p) => p.total)];
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  // Marge verticale : une courbe plate reste au milieu, une courbe qui bouge garde de l'air.
  const pad = Math.max(1, (max - min) * 0.15);
  const lo = min - pad;
  const hi = max + pad;
  const x = (i: number) => (points.length === 1 ? width / 2 : (i / (points.length - 1)) * width);
  const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
  // Un seul jour : segment horizontal sur toute la largeur (pas de triangle).
  const line =
    points.length === 1
      ? `M0,${y(first.total).toFixed(1)} L${width},${y(first.total).toFixed(1)}`
      : points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  // Variation sur toute la période, mouvements du premier jour compris (comme les chiffres).
  const variation = end.total - start;
  const shown = hover ?? last;
  const active = shown === undefined ? undefined : points[shown];
  const range = t(all ? 'stats.followers.rangeAll' : 'stats.followers.range', {
    from: formatNumber(start),
    to: formatNumber(end.total),
    date: shortDate.format(first.day),
  });

  return (
    <figure className="xg-stat">
      <figcaption className="xg-stat__head xg-stat__head--row">
        <span>
          <h2 className="xg-stat__title">{t('stats.followers.title')}</h2>
          <span className="xg-stat__sub">{range}</span>
        </span>
        <strong className={`xg-stat__delta${variation < 0 ? ' is-down' : ''}`}>{formatSigned(variation)}</strong>
      </figcaption>
      <div className="xg-stat__plot" onMouseLeave={() => setHover(undefined)}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="xg-followers__svg"
          role="img"
          aria-label={t('stats.followers.aria', { from: formatNumber(start), to: formatNumber(end.total) })}
        >
          <path d={area} className="xg-followers__area" />
          <path d={line} className="xg-followers__line" vectorEffect="non-scaling-stroke" />
          {active && shown !== undefined && (
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
        <div className="xg-chart__hits" aria-hidden="true">
          {points.map((p, i) => (
            <span
              key={p.day}
              onMouseEnter={() => {
                setHover(i);
                setLast(i);
              }}
            />
          ))}
        </div>
        {active && shown !== undefined && (
          <div
            className={`xg-chart__tip xg-chart__tip--${shown < points.length / 6 ? 'start' : shown > (points.length * 5) / 6 ? 'end' : 'center'}${hover === undefined ? '' : ' is-visible'}`}
            style={{ left: `${(x(shown) / width) * 100}%` }}
            aria-hidden="true"
          >
            <strong>{longDate.format(active.day)}</strong>
            <span>{t('stats.followers.tip', { count: active.total, n: formatNumber(active.total) })}</span>
          </div>
        )}
      </div>
      <div className="xg-stat__axis" aria-hidden="true">
        {ticks(points).map((p) => (
          <span key={p.day}>{shortDate.format(p.day)}</span>
        ))}
      </div>
    </figure>
  );
}
