import { useCallback, useMemo } from 'react';
import type { AccountData } from '@/features/app-state/useAccountData';
import { departureMeta } from '../labels';
import { currentDepartures, type VisibilityContext } from '@/domain/events/selectors';
import { t } from '@/shared/i18n';
import type { FollowEvent, TrackedAccount } from '@/shared/types';
import { ActionMenu } from '@/shared/ui/ActionMenu';
import { Copy, EyeOff, Trash2 } from 'lucide-react';
import { formatNumber } from '@/shared/utils/format';
import { EventListPanel } from './EventListPanel';
import { ProfileLink } from './EventParts';
import { EventRow } from './EventRow';
import { useEventActions } from './useEventActions';

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
  // Départ : état vérifié sur le profil du compte parti juste après sa détection (voir follow-check),
  // à défaut celui du cache des profils au moment du départ.
  const followsBack = useCallback((e: FollowEvent) => e.mutual, []);

  return (
    <EventListPanel
      title={title}
      filterLabel={t('dashboard.departures.filterLabel')}
      items={items}
      followsBack={followsBack}
      empty={t('common.departuresEmpty')}
      emptyFiltered={t('dashboard.departures.emptyFilter')}
      limit={limit}
      onShowAll={onShowAll}
      fill={fill}
      showAllLabel={(count) => t('dashboard.departures.showAll', { count, n: formatNumber(count) })}
      renderRow={(event, rowProps) => (
        <EventRow
          key={event.id}
          rowProps={rowProps}
          event={event}
          profiles={data.profiles}
          now={now}
          meta={departureMeta(event, data.events, account.baselineAt, now, false)}
          actions={
            <>
              <ProfileLink handle={event.handle} profileId={event.profileId} />
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
