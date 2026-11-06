import { RETENTION_DAYS } from '@/features/stats/selectors';
import { t } from '@/shared/i18n';
import { formatPercent } from '@/shared/utils/format';
import { StatHead } from './chart';

/**
 * Rétention des arrivées (§ 3.4) : part des nouveaux abonnés encore là après 7, 14 et 30 jours.
 * Sans arrivée assez ancienne pour être jugée, la tuile affiche « — ».
 */
export function RetentionCard({ values }: { values: Record<(typeof RETENTION_DAYS)[number], number | null> }) {
  return (
    <figure className="xg-chart-card">
      <StatHead title={t('stats.retention.title')} sub={t('stats.retention.sub')} />
      <ul className="xg-retention">
        {RETENTION_DAYS.map((days) => {
          const v = values[days];
          const pct = v === null ? undefined : formatPercent(Math.round(v * 100));
          return (
            <li key={days} className={`xg-retention__tile${pct ? '' : ' is-pending'}`}>
              <span className="xg-sr-only">
                {pct ? t('stats.retention.value', { pct, days }) : t('stats.retention.noneHint')}
              </span>
              <span className="xg-retention__days" aria-hidden="true">
                {t('stats.retention.days', { n: days })}
              </span>
              <strong className="xg-retention__value" aria-hidden="true">
                {pct ?? t('stats.none')}
              </strong>
              <span className="xg-retention__track" aria-hidden="true">
                <i className="xg-retention__bar" style={{ width: `${(v ?? 0) * 100}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
