import type { DurationBucket } from '@/features/stats/selectors';
import { LOCALE, t } from '@/shared/i18n';
import { formatNumber } from '@/shared/utils/format';
import './stats.css';

const shortDate = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });

/** Départs de la période par durée de suivi (§ 3.4, § 4.5) : une barre par tranche. */
export function DurationChart({
  buckets,
  baselineAt,
}: {
  buckets: readonly { bucket: DurationBucket; count: number }[];
  baselineAt?: number;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((n, b) => n + b.count, 0);
  const label = (bucket: DurationBucket) =>
    bucket === 'before'
      ? t('stats.duration.before', { date: baselineAt ? shortDate.format(baselineAt) : '…' })
      : t(`stats.duration.${bucket}`);

  return (
    <figure className="xg-stat">
      <figcaption className="xg-stat__head">
        <h2 className="xg-stat__title">{t('stats.duration.title')}</h2>
        <span className="xg-stat__sub">{t('stats.duration.sub')}</span>
      </figcaption>
      {total === 0 ? (
        <p className="xg-stat__empty">{t('stats.duration.empty')}</p>
      ) : (
        <ul className="xg-duration">
          {buckets.map(({ bucket, count }) => (
            <li key={bucket} className="xg-duration__row">
              <span className="xg-duration__label">{label(bucket)}</span>
              <span className="xg-duration__count">{formatNumber(count)}</span>
              <span className="xg-duration__track" aria-hidden="true">
                <i className="xg-duration__bar" style={{ width: `${(count / max) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
