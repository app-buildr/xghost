import type { Bucket } from '@/features/stats/selectors';
import { t } from '@/shared/i18n';
import { dayMonth, formatSigned, shortMonth, shortMonthYear } from '@/shared/utils/format';
import { StatHead, useChartHover } from './chart';


/**
 * Solde net par semaine (ou par mois sur « Tout ») : arrivées moins départs (§ 3.4). Barres vers
 * le haut (teal) quand le solde est positif, vers le bas (corail) quand il est négatif.
 */
export function NetChart({
  buckets,
  unit,
  since,
}: {
  buckets: readonly Bucket[];
  unit: 'week' | 'month';
  /** Début du suivi : les tranches qui finissent avant n'ont pas de donnée (petite barre grise). */
  since?: number;
}) {
  const noData = (i: number) => since === undefined || (buckets[i + 1]?.day ?? Infinity) <= since;
  const { hover, enter, leave } = useChartHover();
  const values = buckets.map((b) => b.arrivals - b.departures);
  const max = Math.max(1, ...values.map(Math.abs));
  const hasNegative = values.some((v) => v < 0);
  // Mois seul (« juil. ») ; l'année seulement si la période en couvre plusieurs.
  const years = new Set(buckets.map((b) => new Date(b.day).getFullYear()));
  const label = (b: Bucket) =>
    (unit === 'week' ? dayMonth : years.size > 1 ? shortMonthYear : shortMonth).format(b.day);
  // Beaucoup de barres (90 jours, « Tout ») : chiffres au survol seulement, quatre dates sous l'axe.
  const dense = buckets.length > 8;
  const every = dense ? Math.ceil(buckets.length / 4) : 1;
  const showValue = (i: number) => !dense || hover === i;

  return (
    <figure className="xg-stat">
      <StatHead title={t(unit === 'week' ? 'stats.net.titleWeek' : 'stats.net.titleMonth')} sub={t('stats.net.sub')} />
      <ol className={`xg-net${hasNegative ? ' has-negative' : ''}${dense ? ' is-dense' : ''}`} onMouseLeave={leave}>
        {buckets.map((b, i) => {
          const v = values[i]!;
          const size = `${(Math.abs(v) / max) * 100}%`;
          return (
            <li
              key={b.day}
              className={`xg-net__col${hover !== undefined && hover !== i ? ' is-dim' : ''}`}
              onMouseEnter={() => enter(i)}
            >
              <span className="xg-sr-only">
                {noData(i)
                  ? t('stats.net.noData', { period: label(b) })
                  : t('stats.net.aria', { period: label(b), net: formatSigned(v) })}
              </span>
              <span className="xg-net__half xg-net__half--up" aria-hidden="true">
                {v > 0 && (
                  <i className="xg-net__bar xg-net__bar--up" style={{ height: size }}>
                    {showValue(i) && <b className="xg-net__value">{formatSigned(v)}</b>}
                  </i>
                )}
                {v === 0 && noData(i) && <i className="xg-net__bar xg-net__bar--empty" />}
                {v === 0 && !noData(i) && showValue(i) && <b className="xg-net__value xg-net__value--zero">0</b>}
              </span>
              <span className="xg-net__half xg-net__half--down" aria-hidden="true">
                {v < 0 && (
                  <i className="xg-net__bar xg-net__bar--down" style={{ height: size }}>
                    {showValue(i) && <b className="xg-net__value is-down">{formatSigned(v)}</b>}
                  </i>
                )}
              </span>
              <span className="xg-net__label" aria-hidden="true">
                {i % every === 0 ? label(b) : ''}
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
