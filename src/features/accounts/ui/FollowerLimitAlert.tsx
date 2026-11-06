import { TriangleAlert } from 'lucide-react';
import { t } from '@/shared/i18n';
import type { TrackedAccount } from '@/shared/types';
import { formatDate, formatNumber } from '@/shared/utils/format';
import { followerLimitOf } from '@/domain/accounts/limit';
import './accounts.css';

/**
 * Alerte « Limite d'abonnés dépassée » (§ 4.9) : version longue sous l'en-tête du tableau de bord,
 * version courte dans la popup. Rien si le compte est sous la limite.
 */
export function FollowerLimitAlert({
  account,
  now,
  compact = false,
}: {
  account: TrackedAccount;
  now: number;
  compact?: boolean;
}) {
  const { limit } = account;
  if (!limit) return null;
  const max = formatNumber(followerLimitOf(account));
  return (
    <div className={`xg-limit${compact ? ' xg-limit--compact' : ''}`} role="alert">
      <strong className="xg-limit__title">
        <TriangleAlert size={compact ? 20 : 22} aria-hidden="true" />
        {t('common.limit.title')}
      </strong>
      <p>
        {compact
          ? t('common.limit.short', { limit: max })
          : t('common.limit.text', {
              handle: account.handle,
              limit: max,
              count: formatNumber(limit.count),
              date: formatDate(account.lastScanAt ?? limit.at, now),
            })}
      </p>
    </div>
  );
}
