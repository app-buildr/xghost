import { t } from '@/shared/i18n';
import type { TrackedAccount } from '@/shared/types';
import { STALE_RECHECK_MS } from '@/features/followers-sync/model';
import { formatList, formatNumber } from '@/shared/utils/format';
import { MINUTE } from '@/shared/utils/time';

/** Résultat du dernier contrôle rapide, en une phrase claire (témoin de ce que xGhost a fait). */
export function quickSummary(account: TrackedAccount): string | undefined {
  const q = account.lastQuick;
  if (!q || (account.lastScan && account.lastScan.at > q.at)) return undefined;
  if (q.overflow) return t('dashboard.quick.overflow');
  const found = [
    q.arrivals > 0 ? t('dashboard.quick.arrivals', { count: q.arrivals, n: formatNumber(q.arrivals) }) : undefined,
    q.departed ? t('dashboard.quick.departed', { count: q.departed, n: formatNumber(q.departed) }) : undefined,
  ].filter((s): s is string => !!s);
  const seen = found.length ? formatList(found) : undefined;
  if (q.staleRuns) {
    return t('dashboard.quick.stale', { seen: seen ?? t('dashboard.quick.nothingNew'), minutes: STALE_RECHECK_MS / MINUTE });
  }
  if (q.missing > 0) {
    const missing = t('dashboard.quick.missing', { count: q.missing, n: formatNumber(q.missing) });
    return seen ? t('dashboard.quick.missingWithSeen', { seen, missing }) : t('dashboard.quick.missingOnly', { missing });
  }
  return seen ? t('dashboard.quick.seenOnly', { seen }) : t('dashboard.quick.noChange');
}
