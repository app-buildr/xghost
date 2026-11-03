import { useCallback, useMemo } from 'react';
import type { AccountData } from '@/features/app-state/useAccountData';
import { currentArrivals, type VisibilityContext } from '@/features/events/selectors';
import { t } from '@/shared/i18n';
import type { FollowEvent } from '@/shared/types';
import { formatNumber } from '@/shared/utils/format';
import { EventListPanel } from './EventListPanel';
import { ProfileLink } from './EventParts';
import { EventRow } from './EventRow';

/**
 * « Nouveaux abonnés » : arrivées détectées depuis le scan de référence.
 * Avec `limit` (tableau de bord) : les plus récentes et un lien vers la liste complète.
 */
export function ArrivalsPanel({
  data,
  ctx,
  now,
  limit,
  onShowAll,
}: {
  data: AccountData;
  ctx: VisibilityContext;
  now: number;
  limit?: number;
  onShowAll?: () => void;
}) {
  const items = useMemo(() => currentArrivals(data.events, ctx), [data.events, ctx]);
  // Follow back : état relu à chaque scan (cache des profils), car on suit souvent en retour
  // après l'arrivée ; à défaut, l'état enregistré au moment de l'arrivée.
  const followsBack = useCallback(
    (e: FollowEvent) => data.profiles[e.profileId]?.following ?? e.mutual,
    [data.profiles],
  );

  return (
    <EventListPanel
      title={t('dashboard.arrivals.title')}
      filterLabel={t('dashboard.arrivals.filterLabel')}
      items={items}
      followsBack={followsBack}
      empty={t('dashboard.arrivals.empty')}
      emptyFiltered={t('dashboard.arrivals.emptyFilter')}
      limit={limit}
      onShowAll={onShowAll}
      showAllLabel={(count) => t('dashboard.arrivals.showAll', { count, n: formatNumber(count) })}
      renderRow={(event) => (
        <EventRow
          key={event.id}
          event={event}
          profiles={data.profiles}
          now={now}
          meta={data.profiles[event.profileId]?.name ? `@${event.handle}` : ''}
          newTone="follow"
          actions={<ProfileLink handle={event.handle} />}
        />
      )}
    />
  );
}
