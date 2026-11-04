import { useCallback, useMemo } from 'react';
import type { AccountData } from '@/features/app-state/useAccountData';
import { followDurationLabel } from '@/features/events/labels';
import { currentDepartures, followDuration, type VisibilityContext } from '@/features/events/selectors';
import { t } from '@/shared/i18n';
import type { FollowEvent, TrackedAccount } from '@/shared/types';
import { ActionMenu } from '@/shared/ui/ActionMenu';
import { Copy, EyeOff, Trash2 } from 'lucide-react';
import { formatNumber } from '@/shared/utils/format';
import { joinParts, statusLabel } from './display';
import { EventListPanel } from './EventListPanel';
import { ProfileLink } from './EventParts';
import { EventRow } from './EventRow';
import { useEventActions } from './useEventActions';

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

/** Liste « Derniers départs » (§ 3.4) : filtre follow back, étiquette « Nouveau », actions rapides. */
export function DeparturesPanel({
  title,
  account,
  data,
  ctx,
  now,
  limit,
  onShowAll,
  fill,
}: {
  title: string;
  account: TrackedAccount;
  data: AccountData;
  ctx: VisibilityContext;
  now: number;
  limit?: number;
  onShowAll?: () => void;
  /** Prend la hauteur de son conteneur ; la liste défile à l'intérieur. */
  fill?: boolean;
}) {
  const actions = useEventActions(account.id);
  const items = useMemo(() => currentDepartures(data.events, ctx), [data.events, ctx]);
  // Départ : on garde l'état au moment du départ (« tu le suivais quand il est parti »).
  const followsBack = useCallback((e: FollowEvent) => e.mutual, []);

  return (
    <EventListPanel
      title={title}
      filterLabel={t('dashboard.departures.filterLabel')}
      items={items}
      followsBack={followsBack}
      empty={t('dashboard.departures.empty')}
      emptyFiltered={t('dashboard.departures.emptyFilter')}
      limit={limit}
      onShowAll={onShowAll}
      fill={fill}
      showAllLabel={(count) => t('dashboard.departures.showAll', { count, n: formatNumber(count) })}
      renderRow={(event) => (
        <EventRow
          key={event.id}
          event={event}
          profiles={data.profiles}
          now={now}
          meta={departureMeta(event, data.events, account.baselineAt, now, false)}
          actions={
            <>
              <ProfileLink handle={event.handle} />
              <ActionMenu
                label={t('dashboard.row.actionsFor', { handle: event.handle })}
                actions={[
                  {
                    key: 'copy',
                    label: t('dashboard.row.copyUsername'),
                    icon: <Copy size={18} />,
                    onSelect: () => void actions.copyUsername(event.handle),
                  },
                  {
                    key: 'ignore',
                    label: t('dashboard.row.ignore'),
                    hint: t('dashboard.row.ignoreHint'),
                    icon: <EyeOff size={18} />,
                    onSelect: () => void actions.ignore(event.profileId, event.handle),
                  },
                  {
                    key: 'delete',
                    label: t('dashboard.row.delete'),
                    icon: <Trash2 size={18} />,
                    danger: true,
                    separatorBefore: true,
                    onSelect: () => void actions.remove(event),
                  },
                ]}
              />
            </>
          }
        />
      )}
    />
  );
}
