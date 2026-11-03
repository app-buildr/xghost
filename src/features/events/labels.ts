import { formatDate, formatDuration } from '@/shared/utils/format';
import type { FollowDuration } from './selectors';

/** Libellé de la durée du suivi (§ 4.5) : jamais de durée inventée. */
export function followDurationLabel(d: FollowDuration, now = Date.now()): string | undefined {
  switch (d.kind) {
    case 'during':
      return `suivi pendant ${formatDuration(d.ms)}`;
    case 'since-or-before':
      return `suivi depuis le ${formatDate(d.since, now)} ou avant`;
    default:
      return undefined;
  }
}
