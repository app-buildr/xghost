import { useState } from 'react';
import type { DayBucket } from '@/features/events/selectors';
import { LOCALE, t } from '@/shared/i18n';
import { formatNumber, formatSigned } from '@/shared/utils/format';

const DAY = 86_400_000;
const dayLabel = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });

/** Textes d'une journée, partagés par l'infobulle et le tableau pour lecteurs d'écran. */
function dayTexts(b: DayBucket) {
  return {
    date: dayLabel.format(b.day),
    arrivals: t('dashboard.chart.tipArrivals', { count: b.arrivals, n: formatNumber(b.arrivals) }),
    departures: t('dashboard.chart.tipDepartures', { count: b.departures, n: formatNumber(b.departures) }),
    net: t('dashboard.chart.tipNet', { net: formatSigned(b.arrivals - b.departures) }),
  };
}

/**
 * Graphique sur 30 jours (§ 3.4) : arrivées vers le haut (teal), départs vers le bas (corail).
 * Les deux séries se distinguent aussi par le sens des barres, pas seulement la couleur.
 * Survol d'une journée : infobulle avec la date, les arrivées, les départs et le solde.
 * Jours antérieurs au premier scan (`since`) : l'infobulle indique qu'il n'y a pas de donnée.
 * Les mêmes informations sont lisibles au clavier et au lecteur d'écran dans un tableau masqué.
 */
export function ActivityChart({ buckets, since }: { buckets: DayBucket[]; since?: number }) {
  const [hover, setHover] = useState<number>();
  const width = 900;
  const half = 44;
  const height = half * 2 + 4;
  const max = Math.max(1, ...buckets.flatMap((b) => [b.arrivals, b.departures]));
  const slot = width / Math.max(1, buckets.length);
  const bar = Math.max(4, slot - 6);
  const scale = (n: number) => (n === 0 ? 0 : Math.max(3, (n / max) * half));
  const totalA = buckets.reduce((s, b) => s + b.arrivals, 0);
  const totalD = buckets.reduce((s, b) => s + b.departures, 0);
  const active = hover === undefined ? undefined : buckets[hover];
  // Journée entièrement antérieure au premier scan : xGhost ne suivait pas encore le compte.
  const noData = (b: DayBucket) => since === undefined || b.day + DAY <= since;
  // Infobulle centrée sur la barre, calée à gauche ou à droite près des bords.
  const align = hover === undefined ? 'center' : hover < 3 ? 'start' : hover > buckets.length - 4 ? 'end' : 'center';
  const tip = active ? dayTexts(active) : undefined;

  return (
    <figure className="xg-chart">
      <figcaption className="xg-chart__head">
        <span>{t('dashboard.chart.title')}</span>
        <span className="xg-chart__legend" aria-hidden="true">
          <span>
            <i className="xg-chart__swatch xg-chart__swatch--arrival" /> {t('dashboard.chart.arrivals')}
          </span>
          <span>
            <i className="xg-chart__swatch xg-chart__swatch--departure" /> {t('dashboard.chart.departures')}
          </span>
        </span>
      </figcaption>
      <div className="xg-chart__plot" onMouseLeave={() => setHover(undefined)}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="xg-chart__svg"
          role="img"
          aria-label={t('dashboard.chart.aria', {
            arrivals: t('dashboard.chart.tipArrivals', { count: totalA, n: formatNumber(totalA) }),
            departures: t('dashboard.chart.tipDepartures', { count: totalD, n: formatNumber(totalD) }),
          })}
        >
          <line x1="0" x2={width} y1={half + 2} y2={half + 2} stroke="var(--xg-surface-muted)" />
          {buckets.map((b, i) => {
            const x = i * slot + (slot - bar) / 2;
            const up = scale(b.arrivals);
            const down = scale(b.departures);
            const dim = hover !== undefined && hover !== i;
            return (
              <g key={b.day} opacity={dim ? 0.35 : 1}>
                {hover === i && <rect x={i * slot} y={0} width={slot} height={height} rx={4} fill="var(--xg-surface-muted)" />}
                {/* Jour sans mouvement (ou avant le premier scan) : petit trait, pour que les 30 jours restent visibles. */}
                {up === 0 && down === 0 && <rect x={x} y={half} width={bar} height={4} rx={2} fill="var(--xg-border)" />}
                {up > 0 && <rect x={x} y={half - up} width={bar} height={up} rx={2} fill="var(--xg-primary)" />}
                {down > 0 && <rect x={x} y={half + 4} width={bar} height={down} rx={2} fill="var(--xg-chart-departure)" />}
              </g>
            );
          })}
        </svg>
        {/* Zones de survol, une par jour (HTML : l'infobulle se place en pourcentage de la largeur). */}
        <div className="xg-chart__hits" aria-hidden="true">
          {buckets.map((b, i) => (
            <span key={b.day} onMouseEnter={() => setHover(i)} />
          ))}
        </div>
        {active && tip && hover !== undefined && (
          <div
            className={`xg-chart__tip xg-chart__tip--${align}`}
            style={{ left: `${((hover + 0.5) / buckets.length) * 100}%` }}
            aria-hidden="true"
          >
            <strong>{tip.date}</strong>
            {noData(active) ? (
              <span className="xg-chart__tip-net">{t('dashboard.chart.tipNoData')}</span>
            ) : (
              <>
                <span className="xg-chart__tip-row">
                  <i className="xg-chart__swatch xg-chart__swatch--arrival" />
                  {tip.arrivals}
                </span>
                <span className="xg-chart__tip-row">
                  <i className="xg-chart__swatch xg-chart__swatch--departure" />
                  {tip.departures}
                </span>
                <span className="xg-chart__tip-net">{tip.net}</span>
              </>
            )}
          </div>
        )}
      </div>
      <table className="xg-sr-only">
        <caption>{t('dashboard.chart.title')}</caption>
        <tbody>
          {buckets.map((b) => {
            const texts = dayTexts(b);
            return (
              <tr key={b.day}>
                <th scope="row">{texts.date}</th>
                {noData(b) ? (
                  <td colSpan={3}>{t('dashboard.chart.tipNoData')}</td>
                ) : (
                  <>
                    <td>{texts.arrivals}</td>
                    <td>{texts.departures}</td>
                    <td>{texts.net}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </figure>
  );
}
