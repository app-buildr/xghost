import { followDurationLabel } from '@/features/events/labels';
import { followDuration } from '@/features/events/selectors';
import type { ProfileCache } from '@/features/followers-sync/repository';
import type { FollowEvent } from '@/shared/types';
import { ActionMenu } from '@/shared/ui/ActionMenu';
import { IconCheck, IconCopy, IconEyeOff, IconTrash } from '@/shared/ui/icons';
import { Avatar } from '@/shared/ui/primitives';
import { EventTime, ProfileLink } from './EventParts';
import { displayName, statusLabel } from './useDisplayProfiles';
import './departures.css';

interface RowProps {
  event: FollowEvent;
  events: FollowEvent[];
  profiles: ProfileCache | undefined;
  baselineAt?: number;
  now: number;
}

function meta({ event, events, baselineAt, now }: RowProps, withMutual: boolean): string {
  const parts = [`@${event.handle}`];
  const status = statusLabel(event);
  if (status) return [...parts, status].join(' · ');
  if (withMutual && event.mutual) parts.push('mutuel');
  const duration = followDurationLabel(followDuration(event, events, baselineAt), now);
  if (duration) parts.push(duration);
  return parts.join(' · ');
}

/** Ligne compacte de la popup (§ 3.2). Les listes ne contiennent que des comptes toujours absents. */
export function DepartureRowCompact(props: RowProps) {
  const { event, profiles, now } = props;
  const inactive = event.status !== 'active';
  const name = displayName(event, profiles);
  return (
    <li className={`xg-dep-compact${inactive ? ' is-inactive' : ''}`}>
      <Avatar id={event.profileId} name={name} src={profiles?.[event.profileId]?.avatar} size={44} muted={inactive} />
      <div className="xg-dep__body">
        <div className="xg-dep__name">{name}</div>
        <div className="xg-dep__meta">{meta(props, true)}</div>
      </div>
      <div className="xg-dep-compact__side">
        {!event.seen && <span className="xg-dot" aria-label="Non vu" />}
        <EventTime at={event.at} now={now} short />
      </div>
    </li>
  );
}

interface FullRowProps extends RowProps {
  onMarkSeen: () => void;
  onCopy: () => void;
  onIgnore: () => void;
  onDelete: () => void;
}

/** Ligne complète de la page d'options (§ 3.4), avec menu d'actions rapides. */
export function DepartureRow(props: FullRowProps) {
  const { event, profiles, now } = props;
  const inactive = event.status !== 'active';
  const unseen = !event.seen;
  const name = displayName(event, profiles);
  return (
    <li className={`xg-dep${inactive ? ' is-inactive' : ''}`}>
      <Avatar id={event.profileId} name={name} src={profiles?.[event.profileId]?.avatar} size={48} muted={inactive} />
      <div className="xg-dep__body">
        <div className="xg-dep__title">
          <span className="xg-dep__name">{name}</span>
          {unseen && <span className="xg-tag xg-tag--new">Nouveau</span>}
          {event.mutual && <span className="xg-tag xg-tag--follow">Tu le suis</span>}
        </div>
        <div className="xg-dep__meta">{meta(props, false)}</div>
      </div>
      <EventTime className="xg-dep__date" at={event.at} now={now} />
      <div className="xg-dep__actions">
        <ProfileLink handle={event.handle} />
        <ActionMenu
          label={`Actions pour @${event.handle}`}
          actions={[
            ...(unseen
              ? [{ key: 'seen', label: 'Marquer comme vu', icon: <IconCheck size={18} />, onSelect: props.onMarkSeen }]
              : []),
            { key: 'copy', label: 'Copier le @handle', icon: <IconCopy size={18} />, onSelect: props.onCopy },
            {
              key: 'ignore',
              label: 'Ignorer ce compte',
              hint: 'Ne plus signaler ses départs',
              icon: <IconEyeOff size={18} />,
              onSelect: props.onIgnore,
            },
            {
              key: 'delete',
              label: 'Supprimer de l’historique',
              icon: <IconTrash size={18} />,
              danger: true,
              separatorBefore: true,
              onSelect: props.onDelete,
            },
          ]}
        />
      </div>
    </li>
  );
}
