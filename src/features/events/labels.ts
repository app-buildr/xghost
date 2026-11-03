import { t } from '@/shared/i18n';
import { formatDate, formatDuration } from '@/shared/utils/format';
import type { FollowDuration } from './selectors';

/** Libellé de la durée du suivi (§ 4.5) : jamais de durée inventée. */
export function followDurationLabel(d: FollowDuration, now = Date.now()): string | undefined {
  switch (d.kind) {
    case 'during':
      return t('common.event.followedFor', { duration: formatDuration(d.ms) });
    case 'since-or-before':
      return t('common.event.followedSince', { date: formatDate(d.since, now) });
    default:
      return undefined;
  }
}
