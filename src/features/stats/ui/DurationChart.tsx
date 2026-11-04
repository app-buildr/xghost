import type { DurationBucket, DurationRow } from '@/features/stats/selectors';
import { t } from '@/shared/i18n';
import { formatNumber } from '@/shared/utils/format';
import { shortDate, StatHead } from './chart';

/**
 * Départs de la période par durée de suivi (§ 3.4, § 4.5) : une barre par tranche. Toutes les
 * tranches restent affichées : celles que le suivi ne couvre pas encore sont grisées (« — »).
 */
export function DurationChart({
  buckets,
  baselineAt,
}: {
  buckets: readonly DurationRow[];
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
      <StatHead title={t('stats.duration.title')} sub={t('stats.duration.sub')} />
      <ul className="xg-duration">
        {buckets.map(({ bucket, count, available }) => (
          <li key={bucket} className={`xg-duration__row${available ? '' : ' is-pending'}`}>
            <span className="xg-duration__label">{label(bucket)}</span>
            <span className="xg-duration__count">
              {available ? (
                formatNumber(count)
              ) : (
                <>
                  <span aria-hidden="true">{t('stats.none')}</span>
                  <span className="xg-sr-only">{t('stats.duration.tooEarly')}</span>
                </>
              )}
            </span>
            <span className="xg-duration__track" aria-hidden="true">
              <i className="xg-duration__bar" style={{ width: `${(count / max) * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>
      {total === 0 && <p className="xg-stat__empty">{t('stats.duration.empty')}</p>}
    </figure>
  );
}
