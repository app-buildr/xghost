import { useState } from 'react';
import type { Bucket } from '@/features/stats/selectors';
import { LOCALE, t } from '@/shared/i18n';
import { formatSigned } from '@/shared/utils/format';
import './stats.css';

const weekDate = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const monthDate = new Intl.DateTimeFormat(LOCALE, { month: 'short', year: '2-digit' });

/**
 * Solde net par semaine (ou par mois sur « Tout ») : arrivées moins départs (§ 3.4). Barres vers
 * le haut (teal) quand le solde est positif, vers le bas (corail) quand il est négatif.
 */
export function NetChart({ buckets, unit }: { buckets: readonly Bucket[]; unit: 'week' | 'month' }) {
  const [hover, setHover] = useState<number>();
  const values = buckets.map((b) => b.arrivals - b.departures);
  const max = Math.max(1, ...values.map(Math.abs));
  const hasNegative = values.some((v) => v < 0);
  const label = (b: Bucket) => (unit === 'week' ? weekDate : monthDate).format(b.day);
  // Pas plus de 8 dates sous l'axe : au-delà, une sur deux, sur trois…
  const every = Math.max(1, Math.ceil(buckets.length / 8));

  return (
    <figure className="xg-stat">
      <figcaption className="xg-stat__head">
        <h2 className="xg-stat__title">{t(unit === 'week' ? 'stats.net.titleWeek' : 'stats.net.titleMonth')}</h2>
        <span className="xg-stat__sub">{t('stats.net.sub')}</span>
      </figcaption>
      <ol className={`xg-net${hasNegative ? ' has-negative' : ''}`} onMouseLeave={() => setHover(undefined)}>
        {buckets.map((b, i) => {
          const v = values[i]!;
          const size = `${(Math.abs(v) / max) * 100}%`;
          return (
            <li
              key={b.day}
              className={`xg-net__col${hover !== undefined && hover !== i ? ' is-dim' : ''}`}
              onMouseEnter={() => setHover(i)}
              aria-label={t('stats.net.aria', { period: label(b), net: formatSigned(v) })}
            >
              <span className="xg-net__half xg-net__half--up">
                {v > 0 && (
                  <>
                    <b className="xg-net__value">{formatSigned(v)}</b>
                    <i className="xg-net__bar xg-net__bar--up" style={{ height: size }} />
                  </>
                )}
                {v === 0 && <b className="xg-net__value">0</b>}
              </span>
              <span className="xg-net__half xg-net__half--down">
                {v < 0 && (
                  <>
                    <i className="xg-net__bar xg-net__bar--down" style={{ height: size }} />
                    <b className="xg-net__value is-down">{formatSigned(v)}</b>
                  </>
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
