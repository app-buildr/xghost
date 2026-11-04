import { DAY } from '@/shared/utils/time';
import type { Bucket } from '@/features/stats/selectors';
import { t } from '@/shared/i18n';
import { dayMonth, formatNumber, formatSigned, longDay } from '@/shared/utils/format';
import { ChartHits, ChartTip, StatHead, useChartHover } from './chart';

/** Textes d'une tranche (jour ou semaine), partagés par l'infobulle et le tableau pour lecteurs d'écran. */
function texts(b: Bucket, unit: 'day' | 'week') {
  const net = formatSigned(b.arrivals - b.departures);
  return {
    date: unit === 'day' ? longDay.format(b.day) : t('stats.activity.weekOf', { date: dayMonth.format(b.day) }),
    arrivals: t('stats.activity.tipArrivals', { count: b.arrivals, n: formatNumber(b.arrivals) }),
    departures: t('stats.activity.tipDepartures', { count: b.departures, n: formatNumber(b.departures) }),
    net: unit === 'day' ? t('stats.activity.netDay', { net }) : t('stats.activity.netWeek', { net }),
  };
}

/**
 * Arrivées et départs sur la période (§ 3.4), par jour ou par semaine : arrivées vers le haut
 * (teal), départs vers le bas (corail). Les deux séries se distinguent aussi par le sens des
 * barres, pas seulement la couleur. Survol : date, arrivées, départs et solde.
 * Tranches antérieures au premier scan (`since`) : petit trait gris, « pas de donnée » au survol.
 * Les mêmes informations sont lisibles au clavier et au lecteur d'écran dans un tableau masqué.
 */
export function ActivityChart({ buckets, since, unit }: { buckets: Bucket[]; since?: number; unit: 'day' | 'week' }) {
  const { hover, shown, enter, leave } = useChartHover();
  const title = t('stats.activity.title');
  const width = 900;
  const half = 44;
  const height = half * 2 + 4;
  const max = Math.max(1, ...buckets.flatMap((b) => [b.arrivals, b.departures]));
  const slot = width / Math.max(1, buckets.length);
  const bar = Math.max(4, slot - 6);
  const scale = (n: number) => (n === 0 ? 0 : Math.max(3, (n / max) * half));
  const totalA = buckets.reduce((s, b) => s + b.arrivals, 0);
  const totalD = buckets.reduce((s, b) => s + b.departures, 0);
  const span = unit === 'week' ? 7 * DAY : DAY;
  const noData = (b: Bucket) => since === undefined || b.day + span <= since;
  const active = shown === undefined ? undefined : buckets[shown];
  const tip = active && texts(active, unit);

  return (
    <figure className="xg-stat">
      <StatHead
        title={title}
        aside={
          <span className="xg-chart__legend" aria-hidden="true">
            <span>
              <i className="xg-chart__swatch xg-chart__swatch--arrival" /> {t('stats.activity.arrivals')}
            </span>
            <span>
              <i className="xg-chart__swatch xg-chart__swatch--departure" /> {t('stats.activity.departures')}
            </span>
          </span>
        }
      />
      <div className="xg-stat__plot" onMouseLeave={leave}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="xg-chart__svg"
          role="img"
          aria-label={t('stats.activity.aria', {
            title,
            arrivals: t('stats.activity.tipArrivals', { count: totalA, n: formatNumber(totalA) }),
            departures: t('stats.activity.tipDepartures', { count: totalD, n: formatNumber(totalD) }),
          })}
        >
          <line x1="0" x2={width} y1={half + 2} y2={half + 2} stroke="var(--xg-surface-muted)" />
          {buckets.map((b, i) => {
            const x = i * slot + (slot - bar) / 2;
            const up = scale(b.arrivals);
            const down = scale(b.departures);
            const dim = hover !== undefined && hover !== i;
            return (
              <g key={b.day} className="xg-chart__day" style={{ opacity: dim ? 0.35 : 1 }}>
                {/* Fond de la tranche survolée : apparaît et disparaît en fondu. */}
                <rect
                  className="xg-chart__hl"
                  x={i * slot}
                  y={0}
                  width={slot}
                  height={height}
                  rx={4}
                  fill="var(--xg-surface-muted)"
                  style={{ opacity: hover === i ? 1 : 0 }}
                />
                {/* Sans mouvement (ou avant le premier scan) : petit trait, pour que toute la période reste visible. */}
                {up === 0 && down === 0 && <rect x={x} y={half} width={bar} height={4} rx={2} fill="var(--xg-border)" />}
                {up > 0 && <rect x={x} y={half - up} width={bar} height={up} rx={2} fill="var(--xg-primary)" />}
                {down > 0 && <rect x={x} y={half + 4} width={bar} height={down} rx={2} fill="var(--xg-chart-departure)" />}
              </g>
            );
          })}
        </svg>
        <ChartHits count={buckets.length} onEnter={enter} />
        {active && tip && shown !== undefined && (
          <ChartTip
            index={shown}
            count={buckets.length}
            left={((shown + 0.5) / buckets.length) * 100}
            visible={hover !== undefined}
          >
            <strong>{tip.date}</strong>
            {noData(active) ? (
              <span className="xg-chart__tip-net">{t('stats.activity.noData')}</span>
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
          </ChartTip>
        )}
      </div>
      {/* Tableau dans une boîte masquée : un tableau ignore la largeur de 1 px et élargirait la page. */}
      <div className="xg-sr-only">
        <table>
          <caption>{title}</caption>
          <tbody>
            {buckets.map((b) => {
              const row = texts(b, unit);
              return (
                <tr key={b.day}>
                  <th scope="row">{row.date}</th>
                  {noData(b) ? (
                    <td colSpan={3}>{t('stats.activity.noData')}</td>
                  ) : (
                    <>
                      <td>{row.arrivals}</td>
                      <td>{row.departures}</td>
                      <td>{row.net}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="xg-chart__foot">{t(unit === 'day' ? 'stats.activity.byDay' : 'stats.activity.byWeek')}</p>
    </figure>
  );
}
