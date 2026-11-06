import { t } from '@/shared/i18n';
import type { FollowEvent } from '@/shared/types';
import { formatDate, formatDuration, joinParts } from '@/shared/utils/format';
import { followDuration, type FollowDuration } from '@/domain/events/selectors';

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

/** Libellé d'un compte qui n'est plus actif (suspendu, supprimé), sinon rien. */
export function statusLabel(e: FollowEvent): string | undefined {
  if (e.status === 'suspended') return t('dashboard.row.suspended');
  if (e.status === 'gone') return t('dashboard.row.gone');
  return undefined;
}

/**
 * Détails d'un départ : @handle, puis statut du compte, ou follow back (popup) et durée du suivi.
 * Le statut prime : un compte suspendu n'a pas de durée de suivi parlante.
 */
export function departureMeta(
  event: FollowEvent,
  events: readonly FollowEvent[],
  baselineAt: number | undefined,
  now: number,
  withFollowBack: boolean,
): string {
  const status = statusLabel(event);
  if (status) return joinParts([`@${event.handle}`, status]);
  return joinParts([
    `@${event.handle}`,
    withFollowBack && event.mutual ? t('dashboard.row.mutual') : undefined,
    followDurationLabel(followDuration(event, events, baselineAt), now),
  ]);
}
